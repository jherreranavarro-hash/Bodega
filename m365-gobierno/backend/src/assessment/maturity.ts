import type { Pillar } from '../engine/types.js';
import type { DeploymentRecord } from '../store.js';
import type { ScanResult } from './scan.js';

/**
 * Criterios de madurez. Cada criterio aporta su peso multiplicado por su cumplimiento (0 a 1).
 * La madurez del módulo = Σ(peso × cumplimiento) / Σ(peso de los criterios evaluables).
 * Los criterios que no se pudieron leer ("no evaluado") no suman ni restan.
 *
 * Fuente del dato: primero la configuración REAL del tenant (Graph / PowerShell / Secure Score);
 * lo desplegado por la aplicación solo se usa cuando el tenant no se pudo leer.
 */
export type CheckSource = 'Tenant · Graph' | 'Tenant · Registros de inicio de sesión' | 'Tenant · Exchange PowerShell' | 'Tenant · Purview PowerShell' | 'Tenant · Secure Score' | 'Desplegado por la app' | 'Contexto de la empresa';

export interface MaturityCheck {
  pillar: Pillar;
  id: string;
  label: string;
  why: string;
  weight: number;
  /** 0..1; null = no evaluado */
  value: number | null;
  detail: string;
  source: CheckSource | null;
}

type CheckResult = { value: number | null; detail: string; source: CheckSource | null };
const NE = (detail = 'No se pudo leer en el tenant'): CheckResult => ({ value: null, detail, source: null });

const enabledRules = (rules?: { Name: string; State: string }[]) => (rules ?? []).filter((r) => r.State === 'Enabled');
const list = (names: string[], max = 4) => (names.length > max ? `${names.slice(0, max).join(', ')} y ${names.length - max} más` : names.join(', '));


const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * MFA efectivo. Fuente principal: registros de inicio de sesión reales (¿la sesión exigió MFA?).
 * Si no se pudieron leer, se estima: (robusto 100% + solo teléfono 50%) × a quién se le exige.
 */
function mfaProtected(scan: ScanResult): CheckResult {
  const si = scan.signIns;
  if (si?.people) {
    const value = (si.allMfa + 0.5 * si.partialMfa) / si.people;
    const inactive = scan.users ? Math.max(0, scan.users.people - si.people) : 0;
    return {
      value,
      detail: `De ${si.people} personas que iniciaron sesión en los últimos ${si.days} días: ${si.allMfa} siempre con MFA exigido, ${si.partialMfa} solo a veces (50%) y ${si.noMfa} nunca${inactive ? ` (${inactive} personas sin inicios de sesión en el período no se consideran)` : ''}. Protección efectiva ≈ ${Math.round(value * 100)}%`,
      source: 'Tenant · Registros de inicio de sesión',
    };
  }
  const m = scan.mfa;
  if (!m?.total) return NE();
  const registeredFactor = (m.strong + 0.5 * m.weakOnly) / m.total;
  let enforcement = 0;
  let how = 'ninguna política lo exige';
  if (scan.ca?.requireMfaAll) {
    const excluded = scan.ca.mfaAllExcluded ?? 0;
    enforcement = Math.max(0, 1 - excluded / m.total);
    how = `Acceso Condicional lo exige a todos${excluded ? ` salvo ${excluded} excluidos` : ''}`;
  } else if (scan.securityDefaults) {
    enforcement = 0.5;
    how = 'solo valores predeterminados de seguridad (piden MFA únicamente en situaciones de riesgo: se estima 50%)';
  } else if (scan.ca === undefined && scan.securityDefaults === undefined) {
    return NE();
  }
  const value = registeredFactor * enforcement;
  return {
    value,
    detail: `ESTIMADO (no se pudieron leer los inicios de sesión): ${m.registered} de ${m.total} personas registradas (${m.strong} robusto, ${m.weakOnly} solo teléfono = 50%); ${how}. Protección ≈ ${Math.round(value * 100)}%`,
    source: 'Tenant · Graph',
  };
}

const OS = (o: string): string | null => (/windows/i.test(o) ? 'Windows' : /ios|ipad/i.test(o) ? 'iOS' : /android/i.test(o) ? 'Android' : /mac/i.test(o) ? 'macOS' : null);

function compliancePlatforms(scan: ScanResult): CheckResult {
  const inUse = [...new Set(Object.keys(scan.devices?.byOs ?? {}).map(OS).filter((x): x is string => Boolean(x)))];
  const covered = scan.intune?.compliancePlatforms ?? [];
  if (!inUse.length) return { value: covered.length ? 1 : 0, detail: covered.length ? `Políticas para: ${covered.join(', ')}` : 'Sin políticas de cumplimiento', source: 'Tenant · Graph' };
  const ok = inUse.filter((p) => covered.includes(p));
  const missing = inUse.filter((p) => !covered.includes(p));
  return {
    value: ok.length / inUse.length,
    detail: `${scan.intune?.compliancePolicies ?? 0} políticas; cubren ${ok.join(', ') || 'ninguna'} de las plataformas en uso (${inUse.join(', ')})${missing.length ? `; sin política: ${missing.join(', ')}` : ''}`,
    source: 'Tenant · Graph',
  };
}

/** Reglas activas: toda la organización = 100%; solo usuarios/grupos específicos = 50%. */
function ruleCoverage(rules: { Name: string; Scope?: string }[]): { value: number; detail: string } | null {
  if (!rules.length) return null;
  const org = rules.filter((r) => r.Scope !== 'usuarios');
  if (org.length) return { value: 1, detail: `Activo para toda la organización: ${list(org.map((r) => r.Name))}` };
  return { value: 0.5, detail: `Activo solo para usuarios o grupos específicos: ${list(rules.map((r) => r.Name))}` };
}

const WORKLOADS: [string, RegExp][] = [
  ['Exchange', /exchange/i],
  ['SharePoint', /sharepoint/i],
  ['OneDrive', /onedrive/i],
  ['Teams', /teams|skype/i],
];

/** DLP por carga de trabajo: aplicada = 100%, en simulación = 50%, sin directiva = 0%. */
function dlpCoverage(policies: { Name: string; Mode: string; Enabled?: boolean; Workload?: string }[]): CheckResult {
  const active = policies.filter((p) => p.Enabled !== false && p.Mode !== 'Disable');
  const parts = WORKLOADS.map(([name, re]) => {
    const on = active.filter((p) => p.Mode === 'Enable' && re.test(p.Workload ?? ''));
    const test = active.filter((p) => /^Test/i.test(p.Mode) && re.test(p.Workload ?? ''));
    return { name, score: on.length ? 1 : test.length ? 0.5 : 0, state: on.length ? 'aplicada' : test.length ? 'simulación' : 'sin DLP' };
  });
  const value = parts.reduce((a, x) => a + x.score, 0) / WORKLOADS.length;
  return {
    value,
    detail: `${policies.length} directivas (${list(policies.map((p) => `${p.Name}: ${p.Mode}`))}). Cobertura: ${parts.map((x) => `${x.name} ${x.state}`).join(' · ')}`,
    source: 'Tenant · Purview PowerShell',
  };
}

function labelCoverage(ipps: NonNullable<ScanResult['probe']>['ipps'] & object): CheckResult {
  const labels = ipps.labels ?? [];
  const policies = (ipps.labelPolicies ?? []).filter((p) => p.Enabled !== false);
  if (!labels.length) return { value: 0, detail: 'Sin etiquetas de confidencialidad', source: 'Tenant · Purview PowerShell' };
  const toAll = policies.some((p) => /(^|,)\s*All\s*(,|$)/i.test(p.Exchange ?? ''));
  const value = !policies.length ? 0.25 : toAll ? 1 : 0.5;
  return {
    value,
    detail: `${labels.length} etiquetas (${list(labels.map((l) => l.DisplayName ?? l.Name))}); ${
      !policies.length ? 'no están publicadas (25%)' : toAll ? 'publicadas a toda la organización' : 'publicadas solo a usuarios o grupos específicos (50%)'
    }`,
    source: 'Tenant · Purview PowerShell',
  };
}

function retentionCoverage(policies: { Name: string; Enabled?: boolean; Workload?: string }[]): CheckResult {
  const active = policies.filter((p) => p.Enabled !== false);
  if (!active.length) return { value: 0, detail: policies.length ? 'Directivas de retención deshabilitadas' : 'Sin directivas de retención', source: 'Tenant · Purview PowerShell' };
  const targets = WORKLOADS.slice(0, 3);
  const covered = targets.filter(([, re]) => active.some((p) => re.test(p.Workload ?? '')));
  const known = active.some((p) => p.Workload);
  return {
    value: known ? covered.length / targets.length : 1,
    detail: `${active.length} directivas activas (${list(active.map((p) => p.Name))})${known ? `; cubren ${covered.map(([n]) => n).join(', ') || 'ninguna'} de Exchange, SharePoint y OneDrive` : ''}`,
    source: 'Tenant · Purview PowerShell',
  };
}

export function evaluateChecks(scan: ScanResult, deployments: Record<string, DeploymentRecord>, byodAllowed: boolean): MaturityCheck[] {
  const deployed = (id: string) => deployments[id]?.status === 'ok';
  const exo = scan.probe?.exo;
  const ipps = scan.probe?.ipps;
  const cat = (name: string) => scan.secureScore?.categories?.[name];
  const fallback = (id: string, what: string): CheckResult =>
    deployed(id) ? { value: 1, detail: `${what} aplicado por esta aplicación`, source: 'Desplegado por la app' } : NE();

  const checks: MaturityCheck[] = [];
  const add = (pillar: Pillar, id: string, label: string, why: string, weight: number, r: CheckResult) =>
    checks.push({ pillar, id, label, why, weight, ...r });

  // ---------------- Entra ID ----------------
  add('entra', 'mfa-protected', 'Usuarios efectivamente protegidos por MFA', 'Cuenta a cada persona que tiene MFA registrado Y a la que una política se lo exige. Una contraseña filtrada no basta para entrar.', 30,
    mfaProtected(scan));
  add('entra', 'mfa-strong', 'Usuarios con método MFA robusto', 'Authenticator, FIDO2/passkey o Windows Hello resisten mejor el phishing que SMS o llamada.', 15,
    scan.mfa?.total
      ? { value: scan.mfa.strong / scan.mfa.total, detail: `${scan.mfa.strong} de ${scan.mfa.total} personas (${pct(scan.mfa.strong, scan.mfa.total)}%) con método robusto; ${scan.mfa.weakOnly} solo con SMS/teléfono; ${scan.mfa.total - scan.mfa.registered} sin ningún método`, source: 'Tenant · Graph' }
      : NE());
  add('entra', 'admins', 'Administradores globales entre 2 y 4', 'Menos privilegios permanentes reduce el impacto de una cuenta comprometida.', 10,
    scan.globalAdmins === undefined
      ? NE()
      : { value: scan.globalAdmins >= 2 && scan.globalAdmins <= 4 ? 1 : scan.globalAdmins <= 6 ? 0.5 : 0, detail: `${scan.globalAdmins} administradores globales`, source: 'Tenant · Graph' });
  add('entra', 'consent', 'Consentimiento de usuarios restringido', 'Evita que apps maliciosas obtengan acceso al correo y archivos ("consent phishing").', 10,
    scan.authorization
      ? { value: scan.authorization.legacyConsent ? 0 : 1, detail: scan.authorization.legacyConsent ? 'Usuarios pueden aceptar permisos de cualquier aplicación' : 'Consentimiento limitado', source: 'Tenant · Graph' }
      : NE());
  add('entra', 'user-apps', 'Usuarios no registran aplicaciones', 'Reduce aplicaciones no gobernadas en el directorio.', 5,
    scan.authorization ? { value: scan.authorization.usersCanCreateApps ? 0 : 1, detail: scan.authorization.usersCanCreateApps ? 'Permitido' : 'Bloqueado', source: 'Tenant · Graph' } : NE());
  add('entra', 'sms', 'SMS desactivado como método MFA', 'SMS es vulnerable a SIM swapping.', 5,
    scan.authMethods ? { value: scan.authMethods.Sms === 'enabled' ? 0 : 1, detail: `SMS: ${scan.authMethods.Sms ?? 'desconocido'}`, source: 'Tenant · Graph' } : NE());
  add('entra', 'locations', 'Ubicaciones con nombre definidas', 'Permite restringir accesos por país.', 5,
    scan.namedLocations === undefined ? NE() : { value: scan.namedLocations > 0 ? 1 : 0, detail: `${scan.namedLocations} ubicaciones`, source: 'Tenant · Graph' });
  add('entra', 'ss-identity', 'Secure Score · categoría Identidad', 'Medición de Microsoft sobre los controles de identidad.', 5,
    cat('Identity') ? { value: cat('Identity')!.pct / 100, detail: `${cat('Identity')!.pct}% de los puntos de Identidad`, source: 'Tenant · Secure Score' } : NE());

  // ---------------- Intune ----------------
  add('intune', 'enrolled', 'Cobertura de dispositivos administrados', 'Proporción de usuarios cuyo equipo está administrado. Sin inscripción no se aplica ninguna política.', 20,
    scan.devices && scan.users?.people
      ? { value: Math.min(1, scan.devices.total / scan.users.people), detail: `${scan.devices.total} dispositivos administrados para ${scan.users.people} personas (≈${Math.min(100, pct(scan.devices.total, scan.users.people))}%, estimando un equipo por persona)`, source: 'Tenant · Graph' }
      : NE());
  add('intune', 'compliance-policies', 'Plataformas cubiertas por políticas de cumplimiento', 'Cada sistema operativo en uso necesita su propia política.', 15,
    scan.intune ? compliancePlatforms(scan) : NE());
  add('intune', 'compliant', 'Dispositivos administrados que cumplen', 'Porcentaje real de equipos conformes (sin metas ni redondeos).', 20,
    scan.devices?.total
      ? { value: scan.devices.compliant / scan.devices.total, detail: `${scan.devices.compliant} de ${scan.devices.total} dispositivos administrados (${pct(scan.devices.compliant, scan.devices.total)}%)`, source: 'Tenant · Graph' }
      : NE('Sin dispositivos para evaluar'));
  add('intune', 'encrypted', 'Dispositivos administrados cifrados', 'Un equipo perdido sin cifrar expone toda su información.', 20,
    scan.devices?.total
      ? { value: scan.devices.encrypted / scan.devices.total, detail: `${scan.devices.encrypted} de ${scan.devices.total} dispositivos administrados (${pct(scan.devices.encrypted, scan.devices.total)}%)`, source: 'Tenant · Graph' }
      : NE('Sin dispositivos para evaluar'));
  add('intune', 'mam', 'Protección de apps móviles (MAM)', 'Protege el correo en celulares personales.', 10,
    scan.intune
      ? byodAllowed
        ? { value: scan.intune.appProtection > 0 ? 1 : 0, detail: `${scan.intune.appProtection} políticas de protección de aplicaciones`, source: 'Tenant · Graph' }
        : { value: 1, detail: 'No aplica: la empresa no permite dispositivos personales', source: 'Contexto de la empresa' }
      : NE());
  add('intune', 'ss-device', 'Secure Score · categoría Dispositivo', 'Medición de Microsoft sobre los controles de dispositivos.', 10,
    cat('Device') ? { value: cat('Device')!.pct / 100, detail: `${cat('Device')!.pct}% de los puntos de Dispositivo`, source: 'Tenant · Secure Score' } : NE());

  // ---------------- Defender ----------------
  const safeLinks = (): CheckResult => {
    if (!exo?.safeLinksPolicies) return fallback('defender-safe-links', 'Safe Links');
    const cov = ruleCoverage([...enabledRules(exo.safeLinksRules), ...enabledRules(exo.presetRules)]);
    if (cov) return { ...cov, source: 'Tenant · Exchange PowerShell' };
    if (exo.safeLinksPolicies.some((p) => /built-?in/i.test(p.Name))) return { value: 0.5, detail: 'Solo la protección integrada (Built-In) de Microsoft, sin política propia', source: 'Tenant · Exchange PowerShell' };
    return { value: 0, detail: 'Sin políticas activas', source: 'Tenant · Exchange PowerShell' };
  };
  const safeAttachments = (): CheckResult => {
    if (!exo?.safeAttachmentPolicies) return fallback('defender-safe-attachments', 'Safe Attachments');
    const cov = ruleCoverage([...enabledRules(exo.safeAttachmentRules), ...enabledRules(exo.presetRules)]);
    if (cov) return { ...cov, source: 'Tenant · Exchange PowerShell' };
    if (exo.safeAttachmentPolicies.some((p) => /built-?in/i.test(p.Name))) return { value: 0.5, detail: 'Solo la protección integrada (Built-In), sin política propia', source: 'Tenant · Exchange PowerShell' };
    return { value: 0, detail: 'Sin políticas activas', source: 'Tenant · Exchange PowerShell' };
  };
  const antiPhish = (): CheckResult => {
    if (!exo?.antiPhishPolicies) return fallback('defender-anti-phishing', 'Antiphishing');
    const strong = exo.antiPhishPolicies.filter((p) => p.Enabled !== false && (p.EnableMailboxIntelligenceProtection || p.EnableTargetedUserProtection));
    // La directiva predeterminada aplica a todos; las personalizadas, según el alcance de su regla
    if (strong.some((p) => p.IsDefault)) return { value: 1, detail: 'La directiva predeterminada (toda la organización) tiene protección contra suplantación', source: 'Tenant · Exchange PowerShell' };
    const cov = ruleCoverage([...enabledRules(exo.antiPhishRules).filter((r) => strong.some((p) => p.Name === r.Name)), ...enabledRules(exo.presetRules)]);
    if (cov) return { ...cov, source: 'Tenant · Exchange PowerShell' };
    return { value: 0.4, detail: 'Solo la directiva predeterminada, sin protección de usuarios/dominios ni inteligencia de buzón', source: 'Tenant · Exchange PowerShell' };
  };
  add('defender', 'safe-links', 'Safe Links (vínculos seguros)', 'Bloquea enlaces de phishing al momento del clic.', 15, safeLinks());
  add('defender', 'safe-attachments', 'Safe Attachments (datos adjuntos seguros)', 'Analiza adjuntos en un entorno aislado.', 15, safeAttachments());
  add('defender', 'anti-phishing', 'Antiphishing avanzado (suplantación)', 'Detecta correos que suplantan a ejecutivos o al dominio.', 15, antiPhish());
  add('defender', 'forwarding', 'Reenvío automático externo bloqueado', 'Evita la exfiltración de correo desde cuentas comprometidas.', 10,
    exo?.autoForwardingMode !== undefined
      ? { value: exo.autoForwardingMode === 'Off' ? 1 : exo.autoForwardingMode === 'Automatic' ? 0.7 : 0, detail: `Modo de reenvío: ${exo.autoForwardingMode}${exo.autoForwardingMode === 'Automatic' ? ' (Microsoft lo bloquea por defecto, pero no está fijado)' : ''}`, source: 'Tenant · Exchange PowerShell' }
      : fallback('defender-outbound-forwarding', 'Bloqueo de reenvío'));
  add('defender', 'mail-auth', 'SMTP AUTH deshabilitado y DKIM activo', 'Cierra un vector de password spray y autentica el correo saliente.', 5,
    exo?.smtpAuthDisabled !== undefined
      ? (() => {
          const custom = (exo.dkim ?? []).filter((d) => !/onmicrosoft\.com$/i.test(d.Domain));
          const dkimOk = custom.length === 0 || custom.every((d) => d.Enabled);
          return { value: (exo.smtpAuthDisabled ? 0.5 : 0) + (dkimOk ? 0.5 : 0), detail: `SMTP AUTH ${exo.smtpAuthDisabled ? 'deshabilitado' : 'habilitado'} · DKIM ${custom.length ? `${custom.filter((d) => d.Enabled).length}/${custom.length} dominios` : 'sin dominios propios'}`, source: 'Tenant · Exchange PowerShell' as const };
        })()
      : fallback('exo-hardening', 'Endurecimiento de Exchange'));
  add('defender', 'endpoint', 'Antivirus y reducción de superficie de ataque', 'Protección de nueva generación y reglas ASR en los equipos.', 15,
    deployed('defender-av')
      ? { value: deployed('defender-asr') ? 1 : 0.7, detail: `Política de antivirus${deployed('defender-asr') ? ' y reglas ASR' : ''} aplicadas por esta aplicación`, source: 'Desplegado por la app' }
      : cat('Device')
        ? { value: cat('Device')!.pct / 100, detail: `Estimado por Secure Score (Dispositivo): ${cat('Device')!.pct}%`, source: 'Tenant · Secure Score' }
        : NE());
  add('defender', 'ss-apps', 'Secure Score · categoría Aplicaciones (correo y colaboración)', 'Medición de Microsoft sobre Defender for Office 365 y Exchange.', 25,
    cat('Apps') ? { value: cat('Apps')!.pct / 100, detail: `${cat('Apps')!.pct}% de los puntos de Aplicaciones`, source: 'Tenant · Secure Score' }
      : scan.secureScore ? { value: scan.secureScore.pct / 100, detail: `Secure Score total ${scan.secureScore.pct}% (sin detalle por categoría)`, source: 'Tenant · Secure Score' } : NE());

  // ---------------- Purview ----------------
  add('purview', 'sharing', 'Sin enlaces anónimos en SharePoint/OneDrive', 'Documentos accesibles sin iniciar sesión son una fuga de datos.', 15,
    scan.sharepoint?.sharingCapability
      ? { value: scan.sharepoint.sharingCapability === 'externalUserAndGuestSharing' ? 0 : 1, detail: `Nivel: ${scan.sharepoint.sharingCapability}`, source: 'Tenant · Graph' }
      : NE());
  add('purview', 'audit', 'Auditoría unificada activa', 'Sin registros no es posible investigar un incidente ni demostrar cumplimiento.', 15,
    exo?.auditEnabled !== undefined
      ? { value: exo.auditEnabled ? 1 : 0, detail: exo.auditEnabled ? 'Activa' : 'Desactivada', source: 'Tenant · Exchange PowerShell' }
      : fallback('purview-audit', 'Auditoría'));
  add('purview', 'dlp', 'Prevención de pérdida de datos (DLP)', 'Detecta y bloquea el envío de datos sensibles fuera de la empresa.', 25,
    ipps?.dlpPolicies ? dlpCoverage(ipps.dlpPolicies) : fallback('purview-dlp', 'DLP'));
  add('purview', 'labels', 'Etiquetas de confidencialidad publicadas', 'Clasifican la información y pueden cifrarla.', 20,
    ipps?.labels
      ? labelCoverage(ipps)
      : scan.sensitivityLabels
        ? { value: scan.sensitivityLabels.length ? 1 : 0, detail: scan.sensitivityLabels.length ? `${scan.sensitivityLabels.length} etiquetas: ${list(scan.sensitivityLabels)}` : 'Sin etiquetas', source: 'Tenant · Graph' }
        : fallback('purview-labels', 'Etiquetas'));
  add('purview', 'retention', 'Retención de información', 'Conserva la información el tiempo que exige la ley.', 10,
    ipps?.retentionPolicies
      ? retentionCoverage(ipps.retentionPolicies)
      : scan.retentionLabels
        ? { value: scan.retentionLabels.length ? 0.6 : 0, detail: scan.retentionLabels.length ? `${scan.retentionLabels.length} etiquetas de retención (las directivas no son legibles vía Graph)` : 'Sin etiquetas de retención', source: 'Tenant · Graph' }
        : fallback('purview-retention', 'Retención'));
  add('purview', 'ss-data', 'Secure Score · categoría Datos', 'Medición de Microsoft sobre protección de la información.', 15,
    cat('Data') ? { value: cat('Data')!.pct / 100, detail: `${cat('Data')!.pct}% de los puntos de Datos`, source: 'Tenant · Secure Score' } : NE());

  return checks;
}

export function pillarScores(checks: MaturityCheck[]): Record<Pillar, number | null> {
  const out: Record<Pillar, number | null> = { entra: null, intune: null, defender: null, purview: null };
  for (const p of Object.keys(out) as Pillar[]) {
    const evaluated = checks.filter((c) => c.pillar === p && c.value !== null);
    const total = evaluated.reduce((a, c) => a + c.weight, 0);
    out[p] = total ? Math.round((evaluated.reduce((a, c) => a + c.weight * (c.value as number), 0) / total) * 100) : null;
  }
  return out;
}

/** Valor de un criterio (para hallazgos): null si no se pudo evaluar. */
export const checkValue = (checks: MaturityCheck[], id: string) => checks.find((c) => c.id === id)?.value ?? null;
