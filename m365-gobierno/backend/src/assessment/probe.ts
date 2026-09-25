import type { PsKind } from '../powershell/runner.js';

/**
 * Lectura (SOLO LECTURA) de la configuración que Microsoft Graph no expone: Defender for Office 365,
 * auditoría y Exchange (vía Exchange Online PowerShell) y DLP, etiquetas y retención (vía Security &
 * Compliance PowerShell). Cada bloque falla de forma independiente.
 */

export interface ExoProbe {
  auditEnabled?: boolean;
  safeLinksPolicies?: { Name: string; EnableSafeLinksForEmail?: boolean; EnableSafeLinksForTeams?: boolean }[];
  safeLinksRules?: { Name: string; State: string }[];
  safeAttachmentPolicies?: { Name: string; Enable?: boolean; Action?: string }[];
  safeAttachmentRules?: { Name: string; State: string }[];
  antiPhishPolicies?: { Name: string; Enabled?: boolean; IsDefault?: boolean; EnableMailboxIntelligenceProtection?: boolean; EnableTargetedUserProtection?: boolean; EnableOrganizationDomainsProtection?: boolean }[];
  antiPhishRules?: { Name: string; State: string }[];
  presetRules?: { Name: string; State: string }[];
  autoForwardingMode?: string;
  smtpAuthDisabled?: boolean;
  dkim?: { Domain: string; Enabled: boolean }[];
  externalTagging?: boolean;
  errors?: Record<string, string>;
}

export interface IppsProbe {
  dlpPolicies?: { Name: string; Mode: string; Enabled?: boolean; Workload?: string }[];
  labels?: { Name: string; DisplayName?: string }[];
  labelPolicies?: { Name: string; Enabled?: boolean }[];
  retentionPolicies?: { Name: string; Enabled?: boolean; Mode?: string }[];
  errors?: Record<string, string>;
}

export interface ProbeResult {
  at: string;
  exo?: ExoProbe;
  ipps?: IppsProbe;
  errors: { area: string; message: string }[];
}

const MARK = '@@GOBJSON@@';

const block = (key: string, expr: string) =>
  `try { $r.${key} = ${expr} } catch { $e.${key} = $_.Exception.Message }`;

const arr = (cmd: string, props: string) => `@(${cmd} -ErrorAction Stop | Select-Object ${props})`;

export const EXO_PROBE = `$r = [ordered]@{}; $e = [ordered]@{}
${block('auditEnabled', '(Get-AdminAuditLogConfig -ErrorAction Stop).UnifiedAuditLogIngestionEnabled')}
${block('safeLinksPolicies', arr('Get-SafeLinksPolicy', 'Name,EnableSafeLinksForEmail,EnableSafeLinksForTeams'))}
${block('safeLinksRules', arr('Get-SafeLinksRule', 'Name,@{n="State";e={[string]$_.State}}'))}
${block('safeAttachmentPolicies', arr('Get-SafeAttachmentPolicy', 'Name,Enable,@{n="Action";e={[string]$_.Action}}'))}
${block('safeAttachmentRules', arr('Get-SafeAttachmentRule', 'Name,@{n="State";e={[string]$_.State}}'))}
${block('antiPhishPolicies', arr('Get-AntiPhishPolicy', 'Name,Enabled,IsDefault,EnableMailboxIntelligenceProtection,EnableTargetedUserProtection,EnableOrganizationDomainsProtection'))}
${block('antiPhishRules', arr('Get-AntiPhishRule', 'Name,@{n="State";e={[string]$_.State}}'))}
${block('presetRules', `@(@(Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue) + @(Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue) | Select-Object Name,@{n="State";e={[string]$_.State}})`)}
${block('autoForwardingMode', '[string](Get-HostedOutboundSpamFilterPolicy -Identity Default -ErrorAction Stop).AutoForwardingMode')}
${block('smtpAuthDisabled', '(Get-TransportConfig -ErrorAction Stop).SmtpClientAuthenticationDisabled')}
${block('dkim', arr('Get-DkimSigningConfig', 'Domain,Enabled'))}
${block('externalTagging', '[bool]((Get-ExternalInOutlook -ErrorAction Stop | Select-Object -First 1).Enabled)')}
$r.errors = $e
Write-Output ('${MARK}' + ($r | ConvertTo-Json -Depth 5 -Compress))`;

export const IPPS_PROBE = `$r = [ordered]@{}; $e = [ordered]@{}
${block('dlpPolicies', arr('Get-DlpCompliancePolicy', 'Name,@{n="Mode";e={[string]$_.Mode}},Enabled,@{n="Workload";e={[string]$_.Workload}}'))}
${block('labels', arr('Get-Label', 'Name,DisplayName'))}
${block('labelPolicies', arr('Get-LabelPolicy', 'Name,Enabled'))}
${block('retentionPolicies', arr('Get-RetentionCompliancePolicy', 'Name,Enabled,@{n="Mode";e={[string]$_.Mode}}'))}
$r.errors = $e
Write-Output ('${MARK}' + ($r | ConvertTo-Json -Depth 5 -Compress))`;

export function parseProbe<T>(lines: string[]): T {
  const line = lines.find((l) => l.startsWith(MARK));
  if (!line) throw new Error('El script no devolvió resultados');
  return JSON.parse(line.slice(MARK.length)) as T;
}

/** Datos de ejemplo para el modo simulación (una organización con algo de configuración previa). */
export function simulatedProbe(): ProbeResult {
  return {
    at: new Date().toISOString(),
    exo: {
      auditEnabled: true,
      safeLinksPolicies: [{ Name: 'Built-In Protection Policy', EnableSafeLinksForEmail: true }],
      safeLinksRules: [],
      safeAttachmentPolicies: [{ Name: 'Built-In Protection Policy', Enable: true, Action: 'Block' }],
      safeAttachmentRules: [],
      antiPhishPolicies: [{ Name: 'Office365 AntiPhish Default', Enabled: true, IsDefault: true, EnableMailboxIntelligenceProtection: false }],
      antiPhishRules: [],
      presetRules: [],
      autoForwardingMode: 'Automatic',
      smtpAuthDisabled: false,
      dkim: [{ Domain: 'contoso-demo.cl', Enabled: false }],
      externalTagging: false,
    },
    ipps: {
      dlpPolicies: [
        { Name: 'Datos financieros Chile', Mode: 'Enable', Enabled: true, Workload: 'Exchange, SharePoint, OneDriveForBusiness' },
        { Name: 'Tarjetas de crédito (prueba)', Mode: 'TestWithNotifications', Enabled: true, Workload: 'Exchange' },
      ],
      labels: [],
      labelPolicies: [],
      retentionPolicies: [],
    },
    errors: [],
  };
}

export async function runProbes(run: (kind: PsKind, script: string) => Promise<string[]>): Promise<ProbeResult> {
  const result: ProbeResult = { at: new Date().toISOString(), errors: [] };
  await Promise.all([
    run('exo', EXO_PROBE)
      .then((l) => (result.exo = parseProbe<ExoProbe>(l)))
      .catch((e) => result.errors.push({ area: 'Exchange Online / Defender for Office 365', message: e?.message ?? String(e) })),
    run('ipps', IPPS_PROBE)
      .then((l) => (result.ipps = parseProbe<IppsProbe>(l)))
      .catch((e) => result.errors.push({ area: 'Purview (DLP, etiquetas, retención)', message: e?.message ?? String(e) })),
  ]);
  for (const [area, errs] of [
    ['Exchange Online', result.exo?.errors],
    ['Purview', result.ipps?.errors],
  ] as const) {
    for (const [k, v] of Object.entries(errs ?? {})) result.errors.push({ area: `${area}: ${k}`, message: String(v) });
  }
  return result;
}
