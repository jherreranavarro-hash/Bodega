import type { Ctx, PlanStep, Playbook } from '../engine/types.js';
import { PREFIX, allDevicesTarget, asList, assign, ensureObject, ensureSettingsPolicy, fingerprint, findByName, odataQuote, pending, sc } from '../engine/helpers.js';

/*
 * Respuesta a vulnerabilidades publicadas por Microsoft: cada playbook mitiga un CVE concreto
 * con controles de Intune y deja la verificación del parche en el acta de evidencia
 * (ISO/IEC 27001:2022 A.8.8 Gestión de vulnerabilidades técnicas).
 */

const CONFIG_PATH = '/deviceManagement/deviceConfigurations';
const GP_CONFIG_PATH = '/deviceManagement/groupPolicyConfigurations';
const GP_DEF_PATH = '/deviceManagement/groupPolicyDefinitions';
const GP_DEF_URL = (id: string) => `https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions('${id}')`;
const OFFICE_UPDATES_CATEGORY = /Microsoft Office 2016 \(Machine\)\\Updates$/i;

/** Rangos IPv4/IPv6 públicos (todo menos redes privadas, CGNAT, enlace local y loopback). */
export const PUBLIC_RANGES = [
  '1.0.0.0-9.255.255.255',
  '11.0.0.0-100.63.255.255',
  '100.128.0.0-126.255.255.255',
  '128.0.0.0-169.253.255.255',
  '169.255.0.0-172.15.255.255',
  '172.32.0.0-192.167.255.255',
  '192.169.0.0-223.255.255.255',
  '2000::-3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
];

// ---------- Plantillas administrativas de Office (ADMX) ----------

interface AdmxValue {
  /** Nombre de la directiva en la plantilla "Microsoft Office 2016 (Equipo) > Actualizaciones". */
  policy: string;
  /** Texto del único cuadro de texto de la directiva, si lo tiene. */
  text?: string;
}

async function findOfficeDefinition(ctx: Ctx, policy: string): Promise<any | undefined> {
  const match = (d: any) => d?.displayName === policy && d?.classType === 'machine' && OFFICE_UPDATES_CATEGORY.test(String(d?.categoryPath ?? ''));
  try {
    const found = await ctx.graph.list<any>(`${GP_DEF_PATH}?$filter=displayName eq '${encodeURIComponent(odataQuote(policy))}'`, { beta: true });
    const hit = found.find(match);
    if (hit) return hit;
  } catch {
    /* algunos tenants no aceptan $filter en esta colección: se recorre completa */
  }
  return (await ctx.graph.list<any>(GP_DEF_PATH, { beta: true, max: 20000 })).find(match);
}

async function definitionValue(ctx: Ctx, v: AdmxValue): Promise<Record<string, any>> {
  const def = await findOfficeDefinition(ctx, v.policy);
  if (!def) {
    throw new Error(`No se encontró la plantilla de Office "${v.policy}" en Intune (Plantillas administrativas > Microsoft Office 2016 (Equipo) > Actualizaciones)`);
  }
  const body: Record<string, any> = { enabled: true, 'definition@odata.bind': GP_DEF_URL(def.id) };
  if (v.text !== undefined) {
    const presentations = await ctx.graph.list<any>(`${GP_DEF_PATH}/${def.id}/presentations`, { beta: true });
    const box = presentations.find((p) => /TextBox$/i.test(String(p['@odata.type'] ?? '')));
    if (!box) throw new Error(`La plantilla "${v.policy}" no tiene un cuadro de texto para el valor`);
    body.presentationValues = [
      {
        '@odata.type': '#microsoft.graph.groupPolicyPresentationValueText',
        value: v.text,
        'presentation@odata.bind': `${GP_DEF_URL(def.id)}/presentations('${box.id}')`,
      },
    ];
  }
  return body;
}

/**
 * Perfil de plantillas administrativas idempotente: la huella de los valores deseados se guarda
 * en la descripción; si cambia, se reemplazan todos los valores del perfil.
 */
async function ensureAdmxProfile(ctx: Ctx, o: { name: string; description: string; values: AdmxValue[] }): Promise<PlanStep[]> {
  const fp = fingerprint(o.values);
  const description = `${o.description} [gob:${fp}]`;
  const label = 'Plantilla administrativa';
  const existing = await findByName(ctx, GP_CONFIG_PATH, o.name, { beta: true });
  if (existing && String(existing.description ?? '').includes(`[gob:${fp}]`)) {
    return [{ action: 'sin-cambios', target: `${label}: ${o.name}` }];
  }
  // Se resuelven las definiciones también en la previsualización: si faltan, se sabe antes de aplicar
  const values = await Promise.all(o.values.map((v) => definitionValue(ctx, v)));
  const payload = { displayName: o.name, description, definitionValues: values };
  if (ctx.dryRun) {
    const step: PlanStep = { action: existing ? 'actualizar' : 'crear', target: `${label}: ${o.name}`, payload };
    return existing ? [step] : [step, await assign(ctx, { path: GP_CONFIG_PATH, id: pending(o.name), targets: [allDevicesTarget], beta: true, label: o.name })];
  }
  let id: string;
  if (existing) {
    id = existing.id;
    const current = await ctx.graph.list<any>(`${GP_CONFIG_PATH}/${id}/definitionValues`, { beta: true });
    for (const dv of current) await ctx.graph.delete(`${GP_CONFIG_PATH}/${id}/definitionValues/${dv.id}`, { beta: true });
    await ctx.graph.patch(`${GP_CONFIG_PATH}/${id}`, { description }, { beta: true });
  } else {
    id = (await ctx.graph.post<any>(GP_CONFIG_PATH, { displayName: o.name, description }, { beta: true })).id;
  }
  for (const v of values) await ctx.graph.post(`${GP_CONFIG_PATH}/${id}/definitionValues`, v, { beta: true });
  ctx.log(`${existing ? 'Reemplazada' : 'Creada'} ${label}: ${o.name}`);
  const steps: PlanStep[] = [
    { action: existing ? 'actualizar' : 'crear', target: `${label}: ${o.name}`, detail: existing ? 'Los valores deseados cambiaron' : undefined, payload },
  ];
  if (!existing) steps.push(await assign(ctx, { path: GP_CONFIG_PATH, id, targets: [allDevicesTarget], beta: true, label: o.name }));
  return steps;
}

// ---------- Verificación del parche (inventario de Intune) ----------

const parseBuild = (v: string) => {
  const m = String(v).match(/^16\.0\.(\d+)\.(\d+)/);
  return m ? { branch: Number(m[1]), rev: Number(m[2]) } : null;
};

/**
 * Compara una compilación de Office con las corregidas. Cada rama (tercer número) tiene su
 * compilación corregida; una rama más nueva que todas las listadas se considera corregida.
 */
export function patchState(version: string, fixed: string[]): 'corregido' | 'vulnerable' | 'no-verificable' {
  const b = parseBuild(version);
  const fixes = fixed.map(parseBuild).filter((f): f is { branch: number; rev: number } => Boolean(f));
  if (!b || !fixes.length) return 'no-verificable';
  const same = fixes.find((f) => f.branch === b.branch);
  if (same) return b.rev >= same.rev ? 'corregido' : 'vulnerable';
  if (b.branch > Math.max(...fixes.map((f) => f.branch))) return 'corregido';
  return 'vulnerable';
}

async function verifyOfficeBuilds(ctx: Ctx, cve: string, fixed: string[]): Promise<PlanStep[]> {
  let apps: any[];
  try {
    apps = await ctx.graph.list<any>('/deviceManagement/detectedApps?$select=id,displayName,version,deviceCount,platform', { max: 20000 });
  } catch (e: any) {
    return [{ action: 'aviso', target: `Verificación del parche ${cve}`, detail: `No se pudo leer el inventario de aplicaciones de Intune: ${e?.message ?? e}` }];
  }
  const office = apps.filter(
    (a) => /Microsoft 365 Apps|Microsoft Office|Office 16/i.test(String(a.displayName ?? '')) && /^16\.0\./.test(String(a.version ?? '')),
  );
  const total = office.reduce((n, a) => n + Number(a.deviceCount ?? 0), 0);
  if (!total) {
    return [
      {
        action: 'aviso',
        target: `Verificación del parche ${cve}`,
        detail: 'Intune no reporta equipos con Microsoft 365 Apps. Verifica la versión en los equipos no administrados (Archivo > Cuenta de Office > Acerca de Outlook).',
      },
    ];
  }
  const by = { corregido: 0, vulnerable: 0, 'no-verificable': 0 };
  const rows = office.map((a) => {
    const state = patchState(a.version, fixed);
    by[state] += Number(a.deviceCount ?? 0);
    return { state, line: `${a.version} (${a.displayName}): ${a.deviceCount} equipo(s)` };
  });
  const steps: PlanStep[] = [
    {
      action: by.vulnerable || by['no-verificable'] ? 'aviso' : 'sin-cambios',
      target: `Verificación del parche ${cve}: ${by.corregido} de ${total} instalaciones de Office corregidas`,
      detail: `Inventario de Intune (solo equipos administrados). Compilaciones corregidas de referencia: ${fixed.join(', ') || '(sin definir)'}.`,
    },
  ];
  for (const state of ['vulnerable', 'no-verificable'] as const) {
    const list = rows.filter((r) => r.state === state).map((r) => r.line);
    if (list.length) {
      steps.push({
        action: 'aviso',
        target: state === 'vulnerable' ? `Sin parche: ${by.vulnerable} instalación(es)` : `Sin verificar: ${by['no-verificable']} instalación(es)`,
        detail: list.slice(0, 15).join(' · ') + (list.length > 15 ? ' …' : ''),
      });
    }
  }
  return steps;
}

// ---------- Playbooks ----------

const plusDays = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, d };
};
/** "Update Deadline" de Office usa el formato MM/DD/YYYY HH:MM. */
const officeDeadline = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y} 18:00`;
};

export const vulnerabilityPlaybooks: Playbook[] = [
  {
    id: 'cve-2026-124194-outlook-ntlm',
    title: 'Respuesta CVE-2026-124194: fuga de hash NTLM en Outlook',
    pillar: 'defender',
    engine: 'graph',
    tiles: ['vulnerability-management', 'm365-apps-business', 'windows-firewall'],
    summary:
      'Mitiga la vulnerabilidad de Outlook explotada activamente (un mensaje manipulado envía el hash NTLMv2 del usuario a un servidor externo): fuerza la actualización de Microsoft 365 Apps, bloquea SMB saliente hacia internet, audita o bloquea NTLM saliente y verifica qué equipos quedaron con el parche.',
    changes: [
      'Plantilla administrativa de Office: actualizaciones automáticas activas, sin opción de desactivarlas y con fecha límite de instalación',
      'Regla de firewall de Windows: bloquea TCP 445 (SMB) saliente hacia direcciones públicas, sin afectar servidores de archivos internos',
      'Restricción de NTLM saliente hacia servidores remotos (auditar o bloquear)',
      'Verificación del parche con el inventario de aplicaciones de Intune (antes y después, en el acta)',
    ],
    userImpact:
      'Office se actualiza y se reinicia antes de la fecha límite (se avisa al usuario). Deja de funcionar el acceso a carpetas compartidas por SMB en internet (poco habitual). En modo "bloquear", las aplicaciones antiguas que dependan de NTLM hacia otros servidores pueden fallar: por eso el valor por defecto es "auditar".',
    risk: 'medio',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    experimental: true,
    advisory: {
      id: 'CVE-2026-124194',
      title: 'Microsoft Outlook: suplantación con fuga de hash NTLMv2',
      cvss: 6.5,
      exploited: true,
      published: '2026-11-10',
      kevDue: '2026-11-24',
      affected: 'Outlook de escritorio en Microsoft 365 Apps (Business y Enterprise), Office LTSC 2021 y 2024',
      url: 'https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-124194',
    },
    params: [
      {
        key: 'deadline',
        label: 'Fecha límite de instalación de Office (AAAA-MM-DD)',
        type: 'text',
        default: '',
        help: 'Vacío = 3 días desde el primer despliegue. CISA fijó el 24-11-2026 como plazo de corrección.',
      },
      {
        key: 'smbScope',
        label: 'Bloquear SMB (TCP 445) saliente hacia',
        type: 'select',
        default: 'internet',
        options: [
          { value: 'internet', label: 'Internet (direcciones públicas)' },
          { value: 'todo', label: 'Cualquier destino (sin servidores de archivos internos)' },
          { value: 'no', label: 'No crear la regla' },
        ],
      },
      {
        key: 'ntlm',
        label: 'NTLM saliente hacia servidores remotos',
        type: 'select',
        default: 'auditar',
        options: [
          { value: 'auditar', label: 'Auditar (registra, no bloquea)' },
          { value: 'bloquear', label: 'Bloquear (probar antes en DEV/POC)' },
          { value: 'no', label: 'No cambiar' },
        ],
      },
      {
        key: 'fixedBuilds',
        label: 'Compilaciones de Office corregidas (una por línea)',
        type: 'list',
        default: ['16.0.14334.21048', '16.0.17932.21140'],
        help: 'Valores de fuentes públicas: confírmalos en la ficha del CVE en MSRC según tu canal de actualización.',
      },
    ],
    presets: { estricto: { ntlm: 'bloquear' } },
    permissions: ['DeviceManagementConfiguration.ReadWrite.All', 'DeviceManagementManagedDevices.Read.All'],
    manualSteps: [
      {
        text: 'Confirma en MSRC las compilaciones corregidas para tu canal de Office y ajusta el parámetro si difieren.',
        url: 'https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-124194',
      },
      { text: 'Equipos no inscritos en Intune: pide a cada usuario Outlook > Archivo > Cuenta de Office > Opciones de actualización > Actualizar ahora.' },
      { text: 'Bloquea también TCP 445 saliente hacia internet en el firewall perimetral (cubre equipos no administrados).' },
      { text: 'Revisa en los registros del firewall conexiones salientes al puerto 445 hacia IP públicas desde el 10-11-2026; si hay, restablece la contraseña del usuario y revisa sus inicios de sesión en Entra ID.' },
      { text: 'Comunica a los usuarios que no abran archivos .msg ni adjuntos de mensajes inesperados hasta confirmar el parche.' },
    ],
    docsUrl: 'https://learn.microsoft.com/microsoft-365-apps/updates/configure-update-settings-microsoft-365-apps',
    run: async (ctx, p) => {
      const steps: PlanStep[] = [];
      const fixed = asList(p.fixedBuilds);
      const cve = 'CVE-2026-124194';

      // Estado del parche antes de aplicar (queda en la evidencia)
      steps.push(...(await verifyOfficeBuilds(ctx, cve, fixed)));

      // 1. Actualización forzada de Microsoft 365 Apps
      const name = `${PREFIX}-${cve}-Office-Actualizaciones`;
      let deadline = String(p.deadline ?? '').trim();
      if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error(`Fecha límite inválida: "${deadline}" (usa AAAA-MM-DD)`);
      if (!deadline) {
        // Se conserva la fecha del primer despliegue para que el playbook siga siendo idempotente
        const existing = await findByName(ctx, GP_CONFIG_PATH, name, { beta: true });
        deadline = String(existing?.description ?? '').match(/plazo (\d{4}-\d{2}-\d{2})/)?.[1] ?? plusDays(3).iso;
      }
      steps.push(
        ...(await ensureAdmxProfile(ctx, {
          name,
          description: `Respuesta ${cve}: actualizaciones de Microsoft 365 Apps obligatorias, plazo ${deadline}`,
          values: [
            { policy: 'Enable Automatic Updates' },
            { policy: 'Hide option to enable or disable updates' },
            { policy: 'Update Deadline', text: officeDeadline(deadline) },
          ],
        })),
      );

      // 2. Bloqueo de SMB saliente
      if (p.smbScope !== 'no') {
        const ruleName = `${PREFIX}-${cve}-Bloquear-SMB-saliente`;
        const r = await ensureObject(ctx, {
          path: CONFIG_PATH,
          name: ruleName,
          beta: true,
          label: 'Regla de firewall (protección de extremos)',
          body: {
            '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration',
            displayName: ruleName,
            description: `Respuesta ${cve}: impide que Windows envíe credenciales NTLM por SMB a servidores ${p.smbScope === 'todo' ? 'de cualquier red' : 'de internet'}.`,
            firewallRules: [
              {
                displayName: `${PREFIX} Bloquear SMB (TCP 445) saliente${p.smbScope === 'todo' ? '' : ' a internet'}`,
                description: `Mitigación ${cve}`,
                protocol: 6,
                remotePortRanges: ['445'],
                remoteAddressRanges: p.smbScope === 'todo' ? ['*'] : PUBLIC_RANGES,
                trafficDirection: 'out',
                action: 'blocked',
                profileTypes: 'domain,private,public',
              },
            ],
          },
        });
        steps.push(r.step);
        if (r.created) steps.push(await assign(ctx, { path: CONFIG_PATH, id: r.id, targets: [allDevicesTarget], beta: true, label: ruleName }));
      } else {
        steps.push({ action: 'aviso', target: 'Bloqueo de SMB saliente', detail: 'Omitido por parámetro: bloquéalo en el firewall perimetral.' });
      }

      // 3. NTLM saliente
      if (p.ntlm !== 'no') {
        const id = 'device_vendor_msft_policy_config_localpoliciessecurityoptions_networksecurity_restrictntlm_outgoingntlmtraffictoremoteservers';
        steps.push(
          ...(await ensureSettingsPolicy(ctx, {
            name: `${PREFIX}-${cve}-NTLM-saliente`,
            description: `Respuesta ${cve}: ${p.ntlm === 'bloquear' ? 'bloquea' : 'audita'} el tráfico NTLM saliente hacia servidores remotos`,
            targets: [allDevicesTarget],
            settings: [sc.choice(id, p.ntlm === 'bloquear' ? '2' : '1')],
          })),
        );
      }
      return steps;
    },
  },
];
