import type { Playbook } from '../engine/types.js';
import { PREFIX, asList, ensureSingleton, psArr, psHash, psq } from '../engine/helpers.js';

const EXO_REQ = ['Exchange Online: permiso Exchange.ManageAsApp + rol "Administrador de Exchange" en la app'];
const IPPS_REQ = ['Purview (Security & Compliance PowerShell): permiso Exchange.ManageAsApp + rol "Administrador de cumplimiento" en la app'];

export const SENSITIVE_TYPES = [
  { value: 'Chile Identity Card Number', label: 'RUT / cédula de identidad chilena' },
  { value: 'Credit Card Number', label: 'Tarjetas de crédito' },
  { value: 'International Banking Account Number (IBAN)', label: 'Cuentas bancarias IBAN' },
  { value: 'SWIFT Code', label: 'Código SWIFT' },
  { value: 'Argentina National Identity (DNI) Number', label: 'DNI Argentina' },
  { value: 'Brazil CPF Number', label: 'CPF Brasil' },
  { value: 'Mexico Unique Population Registry Code (CURP)', label: 'CURP México' },
  { value: 'U.S. Social Security Number (SSN)', label: 'SSN Estados Unidos' },
];

const DEFAULT_LABELS = [
  { name: 'Publico', display: 'Público', tooltip: 'Información que puede compartirse libremente fuera de la empresa.' },
  { name: 'UsoInterno', display: 'Uso interno', tooltip: 'Información para colaboradores. No compartir fuera de la empresa.' },
  { name: 'Confidencial', display: 'Confidencial', tooltip: 'Información sensible del negocio: solo personas que la necesitan.' },
  {
    name: 'AltamenteConfidencial',
    display: 'Altamente confidencial',
    tooltip: 'Datos personales, financieros o estratégicos. Se cifra: solo colaboradores pueden abrirlo.',
  },
];

export const purviewPlaybooks: Playbook[] = [
  {
    id: 'purview-audit',
    title: 'Auditoría unificada',
    pillar: 'purview',
    engine: 'exo',
    tiles: ['audit-standard', 'activity-reports', 'alert-policies', 'content-search'],
    summary: 'Registra quién hizo qué en Exchange, SharePoint, Teams y Entra ID. Imprescindible para investigar incidentes.',
    changes: ['Ingesta del registro de auditoría unificado activada', 'Auditoría de buzones activada a nivel de organización'],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 0,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/purview/audit-log-enable-disable',
    script: () => `if (-not (Get-AdminAuditLogConfig).UnifiedAuditLogIngestionEnabled) {
  Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true
  Write-Output "Auditoría unificada activada"
} else { Write-Output "Auditoría unificada ya estaba activa" }
if ((Get-OrganizationConfig).AuditDisabled) {
  Set-OrganizationConfig -AuditDisabled $false
  Write-Output "Auditoría de buzones activada"
} else { Write-Output "Auditoría de buzones ya estaba activa" }`,
  },

  {
    id: 'purview-labels',
    title: 'Etiquetas de confidencialidad',
    pillar: 'purview',
    engine: 'ipps',
    tiles: ['information-protection-m365', 'information-protection'],
    summary:
      'Crea la clasificación de la información (Público → Altamente confidencial) y la publica en Office, Outlook y Teams.',
    changes: [
      'Etiquetas: Público, Uso interno, Confidencial, Altamente confidencial',
      'Marca de agua "CONFIDENCIAL" en el pie de página',
      'Cifrado en "Altamente confidencial": solo usuarios de la empresa pueden abrir',
      'Directiva de publicación GOB-Etiquetas para todos',
    ],
    userImpact: 'Aparece el botón "Confidencialidad" en Word, Excel, PowerPoint y Outlook.',
    risk: 'medio',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'encryptTop', label: 'Cifrar "Altamente confidencial"', type: 'boolean', default: true },
      { key: 'footer', label: 'Pie de página en "Confidencial"', type: 'boolean', default: true },
    ],
    permissions: [],
    extraRequirements: IPPS_REQ,
    manualSteps: [
      {
        text: 'Opcional: en Purview → Protección de información → Directivas de publicación → GOB-Etiquetas define etiqueta predeterminada y "exigir justificación para bajar la etiqueta".',
        url: 'https://purview.microsoft.com/informationprotection/labelpolicies',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/purview/get-started-with-sensitivity-labels',
    script: (p, tenant) => {
      const domain = tenant.defaultDomain ?? tenant.initialDomain;
      const labels = DEFAULT_LABELS.map((l) => ({ ...l, name: `${PREFIX}-${l.name}` }));
      const lines = labels.map(
        (l) => `if (Get-Label -Identity ${psq(l.name)} -ErrorAction SilentlyContinue) {
  Set-Label -Identity ${psq(l.name)} -DisplayName ${psq(l.display)} -Tooltip ${psq(l.tooltip)}
  Write-Output "Etiqueta ${l.display} actualizada"
} else {
  New-Label -Name ${psq(l.name)} -DisplayName ${psq(l.display)} -Tooltip ${psq(l.tooltip)} | Out-Null
  Write-Output "Etiqueta ${l.display} creada"
}`,
      );
      if (p.footer) {
        lines.push(`Set-Label -Identity ${psq(`${PREFIX}-Confidencial`)} -ApplyContentMarkingFooterEnabled $true -ApplyContentMarkingFooterText 'CONFIDENCIAL' -ApplyContentMarkingFooterFontSize 10 -ApplyContentMarkingFooterFontColor '#C00000' -ApplyContentMarkingFooterAlignment Center
Write-Output "Pie de página aplicado a Confidencial"`);
      }
      if (p.encryptTop && domain) {
        lines.push(`Set-Label -Identity ${psq(`${PREFIX}-AltamenteConfidencial`)} -EncryptionEnabled $true -EncryptionProtectionType Template -EncryptionRightsDefinitions ${psq(`${domain}:VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL`)} -EncryptionOfflineAccessDays 7 -EncryptionContentExpiredOnDateInDaysOrNever Never
Write-Output "Cifrado aplicado a Altamente confidencial (${domain})"`);
      } else if (p.encryptTop) {
        lines.push(`Write-Warning "No se conoce el dominio del tenant: configura ORG_DOMAIN para cifrar la etiqueta"`);
      }
      const policy = `${PREFIX}-Etiquetas`;
      lines.push(`$labels = ${psArr(labels.map((l) => l.name))}
if (Get-LabelPolicy -Identity ${psq(policy)} -ErrorAction SilentlyContinue) {
  Set-LabelPolicy -Identity ${psq(policy)} -AddLabels $labels
  Write-Output "Directiva ${policy} actualizada"
} else {
  New-LabelPolicy -Name ${psq(policy)} -Labels $labels -ExchangeLocation All -Comment 'Publicada por Gobierno M365' | Out-Null
  Write-Output "Directiva ${policy} publicada (puede tardar hasta 24 h en verse en Office)"
}`);
      return lines.join('\n');
    },
  },

  {
    id: 'purview-dlp',
    title: 'Prevención de pérdida de datos (DLP)',
    pillar: 'purview',
    engine: 'ipps',
    tiles: ['dlp', 'compliance-manager'],
    summary: 'Detecta RUT, tarjetas y cuentas bancarias en correos, Teams, SharePoint y OneDrive y evita que salgan de la empresa.',
    changes: [
      'Directiva GOB-DLP-Datos-Sensibles en Exchange, SharePoint, OneDrive y Teams',
      'Bajo volumen (1-9 coincidencias): aviso al usuario',
      'Alto volumen (10+): bloqueo del envío externo e informe de incidente',
    ],
    userImpact: 'Verán avisos (sugerencias de directiva) al compartir datos sensibles fuera de la empresa.',
    risk: 'medio',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'types',
        label: 'Tipos de información sensible',
        type: 'multiselect',
        default: ['Chile Identity Card Number', 'Credit Card Number'],
        options: SENSITIVE_TYPES,
      },
      {
        key: 'mode',
        label: 'Modo',
        type: 'select',
        default: 'TestWithNotifications',
        options: [
          { value: 'TestWithoutNotifications', label: 'Simulación silenciosa' },
          { value: 'TestWithNotifications', label: 'Simulación con avisos al usuario' },
          { value: 'Enable', label: 'Aplicada' },
        ],
        help: 'Recomendado: 2-4 semanas en simulación y revisar coincidencias en el Explorador de actividad.',
      },
      { key: 'reportTo', label: 'Correo para informes de incidente', type: 'text', default: 'SiteAdmin' },
    ],
    presets: { estricto: { mode: 'Enable' } },
    permissions: [],
    extraRequirements: IPPS_REQ,
    docsUrl: 'https://learn.microsoft.com/purview/dlp-create-deploy-policy',
    script: (p) => {
      const types = asList(p.types);
      if (!types.length) throw new Error('Selecciona al menos un tipo de información sensible');
      const name = `${PREFIX}-DLP-Datos-Sensibles`;
      const sit = (min: string, max?: string) =>
        `@(${types.map((t) => psHash({ Name: t, minCount: min, ...(max ? { maxCount: max } : {}) })).join(', ')})`;
      const low = `${name}-Bajo-Volumen`;
      const high = `${name}-Alto-Volumen`;
      const lowParams = `-ContentContainsSensitiveInformation ${sit('1', '9')} -AccessScope NotInOrganization -NotifyUser Owner -ReportSeverityLevel Low`;
      const highParams = `-ContentContainsSensitiveInformation ${sit('10')} -AccessScope NotInOrganization -BlockAccess $true -NotifyUser Owner -ReportSeverityLevel High -GenerateIncidentReport ${psq(p.reportTo || 'SiteAdmin')} -IncidentReportContent All`;
      return `$name = ${psq(name)}
if (Get-DlpCompliancePolicy -Identity $name -ErrorAction SilentlyContinue) {
  Set-DlpCompliancePolicy -Identity $name -Mode ${psq(p.mode)}
  Write-Output "Directiva $name actualizada (modo ${p.mode})"
} else {
  New-DlpCompliancePolicy -Name $name -Comment 'Datos personales y financieros (Gobierno M365)' -ExchangeLocation All -SharePointLocation All -OneDriveLocation All -TeamsLocation All -Mode ${psq(p.mode)} | Out-Null
  Write-Output "Directiva $name creada (modo ${p.mode})"
}
if (Get-DlpComplianceRule -Identity ${psq(low)} -ErrorAction SilentlyContinue) { Set-DlpComplianceRule -Identity ${psq(low)} ${lowParams} } else { New-DlpComplianceRule -Name ${psq(low)} -Policy $name ${lowParams} | Out-Null }
Write-Output "Regla de bajo volumen lista"
if (Get-DlpComplianceRule -Identity ${psq(high)} -ErrorAction SilentlyContinue) { Set-DlpComplianceRule -Identity ${psq(high)} ${highParams} } else { New-DlpComplianceRule -Name ${psq(high)} -Policy $name ${highParams} | Out-Null }
Write-Output "Regla de alto volumen lista"`;
    },
  },

  {
    id: 'purview-retention',
    title: 'Retención de información',
    pillar: 'purview',
    engine: 'ipps',
    tiles: ['ediscovery-standard', 'exchange-online-archiving'],
    summary: 'Conserva correos y documentos el tiempo que exige la ley (ej. 6 años tributarios) aunque un usuario los borre.',
    changes: [
      'Directiva GOB-Retencion-General: Exchange, SharePoint, OneDrive y grupos de M365',
      'Opcional: directiva separada para chats de Teams',
    ],
    userImpact: 'Ninguno visible: lo borrado se conserva en una biblioteca oculta para auditoría y eDiscovery.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'years', label: 'Años de retención', type: 'number', default: 6, min: 1, max: 30 },
      {
        key: 'action',
        label: 'Al terminar el período',
        type: 'select',
        default: 'Keep',
        options: [
          { value: 'Keep', label: 'Solo conservar' },
          { value: 'KeepAndDelete', label: 'Conservar y luego eliminar' },
        ],
      },
      { key: 'teams', label: 'Incluir chats de Teams', type: 'boolean', default: true },
    ],
    permissions: [],
    extraRequirements: IPPS_REQ,
    docsUrl: 'https://learn.microsoft.com/purview/create-retention-policies',
    script: (p) => {
      const days = Math.round(Number(p.years) * 365);
      const block = (name: string, locations: string) => `if (-not (Get-RetentionCompliancePolicy -Identity ${psq(name)} -ErrorAction SilentlyContinue)) {
  New-RetentionCompliancePolicy -Name ${psq(name)} ${locations} -Comment 'Gobierno M365' | Out-Null
  Write-Output "Directiva ${name} creada"
}
if (Get-RetentionComplianceRule -Identity ${psq(`${name}-Regla`)} -ErrorAction SilentlyContinue) {
  Set-RetentionComplianceRule -Identity ${psq(`${name}-Regla`)} -RetentionDuration ${days} -RetentionComplianceAction ${psq(p.action)}
  Write-Output "Regla ${name}-Regla actualizada (${days} días)"
} else {
  New-RetentionComplianceRule -Name ${psq(`${name}-Regla`)} -Policy ${psq(name)} -RetentionDuration ${days} -RetentionComplianceAction ${psq(p.action)} | Out-Null
  Write-Output "Regla ${name}-Regla creada (${days} días)"
}`;
      const parts = [
        block(`${PREFIX}-Retencion-General`, '-ExchangeLocation All -SharePointLocation All -OneDriveLocation All -ModernGroupLocation All'),
      ];
      if (p.teams) parts.push(block(`${PREFIX}-Retencion-Teams`, '-TeamsChatLocation All -TeamsChannelLocation All'));
      return parts.join('\n');
    },
  },

  {
    id: 'purview-archiving',
    title: 'Archivo en línea de Exchange',
    pillar: 'purview',
    engine: 'exo',
    tiles: ['exchange-online-archiving'],
    summary: 'Habilita el buzón de archivo (hasta 1,5 TB con archivo de expansión automática) para todos los usuarios.',
    changes: ['Buzón de archivo en todos los buzones de usuario que no lo tengan'],
    userImpact: 'Aparece la carpeta "Archivo local en línea" en Outlook.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/purview/enable-archive-mailboxes',
    script: () => `$mbx = Get-Mailbox -ResultSize Unlimited -Filter "ArchiveGuid -eq '00000000-0000-0000-0000-000000000000' -and RecipientTypeDetails -eq 'UserMailbox'"
foreach ($m in $mbx) {
  Enable-Mailbox -Identity $m.Identity -Archive | Out-Null
  Write-Output "Archivo habilitado: $($m.UserPrincipalName)"
}
Write-Output "Buzones procesados: $(@($mbx).Count)"`,
  },

  {
    id: 'purview-message-encryption',
    title: 'Cifrado de mensajes (OME)',
    pillar: 'purview',
    engine: 'exo',
    tiles: ['message-encryption'],
    summary: 'Permite enviar correos cifrados a cualquier destinatario, incluso fuera de Microsoft 365.',
    changes: ['Cifrado de mensajes de Office 365 activado', 'Regla: si el asunto contiene [cifrar] el correo se cifra'],
    userImpact: 'Escribiendo [cifrar] en el asunto, el correo se envía cifrado.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [{ key: 'keyword', label: 'Palabra clave en el asunto', type: 'text', default: '[cifrar]' }],
    permissions: [],
    extraRequirements: EXO_REQ,
    docsUrl: 'https://learn.microsoft.com/purview/set-up-new-message-encryption-capabilities',
    script: (p) => {
      const rule = `${PREFIX}-Cifrar-por-asunto`;
      return `if (-not (Get-IRMConfiguration).AzureRMSLicensingEnabled) {
  Set-IRMConfiguration -AzureRMSLicensingEnabled $true
  Write-Output "Licenciamiento de Azure RMS activado"
}
Set-IRMConfiguration -SimplifiedClientAccessEnabled $true -InternalLicensingEnabled $true
Write-Output "Cifrado de mensajes disponible en Outlook"
$rule = ${psq(rule)}
if (Get-TransportRule -Identity $rule -ErrorAction SilentlyContinue) {
  Set-TransportRule -Identity $rule -SubjectContainsWords ${psq(p.keyword)} -ApplyRightsProtectionTemplate 'Encrypt'
  Write-Output "Regla $rule actualizada"
} else {
  New-TransportRule -Name $rule -SubjectContainsWords ${psq(p.keyword)} -ApplyRightsProtectionTemplate 'Encrypt' | Out-Null
  Write-Output "Regla $rule creada"
}`;
    },
  },

  {
    id: 'spo-sharing',
    title: 'Uso compartido externo en SharePoint y OneDrive',
    pillar: 'purview',
    engine: 'graph',
    tiles: ['sharepoint-online', 'onedrive', 'loop-workspaces', 'teams-essentials'],
    summary: 'Define hasta dónde se puede compartir hacia fuera: elimina los enlaces "cualquier persona" anónimos.',
    changes: [
      'Nivel máximo de uso compartido externo del tenant',
      'Invitados no pueden volver a compartir',
      'Retención de OneDrive de usuarios eliminados',
    ],
    userImpact: 'No se podrán crear enlaces anónimos; compartir con externos requerirá que inicien sesión.',
    risk: 'medio',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'sharing',
        label: 'Uso compartido externo',
        type: 'select',
        default: 'externalUserSharingOnly',
        options: [
          { value: 'externalUserAndGuestSharing', label: 'Cualquier persona (enlaces anónimos)' },
          { value: 'externalUserSharingOnly', label: 'Invitados nuevos y existentes (con inicio de sesión)' },
          { value: 'existingExternalUserSharingOnly', label: 'Solo invitados existentes' },
          { value: 'disabled', label: 'Solo personas de la organización' },
        ],
      },
      { key: 'orphanDays', label: 'Días que se conserva el OneDrive de un usuario eliminado', type: 'number', default: 365, min: 30, max: 3650 },
    ],
    presets: { estricto: { sharing: 'existingExternalUserSharingOnly' } },
    permissions: ['SharePointTenantSettings.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/sharepoint/turn-external-sharing-on-or-off',
    run: async (ctx, p) => [
      await ensureSingleton(ctx, {
        path: '/admin/sharepoint/settings',
        label: 'Configuración de SharePoint del tenant',
        desired: {
          sharingCapability: p.sharing,
          isResharingByExternalUsersEnabled: false,
          deletedUserPersonalSiteRetentionPeriodInDays: Number(p.orphanDays),
        },
      }),
    ],
  },

  {
    id: 'purview-ediscovery-roles',
    title: 'Roles de eDiscovery y búsqueda de contenido',
    pillar: 'purview',
    engine: 'manual',
    tiles: ['ediscovery-standard', 'content-search'],
    summary: 'Define quién puede buscar y exportar información para investigaciones o requerimientos legales.',
    changes: ['Grupo de roles "Administrador de eDiscovery" con las personas autorizadas'],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 4,
    profiles: ['recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Purview → Configuración → Roles y ámbitos → Grupos de roles → "eDiscovery Manager": agrega solo a Legal/Cumplimiento.',
        url: 'https://purview.microsoft.com/settings/purviewpermissions',
      },
    ],
  },
];

