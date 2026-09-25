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
export type CheckSource = 'Tenant · Graph' | 'Tenant · Exchange PowerShell' | 'Tenant · Purview PowerShell' | 'Tenant · Secure Score' | 'Desplegado por la app' | 'Contexto de la empresa';

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
  add('entra', 'mfa-enforced', 'MFA exigido a todos los usuarios', 'Una contraseña filtrada no basta para entrar.', 25,
    scan.securityDefaults === undefined && !scan.ca
      ? NE()
      : scan.ca?.requireMfaAll
        ? { value: 1, detail: 'Hay una política de Acceso Condicional aplicada que exige MFA a todos', source: 'Tenant · Graph' }
        : scan.securityDefaults
          ? { value: 0.8, detail: 'Cubierto por los valores predeterminados de seguridad (MFA básico, sin excepciones ni control por riesgo)', source: 'Tenant · Graph' }
          : { value: 0, detail: 'Ningún control exige MFA a todos los usuarios', source: 'Tenant · Graph' });
  add('entra', 'legacy-auth', 'Autenticación heredada bloqueada', 'POP/IMAP/SMTP AUTH permiten saltarse el MFA.', 15,
    !scan.ca && scan.securityDefaults === undefined
      ? NE()
      : scan.ca?.blocksLegacy || scan.securityDefaults
        ? { value: 1, detail: scan.ca?.blocksLegacy ? 'Política de Acceso Condicional que la bloquea' : 'Bloqueada por los valores predeterminados de seguridad', source: 'Tenant · Graph' }
        : { value: 0, detail: 'No hay política que la bloquee', source: 'Tenant · Graph' });
  add('entra', 'mfa-registration', 'Usuarios con MFA registrado (meta ≥ 90%)', 'Solo quien tiene un método registrado puede cumplir MFA.', 20,
    scan.mfa ? { value: Math.min(1, scan.mfa.pct / 90), detail: `${scan.mfa.registered} de ${scan.mfa.total} usuarios (${scan.mfa.pct}%)`, source: 'Tenant · Graph' } : NE());
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
  add('intune', 'enrolled', 'Dispositivos administrados por Intune', 'Sin inscripción no se pueden aplicar políticas.', 20,
    scan.devices ? { value: scan.devices.total > 0 ? 1 : 0, detail: `${scan.devices.total} dispositivos administrados`, source: 'Tenant · Graph' } : NE());
  add('intune', 'compliance-policies', 'Políticas de cumplimiento definidas', 'Base para exigir "dispositivo conforme".', 20,
    scan.intune ? { value: scan.intune.compliancePolicies > 0 ? 1 : 0, detail: `${scan.intune.compliancePolicies} políticas de cumplimiento`, source: 'Tenant · Graph' } : NE());
  add('intune', 'compliant', 'Dispositivos conformes (meta ≥ 90%)', 'Mide si los equipos cumplen la línea base.', 20,
    scan.devices?.total
      ? { value: Math.min(1, scan.devices.compliant / scan.devices.total / 0.9), detail: `${scan.devices.compliant} de ${scan.devices.total} conformes`, source: 'Tenant · Graph' }
      : NE('Sin dispositivos para evaluar'));
  add('intune', 'encrypted', 'Dispositivos cifrados (meta ≥ 95%)', 'Un equipo perdido sin cifrar expone toda su información.', 20,
    scan.devices?.total
      ? { value: Math.min(1, scan.devices.encrypted / scan.devices.total / 0.95), detail: `${scan.devices.encrypted} de ${scan.devices.total} cifrados`, source: 'Tenant · Graph' }
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
    const custom = enabledRules(exo.safeLinksRules);
    const preset = enabledRules(exo.presetRules);
    if (custom.length || preset.length) return { value: 1, detail: `Activo: ${list([...custom, ...preset].map((r) => r.Name))}`, source: 'Tenant · Exchange PowerShell' };
    if (exo.safeLinksPolicies.some((p) => /built-?in/i.test(p.Name))) return { value: 0.5, detail: 'Solo la protección integrada (Built-In) de Microsoft, sin política propia', source: 'Tenant · Exchange PowerShell' };
    return { value: 0, detail: 'Sin políticas activas', source: 'Tenant · Exchange PowerShell' };
  };
  const safeAttachments = (): CheckResult => {
    if (!exo?.safeAttachmentPolicies) return fallback('defender-safe-attachments', 'Safe Attachments');
    const custom = enabledRules(exo.safeAttachmentRules);
    const preset = enabledRules(exo.presetRules);
    if (custom.length || preset.length) return { value: 1, detail: `Activo: ${list([...custom, ...preset].map((r) => r.Name))}`, source: 'Tenant · Exchange PowerShell' };
    if (exo.safeAttachmentPolicies.some((p) => /built-?in/i.test(p.Name))) return { value: 0.5, detail: 'Solo la protección integrada (Built-In), sin política propia', source: 'Tenant · Exchange PowerShell' };
    return { value: 0, detail: 'Sin políticas activas', source: 'Tenant · Exchange PowerShell' };
  };
  const antiPhish = (): CheckResult => {
    if (!exo?.antiPhishPolicies) return fallback('defender-anti-phishing', 'Antiphishing');
    const strong = exo.antiPhishPolicies.filter((p) => p.Enabled !== false && (p.EnableMailboxIntelligenceProtection || p.EnableTargetedUserProtection));
    const presetOn = enabledRules(exo.presetRules).length > 0;
    if (strong.length || presetOn) return { value: 1, detail: `Protección contra suplantación activa: ${list(strong.map((p) => p.Name).concat(presetOn ? ['directiva preestablecida'] : []))}`, source: 'Tenant · Exchange PowerShell' };
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
    ipps?.dlpPolicies
      ? (() => {
          const on = ipps.dlpPolicies.filter((p) => p.Enabled !== false && p.Mode === 'Enable');
          const test = ipps.dlpPolicies.filter((p) => p.Enabled !== false && /^Test/i.test(p.Mode));
          const names = [...on.map((p) => `${p.Name} (aplicada)`), ...test.map((p) => `${p.Name} (simulación)`)];
          return {
            value: on.length ? 1 : test.length ? 0.6 : 0,
            detail: ipps.dlpPolicies.length ? `${ipps.dlpPolicies.length} directivas: ${list(names.length ? names : ipps.dlpPolicies.map((p) => `${p.Name} (${p.Mode})`))}` : 'Sin directivas DLP',
            source: 'Tenant · Purview PowerShell' as const,
          };
        })()
      : fallback('purview-dlp', 'DLP'));
  add('purview', 'labels', 'Etiquetas de confidencialidad publicadas', 'Clasifican la información y pueden cifrarla.', 20,
    ipps?.labels
      ? { value: ipps.labels.length ? (ipps.labelPolicies?.some((p) => p.Enabled !== false) ? 1 : 0.5) : 0, detail: ipps.labels.length ? `${ipps.labels.length} etiquetas (${list(ipps.labels.map((l) => l.DisplayName ?? l.Name))}); ${ipps.labelPolicies?.length ?? 0} directivas de publicación` : 'Sin etiquetas', source: 'Tenant · Purview PowerShell' }
      : scan.sensitivityLabels
        ? { value: scan.sensitivityLabels.length ? 1 : 0, detail: scan.sensitivityLabels.length ? `${scan.sensitivityLabels.length} etiquetas: ${list(scan.sensitivityLabels)}` : 'Sin etiquetas', source: 'Tenant · Graph' }
        : fallback('purview-labels', 'Etiquetas'));
  add('purview', 'retention', 'Retención de información', 'Conserva la información el tiempo que exige la ley.', 10,
    ipps?.retentionPolicies
      ? { value: ipps.retentionPolicies.some((p) => p.Enabled !== false) ? 1 : 0, detail: ipps.retentionPolicies.length ? `${ipps.retentionPolicies.length} directivas: ${list(ipps.retentionPolicies.map((p) => p.Name))}` : 'Sin directivas de retención', source: 'Tenant · Purview PowerShell' }
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
