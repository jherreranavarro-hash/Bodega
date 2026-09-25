import type { DeploymentRecord } from '../store.js';
import type { Params, Pillar, Profile } from '../engine/types.js';
import { PLAYBOOKS, getPlaybook } from '../playbooks/index.js';
import { normalizeParams } from '../engine/runner.js';
import type { ScanResult } from './scan.js';
import { checkValue, evaluateChecks, pillarScores, type MaturityCheck } from './maturity.js';

export interface Questionnaire {
  company: string;
  employees: number;
  industry: 'retail' | 'servicios' | 'financiero' | 'salud' | 'manufactura' | 'educacion' | 'publico' | 'tecnologia' | 'otro';
  countries: string[];
  byod: 'no' | 'movil' | 'todo';
  sensitiveData: ('personales' | 'tarjetas' | 'salud' | 'financieros' | 'propiedad')[];
  itTeam: 'interno' | 'externo' | 'ninguno';
  tolerance: 'baja' | 'media' | 'alta';
  frameworks: ('ley21719' | 'ley21663' | 'iso27001' | 'pci')[];
  onPremAD: boolean;
}

export const DEFAULT_QUESTIONNAIRE: Questionnaire = {
  company: '',
  employees: 50,
  industry: 'servicios',
  countries: ['CL'],
  byod: 'movil',
  sensitiveData: ['personales'],
  itTeam: 'externo',
  tolerance: 'media',
  frameworks: ['ley21719'],
  onPremAD: false,
};

export type Severity = 'critica' | 'alta' | 'media' | 'baja';

export interface Finding {
  id: string;
  severity: Severity;
  pillar: Pillar;
  title: string;
  detail: string;
  playbooks: string[];
}

export interface RecommendedItem {
  playbookId: string;
  priority: 'P1' | 'P2' | 'P3';
  phase: number;
  reason: string;
  params: Params;
}

export interface Recommendation {
  profile: Profile;
  profileReasons: string[];
  scores: { overall: number; pillars: Record<Pillar, number | null>; checks: MaturityCheck[] };
  findings: Finding[];
  items: RecommendedItem[];
  roadmap: { phase: number; name: string; description: string; playbooks: string[] }[];
}

export const PHASES = [
  { phase: 0, name: 'Fundamentos', description: 'Red de seguridad antes de cambiar nada: cuentas de emergencia, auditoría y grupos base.' },
  { phase: 1, name: 'Identidad segura', description: 'MFA, Acceso Condicional base y protección del correo. Máximo impacto, mínimo esfuerzo.' },
  { phase: 2, name: 'Dispositivos y datos base', description: 'Intune: cumplimiento, cifrado, antivirus, actualizaciones y uso compartido controlado.' },
  { phase: 3, name: 'Protección avanzada', description: 'Zero Trust por dispositivo, ASR, clasificación y DLP de la información.' },
  { phase: 4, name: 'Optimización', description: 'Delegación, experiencia de usuario y mejora continua.' },
];

const COUNTRY_SIT: Record<string, string> = {
  CL: 'Chile Identity Card Number',
  AR: 'Argentina National Identity (DNI) Number',
  BR: 'Brazil CPF Number',
  MX: 'Mexico Unique Population Registry Code (CURP)',
  US: 'U.S. Social Security Number (SSN)',
};

export function chooseProfile(q: Questionnaire): { profile: Profile; reasons: string[] } {
  let points = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    points += n;
    reasons.push(`${n > 0 ? '+' : ''}${n} · ${why}`);
  };
  const sensitive = q.sensitiveData.filter((d) => d !== 'personales' && d !== 'propiedad');
  if (sensitive.length) add(2, `maneja datos sensibles (${sensitive.join(', ')})`);
  else if (q.sensitiveData.includes('personales')) add(1, 'maneja datos personales');
  if (['financiero', 'salud', 'publico'].includes(q.industry)) add(2, `industria regulada (${q.industry})`);
  if (q.frameworks.length) add(Math.min(2, q.frameworks.length), `marcos normativos: ${q.frameworks.join(', ')}`);
  if (q.itTeam === 'ninguno') add(-2, 'sin equipo de TI para operar controles estrictos');
  if (q.itTeam === 'externo') add(-1, 'TI externalizada: preferir controles de bajo mantenimiento');
  if (q.tolerance === 'baja') add(-1, 'baja tolerancia al cambio de los usuarios');
  if (q.tolerance === 'alta') add(1, 'alta tolerancia al cambio');
  const profile: Profile = points >= 4 ? 'estricto' : points <= 0 ? 'esencial' : 'recomendado';
  return { profile, reasons };
}


export function recommend(
  scan: ScanResult,
  q: Questionnaire,
  deployments: Record<string, DeploymentRecord> = {},
  profileOverride?: Profile,
): Recommendation {
  const findings: Finding[] = [];
  const f = (id: string, severity: Severity, pillar: Pillar, title: string, detail: string, playbooks: string[]) =>
    findings.push({ id, severity, pillar, title, detail, playbooks });
  const deployed = (id: string) => deployments[id]?.status === 'ok';
  const checks = evaluateChecks(scan, deployments, q.byod !== 'no');

  // ---------- Hallazgos ----------
  if (scan.license && !scan.license.businessPremium) {
    f('license', 'alta', 'entra', 'No se detectó Microsoft 365 Business Premium', `SKUs detectados: ${scan.license.skus.join(', ') || 'ninguno'}. Varias políticas requieren Entra ID P1 e Intune.`, []);
  } else if (scan.license && scan.license.purchased - scan.license.assigned > 0) {
    f('license-unused', 'baja', 'entra', 'Licencias sin asignar', `${scan.license.purchased - scan.license.assigned} licencias Business Premium disponibles.`, []);
  }
  const hasMfa = scan.securityDefaults || scan.ca?.requireMfaAll;
  if (scan.securityDefaults === false && scan.ca && !scan.ca.requireMfaAll) {
    f('no-mfa', 'critica', 'entra', 'Ningún control exige MFA a todos los usuarios', 'Sin valores predeterminados de seguridad ni Acceso Condicional de MFA: una contraseña filtrada basta para entrar.', ['entra-emergency-access', 'entra-ca-admins-mfa', 'entra-ca-all-users-mfa', 'entra-ca-block-legacy']);
  }
  if (scan.securityDefaults) {
    f('security-defaults', 'media', 'entra', 'Valores predeterminados de seguridad activos', 'Dan MFA básico pero sin excepciones, sin control por dispositivo ni ubicación. Business Premium permite reemplazarlos por Acceso Condicional.', ['entra-ca-admins-mfa', 'entra-ca-all-users-mfa', 'entra-ca-block-legacy', 'entra-security-defaults']);
  }
  if (scan.ca && !scan.ca.blocksLegacy && !scan.securityDefaults) {
    f('legacy-auth', 'alta', 'entra', 'Autenticación heredada no bloqueada', 'POP/IMAP/SMTP AUTH permiten saltarse el MFA (password spray).', ['entra-ca-block-legacy', 'exo-hardening']);
  }
  if (scan.globalAdmins !== undefined) {
    if (scan.globalAdmins > 4) f('too-many-admins', 'alta', 'entra', `${scan.globalAdmins} administradores globales`, 'Microsoft recomienda menos de 5. Reasigna roles de menor privilegio (Exchange, Usuarios, Soporte).', ['entra-ca-admins-mfa']);
    if (scan.globalAdmins < 2) f('few-admins', 'media', 'entra', 'Menos de 2 administradores globales', 'Riesgo de quedar sin acceso. Crea cuentas de emergencia.', ['entra-emergency-access']);
  }
  if (scan.mfa && scan.mfa.pct < 90) {
    f('mfa-registration', scan.mfa.pct < 60 ? 'alta' : 'media', 'entra', `Solo ${scan.mfa.pct}% de los usuarios tiene MFA registrado`, `${scan.mfa.total - scan.mfa.registered} usuarios sin método MFA.`, ['entra-authenticator', 'entra-registration-campaign', 'entra-tap']);
  }
  if (scan.authorization?.legacyConsent) {
    f('user-consent', 'alta', 'entra', 'Usuarios pueden dar consentimiento a cualquier aplicación', 'Riesgo de "consent phishing": apps maliciosas con acceso al correo y archivos.', ['entra-authorization-hardening']);
  }
  if (scan.authorization?.usersCanCreateApps || scan.authorization?.guestInvites === 'everyone') {
    f('user-perms', 'media', 'entra', 'Permisos de usuario predeterminados amplios', 'Usuarios pueden registrar aplicaciones y/o cualquiera puede invitar invitados.', ['entra-authorization-hardening']);
  }
  if (scan.authMethods?.Sms === 'enabled') {
    f('sms', 'baja', 'entra', 'SMS habilitado como método MFA', 'SMS es vulnerable a SIM swapping. Migra a Authenticator y luego desactívalo.', ['entra-authenticator']);
  }
  if (scan.devices) {
    if (scan.devices.total === 0) {
      f('no-devices', 'alta', 'intune', 'Ningún dispositivo administrado por Intune', 'Los equipos acceden a datos de la empresa sin control. Habilita la inscripción automática.', ['entra-device-join', 'intune-compliance', 'intune-autopilot']);
    } else {
      const unencrypted = scan.devices.total - scan.devices.encrypted;
      if (unencrypted > 0) f('unencrypted', 'alta', 'intune', `${unencrypted} dispositivos sin cifrar`, 'Un equipo perdido expone toda su información.', ['intune-bitlocker', 'intune-compliance']);
      if (scan.devices.noncompliant > 0) f('noncompliant', 'media', 'intune', `${scan.devices.noncompliant} dispositivos no conformes`, 'Revisa el motivo en Intune antes de exigir cumplimiento en Acceso Condicional.', ['intune-compliance']);
    }
  }
  if (scan.intune && scan.intune.compliancePolicies === 0) {
    f('no-compliance', 'alta', 'intune', 'Sin políticas de cumplimiento', 'Sin ellas no se puede exigir "dispositivo conforme".', ['intune-compliance']);
  }
  if (scan.intune && scan.intune.appProtection === 0 && q.byod !== 'no') {
    f('no-mam', 'alta', 'intune', 'Correo corporativo en celulares personales sin protección', 'La empresa permite BYOD pero no hay protección de aplicaciones (MAM).', ['intune-mam', 'entra-ca-mobile-app-protection']);
  }
  if (scan.secureScore) {
    const s = scan.secureScore;
    if (s.pct < 60) f('secure-score', s.pct < 40 ? 'alta' : 'media', 'defender', `Secure Score ${s.pct}% (${s.current}/${s.max})`, 'Las acciones del plan recomendado suben este puntaje.', []);
  }
  const emailGaps = [
    ['safe-links', 'Safe Links'],
    ['safe-attachments', 'Safe Attachments'],
    ['anti-phishing', 'antiphishing avanzado'],
    ['forwarding', 'bloqueo de reenvío externo'],
  ].filter(([id]) => (checkValue(checks, id) ?? 0) < 1);
  if (emailGaps.length) {
    const unknown = emailGaps.every(([id]) => checkValue(checks, id) === null);
    f('email', unknown ? 'media' : 'alta', 'defender', unknown ? 'Protección avanzada de correo no verificable' : 'Protección avanzada de correo incompleta',
      unknown
        ? 'No se pudo leer Exchange Online PowerShell. Revisa "Áreas no evaluadas" o aplica los playbooks para asegurarla.'
        : `Por reforzar: ${emailGaps.map(([, n]) => n).join(', ')}.`,
      ['defender-safe-links', 'defender-safe-attachments', 'defender-anti-phishing', 'defender-outbound-forwarding']);
  }
  if (scan.sharepoint?.sharingCapability === 'externalUserAndGuestSharing') {
    const sens = q.sensitiveData.length > 0;
    f('anyone-links', sens ? 'alta' : 'media', 'purview', 'Enlaces anónimos "Cualquier persona" permitidos', 'Documentos pueden quedar accesibles sin iniciar sesión.', ['spo-sharing']);
  }
  if (q.sensitiveData.length && ((checkValue(checks, 'dlp') ?? 0) < 1 || (checkValue(checks, 'labels') ?? 0) < 1)) {
    f('data', q.frameworks.includes('ley21719') ? 'alta' : 'media', 'purview', (checkValue(checks, 'dlp') ?? 0) > 0 ? 'Protección de datos sensibles incompleta' : 'Datos sensibles sin clasificar ni proteger', `Declaraste manejar: ${q.sensitiveData.join(', ')}. DLP: ${checks.find((c) => c.id === 'dlp')?.detail ?? 'no evaluado'}. Etiquetas: ${checks.find((c) => c.id === 'labels')?.detail ?? 'no evaluado'}. ${q.frameworks.includes('ley21719') ? 'La Ley 21.719 exige medidas de seguridad proporcionales y trazabilidad.' : ''}`, ['purview-labels', 'purview-dlp', 'purview-retention']);
  }
  if ((checkValue(checks, 'audit') ?? 0) < 1) {
    f('audit', checkValue(checks, 'audit') === 0 ? 'alta' : 'media', 'purview', checkValue(checks, 'audit') === 0 ? 'Auditoría unificada desactivada' : 'Auditoría unificada por confirmar', 'Sin auditoría no es posible investigar un incidente.', ['purview-audit']);
  }

  // ---------- Puntajes ----------
  const pillars = pillarScores(checks);
  const valid = Object.values(pillars).filter((v): v is number => v !== null);
  const overall = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;

  // ---------- Perfil y plan ----------
  const chosen = chooseProfile(q);
  const profile = profileOverride ?? chosen.profile;
  const profileReasons = profileOverride && profileOverride !== chosen.profile
    ? [`Perfil elegido manualmente (el assessment sugería "${chosen.profile}")`, ...chosen.reasons]
    : chosen.reasons;

  const sevRank: Record<Severity, number> = { critica: 0, alta: 1, media: 2, baja: 3 };
  const findingFor = (id: string) =>
    findings.filter((x) => x.playbooks.includes(id)).sort((a, b) => sevRank[a.severity] - sevRank[b.severity])[0];

  const overrides = (id: string): Params => {
    const sd = Boolean(scan.securityDefaults);
    switch (id) {
      case 'entra-ca-all-users-mfa':
      case 'entra-ca-block-legacy':
        // Si hoy hay valores predeterminados, se reemplazan manteniendo la protección (aplicadas).
        return { state: sd || (q.tolerance !== 'baja' && (scan.mfa?.pct ?? 0) >= 80) ? 'enabled' : 'enabledForReportingButNotEnforced' };
      case 'entra-named-locations':
        return { countries: q.countries.length ? q.countries : ['CL'] };
      case 'entra-password-protection': {
        const words = q.company.toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter((w) => w.length >= 4 && !['spa', 'ltda', 'limitada'].includes(w));
        return { banned: [...new Set([...words, ...(getPlaybook(id)!.params[0].default as string[])])] };
      }
      case 'intune-compliance': {
        const os = Object.keys(scan.devices?.byOs ?? {}).map((o) => o.toLowerCase());
        const platforms = new Set<string>(['windows']);
        if (os.includes('ios') || os.includes('ipados') || q.byod !== 'no') platforms.add('ios');
        if (os.includes('android') || q.byod !== 'no') platforms.add('android');
        if (os.includes('macos')) platforms.add('macos');
        return { platforms: [...platforms] };
      }
      case 'purview-dlp': {
        const types = new Set<string>();
        for (const c of q.countries) if (COUNTRY_SIT[c.toUpperCase()]) types.add(COUNTRY_SIT[c.toUpperCase()]);
        if (q.sensitiveData.includes('tarjetas') || q.frameworks.includes('pci')) types.add('Credit Card Number');
        if (q.sensitiveData.includes('financieros')) {
          types.add('International Banking Account Number (IBAN)');
          types.add('SWIFT Code');
        }
        if (!types.size) types.add('Credit Card Number');
        return { types: [...types] };
      }
      default:
        return {};
    }
  };

  const items: RecommendedItem[] = [];
  for (const pb of PLAYBOOKS) {
    if (!pb.profiles.includes(profile)) continue;
    if (pb.id === 'entra-security-defaults' && !scan.securityDefaults) continue;
    const finding = findingFor(pb.id);
    const priority: RecommendedItem['priority'] =
      finding && sevRank[finding.severity] <= 1 ? 'P1' : pb.phase <= 1 ? 'P1' : pb.phase === 2 || finding ? 'P2' : 'P3';
    const params = normalizeParams(pb, overrides(pb.id), profile);
    if (pb.id === 'entra-password-protection' && q.onPremAD) params.onPremises = true;
    items.push({
      playbookId: pb.id,
      priority,
      phase: pb.phase,
      reason: finding ? `${finding.title}` : `Parte de la línea base "${profile}" (fase ${pb.phase}: ${PHASES[pb.phase].name})`,
      params,
    });
  }
  items.sort((a, b) => a.phase - b.phase || a.priority.localeCompare(b.priority));
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return {
    profile,
    profileReasons,
    scores: { overall, pillars, checks },
    findings,
    items,
    roadmap: PHASES.map((ph) => ({ ...ph, playbooks: items.filter((i) => i.phase === ph.phase).map((i) => i.playbookId) })),
  };
}
