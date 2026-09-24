import type { Playbook } from '../engine/types.js';
import { PREFIX, allDevicesTarget, asList, ensureSettingsPolicy, psBool, psHash, psq, sc } from '../engine/helpers.js';

const EXO_REQ = ['Exchange Online: permiso Exchange.ManageAsApp + rol "Administrador de Exchange" (o "Administrador de seguridad") en la app'];

/** Política + regla de Defender for Office 365 / EOP aplicada a todos los dominios aceptados. */
function policyAndRule(kind: 'SafeLinks' | 'SafeAttachment' | 'AntiPhish', name: string, settings: Record<string, unknown>): string {
  return `$name = ${psq(name)}
$settings = ${psHash(settings)}
$domains = @((Get-AcceptedDomain).Name)
if (Get-${kind}Policy -Identity $name -ErrorAction SilentlyContinue) {
  Set-${kind}Policy -Identity $name @settings
  Write-Output "Política $name actualizada"
} else {
  New-${kind}Policy -Name $name @settings | Out-Null
  Write-Output "Política $name creada"
}
if (Get-${kind}Rule -Identity $name -ErrorAction SilentlyContinue) {
  Set-${kind}Rule -Identity $name -RecipientDomainIs $domains
  Write-Output "Regla $name actualizada ($($domains -join ', '))"
} else {
  New-${kind}Rule -Name $name -${kind}Policy $name -RecipientDomainIs $domains -Priority 0 | Out-Null
  Write-Output "Regla $name creada ($($domains -join ', '))"
}`;
}

const ASR_BASE = 'device_vendor_msft_policy_config_defender_attacksurfacereductionrules';
export const ASR_RULES: { id: string; label: string }[] = [
  { id: 'blockexecutablecontentfromemailclientandwebmail', label: 'Contenido ejecutable desde correo y webmail' },
  { id: 'blockallofficeapplicationsfromcreatingchildprocesses', label: 'Office creando procesos secundarios' },
  { id: 'blockofficeapplicationsfromcreatingexecutablecontent', label: 'Office creando contenido ejecutable' },
  { id: 'blockofficeapplicationsfrominjectingcodeintootherprocesses', label: 'Office inyectando código en otros procesos' },
  { id: 'blockjavascriptorvbscriptfromlaunchingdownloadedexecutablecontent', label: 'JS/VBS lanzando ejecutables descargados' },
  { id: 'blockexecutionofpotentiallyobfuscatedscripts', label: 'Scripts ofuscados' },
  { id: 'blockwin32apicallsfromofficemacros', label: 'Llamadas Win32 desde macros' },
  { id: 'blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem', label: 'Robo de credenciales desde LSASS' },
  { id: 'blockadobereaderfromcreatingchildprocesses', label: 'Adobe Reader creando procesos' },
  { id: 'blockofficecommunicationappfromcreatingchildprocesses', label: 'Outlook creando procesos secundarios' },
  { id: 'blockpersistencethroughwmieventsubscription', label: 'Persistencia vía WMI' },
  { id: 'blockuntrustedunsignedprocessesthatrunfromusb', label: 'Procesos no firmados desde USB' },
  { id: 'blockabuseofexploitedvulnerablesigneddrivers', label: 'Controladores firmados vulnerables' },
  { id: 'useadvancedprotectionagainstransomware', label: 'Protección avanzada contra ransomware' },
];

export const defenderPlaybooks: Playbook[] = [
  {
    id: 'defender-av',
    title: 'Antivirus de nueva generación (Microsoft Defender)',
    pillar: 'defender',
    engine: 'graph',
    tiles: ['defender-antivirus', 'next-gen-protection', 'block-at-first-sight', 'cross-platform'],
    summary: 'Configura Defender Antivirus con protección en la nube, bloqueo a primera vista y protección de red.',
    changes: [
      'Protección en tiempo real, de comportamiento y de scripts',
      'Protección en la nube nivel "Alto" + bloqueo a primera vista (50 s)',
      'Bloqueo de aplicaciones potencialmente no deseadas (PUA)',
      'Protección de red (bloquea sitios maliciosos)',
    ],
    userImpact: 'Ninguno para uso normal. Descargas sospechosas pueden tardar unos segundos en analizarse.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'networkProtection',
        label: 'Protección de red',
        type: 'select',
        default: '1',
        options: [
          { value: '1', label: 'Bloquear' },
          { value: '2', label: 'Solo auditar' },
        ],
      },
    ],
    permissions: ['DeviceManagementConfiguration.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/defender-endpoint/configure-block-at-first-sight-microsoft-defender-antivirus',
    run: (ctx, p) => {
      const d = 'device_vendor_msft_policy_config_defender';
      return ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-Defender-Antivirus`,
        description: 'Defender Antivirus de nueva generación',
        targets: [allDevicesTarget],
        settings: [
          sc.choice(`${d}_allowrealtimemonitoring`, '1'),
          sc.choice(`${d}_allowbehaviormonitoring`, '1'),
          sc.choice(`${d}_allowonaccessprotection`, '1'),
          sc.choice(`${d}_allowioavprotection`, '1'),
          sc.choice(`${d}_allowscriptscanning`, '1'),
          sc.choice(`${d}_allowarchivescanning`, '1'),
          sc.choice(`${d}_allowemailscanning`, '1'),
          sc.choice(`${d}_allowcloudprotection`, '1'),
          sc.choice(`${d}_cloudblocklevel`, '2'),
          sc.int(`${d}_cloudextendedtimeout`, 50),
          sc.choice(`${d}_submitsamplesconsent`, '1'),
          sc.choice(`${d}_puaprotection`, '1'),
          sc.choice(`${d}_enablenetworkprotection`, String(p.networkProtection)),
        ],
      });
    },
  },

  {
    id: 'defender-asr',
    title: 'Reglas de reducción de superficie de ataque (ASR)',
    pillar: 'defender',
    engine: 'graph',
    tiles: ['attack-surface-reduction', 'application-control'],
    summary: 'Bloquea las técnicas más usadas por ransomware: macros maliciosas, robo de credenciales, scripts ofuscados.',
    changes: ASR_RULES.map((r) => r.label),
    userImpact:
      'En modo auditoría no hay impacto. En modo bloqueo, algunas macros o herramientas legítimas podrían requerir exclusión.',
    risk: 'medio',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'mode',
        label: 'Modo',
        type: 'select',
        default: 'audit',
        options: [
          { value: 'audit', label: 'Auditoría (recomendado las primeras 2-4 semanas)' },
          { value: 'warn', label: 'Advertir (el usuario puede continuar)' },
          { value: 'block', label: 'Bloquear' },
        ],
      },
    ],
    presets: { estricto: { mode: 'block' } },
    permissions: ['DeviceManagementConfiguration.ReadWrite.All'],
    dependsOn: ['defender-av'],
    docsUrl: 'https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-rules-reference',
    run: (ctx, p) => {
      // "warn" no está soportado en algunas reglas: se usa "block" en esas
      const noWarn = new Set(['blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem', 'blockpersistencethroughwmieventsubscription']);
      return ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-ASR`,
        description: `Reglas ASR en modo ${p.mode}`,
        targets: [allDevicesTarget],
        settings: [
          sc.group(
            ASR_BASE,
            ASR_RULES.map((r) => sc.choice(`${ASR_BASE}_${r.id}`, p.mode === 'warn' && noWarn.has(r.id) ? 'block' : String(p.mode))),
          ),
        ],
      });
    },
  },

  {
    id: 'defender-mde-onboarding',
    title: 'Incorporar equipos a Defender for Business (EDR)',
    pillar: 'defender',
    engine: 'manual',
    tiles: ['edr', 'centralized-management', 'vulnerability-management', 'threat-analytics', 'mobile-threat-defence'],
    summary: 'Conecta Defender for Business con Intune para que todos los equipos queden protegidos con EDR automáticamente.',
    changes: ['Conexión Defender ↔ Intune', 'Incorporación automática de Windows, macOS, iOS y Android', 'Gestión de vulnerabilidades'],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Portal de Defender → Configuración → Puntos de conexión → Características avanzadas → "Conexión con Microsoft Intune" = Activado.',
        url: 'https://security.microsoft.com/securitysettings/endpoints/integration',
      },
      {
        text: 'Intune → Seguridad de puntos de conexión → Microsoft Defender para punto de conexión: activar conexión para Windows, macOS, iOS y Android.',
        url: 'https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/SecurityManagementMenu/~/atp',
      },
      {
        text: 'Intune → Seguridad de puntos de conexión → Detección y respuesta → Crear política "Incorporación automática desde el conector" para Todos los dispositivos.',
        url: 'https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/SecurityManagementMenu/~/edr',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/defender-business/mdb-onboard-devices',
  },

  {
    id: 'defender-portal-settings',
    title: 'Protección contra alteraciones, investigación automática y filtrado web',
    pillar: 'defender',
    engine: 'manual',
    tiles: ['tamper-protection', 'automated-investigations', 'web-content-filtering'],
    summary: 'Configuraciones del portal de Defender que no tienen API pública: se entregan paso a paso.',
    changes: [
      'Tamper protection a nivel de tenant',
      'Investigación y respuesta automática: corregir automáticamente',
      'Filtrado de contenido web por categorías (adultos, alto consumo, riesgo legal)',
    ],
    userImpact: 'Sitios de categorías bloqueadas mostrarán una página de bloqueo.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Defender → Configuración → Puntos de conexión → Características avanzadas: "Protección contra alteraciones" = Activado y "Investigación automatizada" = Activado.',
        url: 'https://security.microsoft.com/securitysettings/endpoints/integration',
      },
      {
        text: 'Defender → Configuración → Puntos de conexión → Corrección automatizada: nivel "Completo: corregir amenazas automáticamente".',
        url: 'https://security.microsoft.com/securitysettings/endpoints/automation',
      },
      {
        text: 'Defender → Configuración → Puntos de conexión → Filtrado de contenido web → Agregar directiva: bloquear Contenido para adultos y Riesgo legal.',
        url: 'https://security.microsoft.com/securitysettings/endpoints/web_content_filtering_policy',
      },
    ],
  },

  {
    id: 'defender-safe-links',
    title: 'Vínculos seguros (Safe Links)',
    pillar: 'defender',
    engine: 'exo',
    tiles: ['safe-links'],
    summary: 'Analiza cada enlace en el momento del clic (correo, Teams y Office) y bloquea sitios de phishing.',
    changes: ['Política y regla GOB-SafeLinks para todos los dominios', 'Sin opción de "continuar de todos modos"', 'Se registran los clics'],
    userImpact: 'Los enlaces se ven reescritos; los sitios maliciosos muestran una página de advertencia.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [{ key: 'allowClickThrough', label: 'Permitir continuar a sitio bloqueado', type: 'boolean', default: false }],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/defender-office-365/safe-links-about',
    script: (p) =>
      policyAndRule('SafeLinks', `${PREFIX}-SafeLinks`, {
        EnableSafeLinksForEmail: true,
        EnableSafeLinksForTeams: true,
        EnableSafeLinksForOffice: true,
        TrackClicks: true,
        AllowClickThrough: Boolean(p.allowClickThrough),
        ScanUrls: true,
        EnableForInternalSenders: true,
        DeliverMessageAfterScan: true,
        DisableUrlRewrite: false,
      }),
  },

  {
    id: 'defender-safe-attachments',
    title: 'Datos adjuntos seguros (Safe Attachments)',
    pillar: 'defender',
    engine: 'exo',
    tiles: ['safe-attachments'],
    summary: 'Abre los adjuntos en un entorno aislado antes de entregarlos; también protege SharePoint, OneDrive y Teams.',
    changes: ['Política GOB-SafeAttachments en modo Bloquear', 'Protección de archivos en SharePoint/OneDrive/Teams'],
    userImpact: 'Algunos correos con adjuntos pueden demorar unos minutos más.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/defender-office-365/safe-attachments-about',
    script: () =>
      `${policyAndRule('SafeAttachment', `${PREFIX}-SafeAttachments`, {
        Enable: true,
        Action: 'Block',
        QuarantineTag: 'AdminOnlyAccessPolicy',
        Redirect: false,
      })}
Set-AtpPolicyForO365 -EnableATPForSPOTeamsODB $true
Write-Output "Safe Attachments para SharePoint, OneDrive y Teams habilitado"`,
  },

  {
    id: 'defender-anti-phishing',
    title: 'Antiphishing avanzado (suplantación de identidad)',
    pillar: 'defender',
    engine: 'exo',
    tiles: ['advanced-anti-phishing', 'real-time-reports'],
    summary: 'Detecta correos que suplantan a ejecutivos o a tu dominio usando inteligencia de buzón.',
    changes: [
      'Protección de dominios propios y usuarios clave (gerencia, finanzas)',
      'Inteligencia de buzón y antisuplantación',
      'Consejos de seguridad al usuario (primer contacto, caracteres extraños)',
      'Umbral de phishing: agresivo',
    ],
    userImpact: 'Correos sospechosos van a cuarentena; verán avisos de seguridad en correos inusuales.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'protectedUsers',
        label: 'Usuarios a proteger contra suplantación ("Nombre;correo" por línea)',
        type: 'list',
        default: [],
        help: 'Ej: Gerente General;gerente@empresa.cl. Máximo 350.',
      },
      {
        key: 'threshold',
        label: 'Umbral de phishing',
        type: 'select',
        default: '2',
        options: [
          { value: '1', label: 'Estándar' },
          { value: '2', label: 'Agresivo' },
          { value: '3', label: 'Más agresivo' },
          { value: '4', label: 'El más agresivo' },
        ],
      },
    ],
    presets: { estricto: { threshold: '3' } },
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/defender-office-365/anti-phishing-policies-about',
    script: (p) => {
      const users = asList(p.protectedUsers).filter((u) => u.includes(';'));
      return policyAndRule('AntiPhish', `${PREFIX}-AntiPhishing`, {
        PhishThresholdLevel: Number(p.threshold),
        EnableMailboxIntelligence: true,
        EnableMailboxIntelligenceProtection: true,
        MailboxIntelligenceProtectionAction: 'Quarantine',
        EnableSpoofIntelligence: true,
        EnableOrganizationDomainsProtection: true,
        TargetedDomainProtectionAction: 'Quarantine',
        EnableTargetedUserProtection: users.length > 0,
        TargetedUsersToProtect: users.length ? users : undefined,
        TargetedUserProtectionAction: 'Quarantine',
        EnableFirstContactSafetyTips: true,
        EnableSimilarUsersSafetyTips: true,
        EnableSimilarDomainsSafetyTips: true,
        EnableUnusualCharactersSafetyTips: true,
        EnableUnauthenticatedSender: true,
        EnableViaTag: true,
        HonorDmarcPolicy: true,
      });
    },
  },

  {
    id: 'defender-outbound-forwarding',
    title: 'Bloquear reenvío automático externo',
    pillar: 'defender',
    engine: 'exo',
    tiles: ['exchange-online-protection'],
    summary: 'Impide que una cuenta comprometida reenvíe todo el correo a una casilla externa (técnica común de fraude).',
    changes: ['Directiva de correo no deseado saliente: reenvío automático = Desactivado'],
    userImpact: 'Las reglas de reenvío automático a direcciones externas dejarán de funcionar.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/defender-office-365/outbound-spam-policies-external-email-forwarding',
    script: () => `Set-HostedOutboundSpamFilterPolicy -Identity Default -AutoForwardingMode Off
Write-Output "Reenvío automático externo desactivado en la directiva saliente predeterminada"`,
  },

  {
    id: 'exo-hardening',
    title: 'Endurecimiento de Exchange Online',
    pillar: 'defender',
    engine: 'exo',
    tiles: ['exchange-online', 'exchange-online-protection'],
    summary: 'Desactiva SMTP AUTH heredado, marca correos externos en Outlook, fuerza autenticación moderna y activa DKIM.',
    changes: [
      'SMTP AUTH desactivado a nivel de organización',
      'Etiqueta "Externo" en correos de fuera de la empresa',
      'Autenticación moderna activada',
      'Firma DKIM en los dominios (si los CNAME ya están publicados en DNS)',
    ],
    userImpact: 'Verán la etiqueta "Externo" en Outlook. Equipos/escáneres que envían por SMTP AUTH deberán migrar.',
    risk: 'medio',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      { key: 'disableSmtpAuth', label: 'Desactivar SMTP AUTH', type: 'boolean', default: true },
      { key: 'externalTag', label: 'Etiquetar correos externos', type: 'boolean', default: true },
      { key: 'dkim', label: 'Habilitar DKIM', type: 'boolean', default: true },
    ],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/defender-office-365/email-authentication-dkim-configure',
    script: (p) => `Set-OrganizationConfig -OAuth2ClientProfileEnabled $true
Write-Output "Autenticación moderna habilitada"
Set-TransportConfig -SmtpClientAuthenticationDisabled ${psBool(p.disableSmtpAuth)}
Write-Output "SMTP AUTH deshabilitado: ${p.disableSmtpAuth ? 'sí' : 'no'}"
Set-ExternalInOutlook -Enabled ${psBool(p.externalTag)} | Out-Null
Write-Output "Etiqueta de correo externo: ${p.externalTag ? 'activada' : 'desactivada'}"
${
  p.dkim
    ? `foreach ($d in (Get-AcceptedDomain | Where-Object { $_.DomainName -notlike '*.onmicrosoft.com' })) {
  $cfg = Get-DkimSigningConfig -Identity $d.DomainName -ErrorAction SilentlyContinue
  if (-not $cfg) { $cfg = New-DkimSigningConfig -DomainName $d.DomainName -Enabled $false }
  if ($cfg.Enabled) { Write-Output "DKIM ya activo en $($d.DomainName)"; continue }
  try {
    Set-DkimSigningConfig -Identity $d.DomainName -Enabled $true -ErrorAction Stop
    Write-Output "DKIM activado en $($d.DomainName)"
  } catch {
    Write-Warning "DKIM pendiente en $($d.DomainName): publica en DNS los CNAME selector1 -> $($cfg.Selector1CNAME) y selector2 -> $($cfg.Selector2CNAME)"
  }
}`
    : ''
}`,
  },
];
