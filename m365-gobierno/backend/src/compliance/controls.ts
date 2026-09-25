import type { Pillar } from '../engine/types.js';

/** Controles del Anexo A de ISO/IEC 27001:2022 usados por los playbooks. */
export const ISO_CONTROLS: Record<string, string> = {
  '5.1': 'Políticas de seguridad de la información',
  '5.3': 'Segregación de funciones',
  '5.9': 'Inventario de información y otros activos asociados',
  '5.10': 'Uso aceptable de la información y otros activos asociados',
  '5.12': 'Clasificación de la información',
  '5.13': 'Etiquetado de la información',
  '5.14': 'Transferencia de información',
  '5.15': 'Control de acceso',
  '5.16': 'Gestión de identidades',
  '5.17': 'Información de autenticación',
  '5.18': 'Derechos de acceso',
  '5.23': 'Seguridad de la información en el uso de servicios en la nube',
  '5.26': 'Respuesta a incidentes de seguridad de la información',
  '5.28': 'Recolección de evidencia',
  '5.29': 'Seguridad de la información durante una disrupción',
  '5.33': 'Protección de registros',
  '5.34': 'Privacidad y protección de información de identificación personal (PII)',
  '5.36': 'Cumplimiento de políticas, reglas y normas de seguridad de la información',
  '5.37': 'Procedimientos operativos documentados',
  '6.2': 'Términos y condiciones de empleo',
  '6.3': 'Concientización, educación y capacitación en seguridad de la información',
  '6.7': 'Trabajo remoto',
  '7.10': 'Medios de almacenamiento',
  '8.1': 'Dispositivos de punto final de usuario',
  '8.2': 'Derechos de acceso privilegiado',
  '8.3': 'Restricción de acceso a la información',
  '8.5': 'Autenticación segura',
  '8.6': 'Gestión de la capacidad',
  '8.7': 'Protección contra malware',
  '8.8': 'Gestión de vulnerabilidades técnicas',
  '8.9': 'Gestión de la configuración',
  '8.10': 'Eliminación de información',
  '8.12': 'Prevención de fuga de datos',
  '8.13': 'Respaldo de la información',
  '8.15': 'Registro (logging)',
  '8.16': 'Actividades de monitoreo',
  '8.19': 'Instalación de software en sistemas operativos',
  '8.20': 'Seguridad de redes',
  '8.23': 'Filtrado web',
  '8.24': 'Uso de criptografía',
  '8.32': 'Gestión de cambios',
};

/**
 * Principios y deberes de la Ley 19.628 modificada por la Ley 21.719 (Chile) a los que
 * contribuye cada medida técnica. Las referencias son orientativas: validar con asesoría legal.
 */
export const LAW_DUTIES: Record<string, string> = {
  seguridad: 'Principio de seguridad y deber de adoptar medidas de seguridad apropiadas (art. 14 quinquies)',
  confidencialidad: 'Principio y deber de confidencialidad',
  responsabilidad: 'Principio de responsabilidad: capacidad de demostrar el cumplimiento',
  vulneraciones: 'Deber de reportar vulneraciones de seguridad (art. 14 sexies): detección y registro',
  proporcionalidad: 'Principio de proporcionalidad: datos y plazos de conservación limitados a lo necesario',
};

export const LAW_NAME = 'Ley N° 19.628 sobre protección de datos personales, modificada por la Ley N° 21.719';
export const LAW_DISCLAIMER =
  'Las referencias legales son orientativas y vinculan medidas técnicas con principios y deberes de la ley; su interpretación debe ser validada por la asesoría legal o el delegado de protección de datos de la organización.';

const ISO: Record<string, string[]> = {
  'entra-emergency-access': ['5.18', '8.2', '5.29'],
  'entra-authenticator': ['5.17', '8.5'],
  'entra-registration-campaign': ['5.17', '8.5'],
  'entra-tap': ['5.16', '5.17'],
  'entra-fido2': ['5.17', '8.5'],
  'entra-ca-admins-mfa': ['5.15', '8.2', '8.5'],
  'entra-ca-all-users-mfa': ['5.15', '8.5'],
  'entra-ca-block-legacy': ['5.15', '8.5'],
  'entra-ca-azure-mgmt': ['8.2', '8.5'],
  'entra-security-defaults': ['5.15', '8.9', '8.32'],
  'entra-named-locations': ['5.15'],
  'entra-ca-block-countries': ['5.15', '8.3'],
  'entra-ca-compliant-device': ['5.15', '6.7', '8.1'],
  'entra-ca-mobile-app-protection': ['6.7', '8.1', '8.12'],
  'entra-ca-unmanaged-session': ['5.15', '6.7', '8.3'],
  'entra-ca-register-security-info': ['5.17', '8.5'],
  'entra-authorization-hardening': ['5.15', '5.18', '5.23', '8.19'],
  'entra-password-protection': ['5.17', '8.5'],
  'entra-group-governance': ['5.9', '5.12', '5.18'],
  'entra-dynamic-groups': ['5.16', '5.18'],
  'entra-admin-units': ['5.3', '8.2'],
  'entra-branding': ['6.3'],
  'entra-sspr': ['5.17'],
  'entra-device-join': ['5.9', '8.1'],
  'entra-terms-of-use': ['5.10', '6.2'],
  'intune-compliance': ['5.36', '8.1', '8.9'],
  'intune-bitlocker': ['8.1', '8.24'],
  'intune-bitlocker-removable': ['7.10', '8.12', '8.24'],
  'intune-firewall': ['8.1', '8.9', '8.20'],
  'intune-laps': ['5.17', '8.2'],
  'intune-update-ring': ['8.8', '8.9', '8.32'],
  'intune-whfb': ['5.17', '8.5'],
  'intune-mam': ['6.7', '8.1', '8.12'],
  'intune-autopilot': ['5.9', '8.1', '8.9'],
  'intune-endpoint-analytics': ['8.6', '8.16'],
  'intune-autopatch': ['8.8', '8.32'],
  'defender-av': ['8.7'],
  'defender-asr': ['8.7', '8.19'],
  'defender-mde-onboarding': ['5.26', '8.7', '8.8', '8.16'],
  'defender-portal-settings': ['5.26', '8.7', '8.23'],
  'defender-safe-links': ['8.7', '8.23'],
  'defender-safe-attachments': ['8.7'],
  'defender-anti-phishing': ['5.14', '8.7'],
  'defender-outbound-forwarding': ['5.14', '8.12'],
  'exo-hardening': ['5.14', '8.5', '8.24'],
  'purview-audit': ['5.28', '8.15', '8.16'],
  'purview-labels': ['5.12', '5.13', '8.24'],
  'purview-dlp': ['5.14', '5.34', '8.12'],
  'purview-retention': ['5.33', '8.10'],
  'purview-archiving': ['5.33', '8.13'],
  'purview-message-encryption': ['5.14', '8.24'],
  'spo-sharing': ['5.14', '5.23', '8.3'],
  'purview-ediscovery-roles': ['5.3', '5.28', '8.2'],
};

const LAW_BY_PILLAR: Record<Pillar, string[]> = {
  entra: ['seguridad', 'confidencialidad'],
  intune: ['seguridad'],
  defender: ['seguridad', 'vulneraciones'],
  purview: ['confidencialidad', 'responsabilidad'],
};
const LAW_OVERRIDES: Record<string, string[]> = {
  'purview-retention': ['proporcionalidad', 'responsabilidad'],
  'purview-archiving': ['proporcionalidad', 'responsabilidad'],
  'purview-audit': ['responsabilidad', 'vulneraciones'],
  'purview-dlp': ['confidencialidad', 'seguridad', 'responsabilidad'],
  'purview-labels': ['confidencialidad', 'seguridad', 'responsabilidad'],
  'spo-sharing': ['confidencialidad', 'seguridad'],
  'defender-mde-onboarding': ['seguridad', 'vulneraciones', 'responsabilidad'],
};

export interface ComplianceRef {
  iso: { id: string; name: string }[];
  law: { id: string; name: string }[];
}

export function complianceFor(playbookId: string, pillar: Pillar): ComplianceRef {
  return {
    iso: (ISO[playbookId] ?? ['5.1']).map((id) => ({ id, name: ISO_CONTROLS[id] })),
    law: (LAW_OVERRIDES[playbookId] ?? LAW_BY_PILLAR[pillar]).map((id) => ({ id, name: LAW_DUTIES[id] })),
  };
}

export const MAPPED_PLAYBOOKS = Object.keys(ISO);
