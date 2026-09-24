import type { Ctx, PlanStep, Playbook } from '../engine/types.js';
import {
  PREFIX,
  allDevicesTarget,
  allUsersTarget,
  asList,
  assign,
  ensureObject,
  ensureSettingsPolicy,
  ensureSingleton,
  groupTarget,
  pending,
  sc,
} from '../engine/helpers.js';

const COMPLIANCE_PATH = '/deviceManagement/deviceCompliancePolicies';
const CONFIG_PATH = '/deviceManagement/deviceConfigurations';

const blockAction = (graceHours: number) => [
  {
    ruleName: 'PasswordRequired',
    scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: graceHours, notificationTemplateId: '', notificationMessageCCList: [] }],
  },
];

async function ensureCompliance(ctx: Ctx, name: string, body: Record<string, any>, graceHours: number): Promise<PlanStep[]> {
  const r = await ensureObject(ctx, {
    path: COMPLIANCE_PATH,
    name,
    body: { ...body, displayName: name, scheduledActionsForRule: blockAction(graceHours) },
    updateOmit: ['scheduledActionsForRule'],
    label: 'Política de cumplimiento',
  });
  const steps = [r.step];
  if (r.created) steps.push(await assign(ctx, { path: COMPLIANCE_PATH, id: r.id, targets: [allUsersTarget], label: name }));
  return steps;
}

const intuneBase = {
  pillar: 'intune' as const,
  engine: 'graph' as const,
  permissions: ['DeviceManagementConfiguration.ReadWrite.All'],
};

export const intunePlaybooks: Playbook[] = [
  {
    ...intuneBase,
    id: 'intune-compliance',
    title: 'Políticas de cumplimiento de dispositivos',
    tiles: ['device-management', 'manage-by-mdm', 'basic-mobility-security'],
    summary:
      'Define qué es un equipo "sano": cifrado, antivirus, firewall, sistema actualizado. Es la base del Acceso Condicional por dispositivo.',
    changes: [
      'Windows: BitLocker, arranque seguro, Defender activo y actualizado, firewall, versión mínima',
      'iOS / Android: PIN, sin jailbreak/root, cifrado, versión mínima',
      'macOS: FileVault, firewall, SIP, versión mínima',
      'Dispositivos sin política asignada se marcan como NO conformes',
    ],
    userImpact: 'Los equipos que no cumplan aparecerán como no conformes; si CA05 está aplicada, perderán acceso tras el período de gracia.',
    risk: 'medio',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'platforms',
        label: 'Plataformas',
        type: 'multiselect',
        default: ['windows', 'ios', 'android', 'macos'],
        options: [
          { value: 'windows', label: 'Windows' },
          { value: 'ios', label: 'iOS / iPadOS' },
          { value: 'android', label: 'Android (perfil de trabajo)' },
          { value: 'macos', label: 'macOS' },
        ],
      },
      { key: 'windowsMinVersion', label: 'Windows: versión mínima', type: 'text', default: '10.0.19045' },
      { key: 'iosMinVersion', label: 'iOS: versión mínima', type: 'text', default: '17.0' },
      { key: 'androidMinVersion', label: 'Android: versión mínima', type: 'text', default: '12.0' },
      { key: 'macosMinVersion', label: 'macOS: versión mínima', type: 'text', default: '14.0' },
      { key: 'graceHours', label: 'Horas de gracia antes de marcar no conforme', type: 'number', default: 72, min: 0, max: 720 },
      {
        key: 'mdeRisk',
        label: 'Exigir riesgo de máquina "medio o inferior" (Defender for Business)',
        type: 'boolean',
        default: false,
        help: 'Requiere el conector Defender ↔ Intune activo.',
      },
      { key: 'secureByDefault', label: 'Marcar como no conformes los equipos sin política', type: 'boolean', default: true },
    ],
    presets: { estricto: { mdeRisk: true, graceHours: 24 }, esencial: { graceHours: 168 } },
    dependsOn: ['entra-device-join'],
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/device-compliance-get-started',
    run: async (ctx, p) => {
      const platforms = asList(p.platforms);
      const grace = Number(p.graceHours);
      const steps: PlanStep[] = [];
      if (platforms.includes('windows')) {
        steps.push(
          ...(await ensureCompliance(
            ctx,
            `${PREFIX}-Cumplimiento-Windows`,
            {
              '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
              description: 'Línea base de cumplimiento Windows (Gobierno M365)',
              bitLockerEnabled: true,
              secureBootEnabled: true,
              codeIntegrityEnabled: true,
              storageRequireEncryption: true,
              activeFirewallRequired: true,
              defenderEnabled: true,
              rtpEnabled: true,
              antivirusRequired: true,
              antiSpywareRequired: true,
              signatureOutOfDate: true,
              osMinimumVersion: String(p.windowsMinVersion),
              ...(p.mdeRisk ? { deviceThreatProtectionEnabled: true, deviceThreatProtectionRequiredSecurityLevel: 'medium' } : {}),
            },
            grace,
          )),
        );
      }
      if (platforms.includes('ios')) {
        steps.push(
          ...(await ensureCompliance(
            ctx,
            `${PREFIX}-Cumplimiento-iOS`,
            {
              '@odata.type': '#microsoft.graph.iosCompliancePolicy',
              description: 'Línea base de cumplimiento iOS (Gobierno M365)',
              passcodeRequired: true,
              passcodeBlockSimple: true,
              passcodeMinimumLength: 6,
              passcodeMinutesOfInactivityBeforeLock: 5,
              securityBlockJailbrokenDevices: true,
              osMinimumVersion: String(p.iosMinVersion),
            },
            grace,
          )),
        );
      }
      if (platforms.includes('android')) {
        steps.push(
          ...(await ensureCompliance(
            ctx,
            `${PREFIX}-Cumplimiento-Android`,
            {
              '@odata.type': '#microsoft.graph.androidWorkProfileCompliancePolicy',
              description: 'Línea base de cumplimiento Android perfil de trabajo (Gobierno M365)',
              passwordRequired: true,
              passwordMinimumLength: 6,
              passwordRequiredType: 'numericComplex',
              securityBlockJailbrokenDevices: true,
              storageRequireEncryption: true,
              securityRequireSafetyNetAttestationBasicIntegrity: true,
              osMinimumVersion: String(p.androidMinVersion),
            },
            grace,
          )),
        );
      }
      if (platforms.includes('macos')) {
        steps.push(
          ...(await ensureCompliance(
            ctx,
            `${PREFIX}-Cumplimiento-macOS`,
            {
              '@odata.type': '#microsoft.graph.macOSCompliancePolicy',
              description: 'Línea base de cumplimiento macOS (Gobierno M365)',
              systemIntegrityProtectionEnabled: true,
              storageRequireEncryption: true,
              firewallEnabled: true,
              passwordRequired: true,
              passwordMinimumLength: 8,
              osMinimumVersion: String(p.macosMinVersion),
            },
            grace,
          )),
        );
      }
      if (p.secureByDefault) {
        steps.push(
          await ensureSingleton(ctx, {
            path: '/deviceManagement',
            beta: true,
            label: 'Configuración de cumplimiento del tenant',
            desired: { settings: { secureByDefault: true } },
          }),
        );
      }
      return steps;
    },
  },

  {
    ...intuneBase,
    id: 'intune-bitlocker',
    title: 'Cifrado BitLocker silencioso',
    tiles: ['bitlocker'],
    summary: 'Cifra automáticamente el disco de los equipos Windows y guarda la clave de recuperación en Entra ID.',
    changes: ['Requiere cifrado del dispositivo', 'Cifrado silencioso (sin preguntar al usuario)', 'Rotación de clave de recuperación'],
    userImpact: 'Ninguno visible: el cifrado ocurre en segundo plano.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/encrypt-devices',
    run: (ctx) =>
      ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-BitLocker`,
        description: 'Cifrado BitLocker silencioso',
        targets: [allDevicesTarget],
        settings: [
          sc.choice('device_vendor_msft_bitlocker_requiredeviceencryption', '1'),
          sc.choice('device_vendor_msft_bitlocker_allowwarningforotherdiskencryption', '0', [
            sc.choice('device_vendor_msft_bitlocker_allowstandarduserencryption', '1'),
          ]),
          sc.choice('device_vendor_msft_bitlocker_configurerecoverypasswordrotation', '1'),
        ],
      }),
  },

  {
    ...intuneBase,
    id: 'intune-bitlocker-removable',
    title: 'BitLocker To Go (unidades USB)',
    tiles: ['bitlocker-to-go'],
    summary: 'Exige cifrar las unidades USB antes de poder escribir en ellas: evita fuga de datos por pendrives perdidos.',
    changes: ['Unidades extraíbles deben cifrarse para escritura'],
    userImpact: 'Al conectar un pendrive se pedirá cifrarlo antes de copiar archivos.',
    risk: 'medio',
    phase: 3,
    profiles: ['estricto'],
    experimental: true,
    params: [],
    docsUrl: 'https://learn.microsoft.com/windows/client-management/mdm/bitlocker-csp',
    run: (ctx) =>
      ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-BitLocker-USB`,
        description: 'Cifrado obligatorio de unidades extraíbles',
        targets: [allDevicesTarget],
        settings: [sc.choice('device_vendor_msft_bitlocker_removabledrivesrequireencryption', '1')],
      }),
  },

  {
    ...intuneBase,
    id: 'intune-firewall',
    title: 'Firewall de Windows',
    tiles: ['windows-firewall'],
    summary: 'Activa el firewall en todos los perfiles y bloquea conexiones entrantes no solicitadas.',
    changes: ['Firewall activo en perfiles dominio, privado y público', 'Entrante: bloquear; saliente: permitir'],
    userImpact: 'Ninguno para uso normal.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/endpoint-security-firewall-policy',
    run: (ctx) =>
      ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-Firewall`,
        description: 'Firewall de Windows en todos los perfiles',
        targets: [allDevicesTarget],
        settings: ['domainprofile', 'privateprofile', 'publicprofile'].map((profile) => {
          const base = `vendor_msft_firewall_mdmstore_${profile}`;
          return sc.choice(`${base}_enablefirewall`, 'true', [
            sc.choice(`${base}_defaultinboundaction`, '1'),
            sc.choice(`${base}_defaultoutboundaction`, '0'),
          ]);
        }),
      }),
  },

  {
    ...intuneBase,
    id: 'intune-laps',
    title: 'LAPS: contraseña de administrador local rotativa',
    tiles: ['laps'],
    summary: 'Cada equipo tiene una contraseña de administrador local única, que rota sola y queda en Entra ID.',
    changes: ['Respaldo de contraseña en Entra ID', 'Rotación cada N días', 'Longitud y complejidad', 'Rotación tras usarla'],
    userImpact: 'Ninguno. Soporte obtiene la contraseña desde el portal cuando la necesite.',
    risk: 'bajo',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'ageDays', label: 'Rotar cada (días)', type: 'number', default: 30, min: 7, max: 365 },
      { key: 'length', label: 'Longitud', type: 'number', default: 16, min: 12, max: 64 },
    ],
    presets: { estricto: { ageDays: 14, length: 20 } },
    manualSteps: [
      {
        text: 'Prerrequisito: Entra ID → Dispositivos → Configuración → "Habilitar Microsoft Entra LAPS" = Sí.',
        url: 'https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DevicesMenuBlade/~/DeviceSettings',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/windows-laps-policy',
    run: (ctx, p) =>
      ensureSettingsPolicy(ctx, {
        name: `${PREFIX}-Windows-LAPS`,
        description: 'Windows LAPS con respaldo en Entra ID',
        targets: [allDevicesTarget],
        settings: [
          sc.choice('device_vendor_msft_laps_policies_backupdirectory', '1', [
            sc.int('device_vendor_msft_laps_policies_passwordagedays_aad', Number(p.ageDays)),
          ]),
          sc.choice('device_vendor_msft_laps_policies_passwordcomplexity', '4'),
          sc.int('device_vendor_msft_laps_policies_passwordlength', Number(p.length)),
          sc.choice('device_vendor_msft_laps_policies_postauthenticationactions', '3'),
        ],
      }),
  },

  {
    ...intuneBase,
    id: 'intune-update-ring',
    title: 'Anillo de Windows Update for Business',
    tiles: ['windows-update-business', 'windows-11-support'],
    summary: 'Controla cuándo se instalan las actualizaciones de Windows, con plazos para que ningún equipo quede atrás.',
    changes: [
      'Diferimiento de actualizaciones de calidad y de características',
      'Plazos (deadline) de instalación y período de gracia',
      'Instalación fuera del horario laboral',
    ],
    userImpact: 'Los equipos se reinician fuera del horario activo; al vencer el plazo, el reinicio es obligatorio.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      { key: 'qualityDeferral', label: 'Diferir actualizaciones de calidad (días)', type: 'number', default: 3, min: 0, max: 30 },
      { key: 'featureDeferral', label: 'Diferir actualizaciones de características (días)', type: 'number', default: 30, min: 0, max: 365 },
      { key: 'qualityDeadline', label: 'Plazo calidad (días)', type: 'number', default: 5, min: 0, max: 30 },
      { key: 'featureDeadline', label: 'Plazo características (días)', type: 'number', default: 14, min: 0, max: 30 },
      { key: 'grace', label: 'Período de gracia (días)', type: 'number', default: 2, min: 0, max: 7 },
    ],
    presets: { estricto: { qualityDeferral: 0, qualityDeadline: 3, grace: 1 } },
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/windows-update-for-business-configure',
    run: async (ctx, p) => {
      const name = `${PREFIX}-Windows-Update-General`;
      const r = await ensureObject(ctx, {
        path: CONFIG_PATH,
        name,
        label: 'Anillo de actualización',
        body: {
          '@odata.type': '#microsoft.graph.windowsUpdateForBusinessConfiguration',
          displayName: name,
          description: 'Anillo general de actualizaciones (Gobierno M365)',
          automaticUpdateMode: 'autoInstallAtMaintenanceTime',
          installationSchedule: {
            '@odata.type': '#microsoft.graph.windowsUpdateActiveHoursInstall',
            activeHoursStart: '08:00:00.0000000',
            activeHoursEnd: '19:00:00.0000000',
          },
          microsoftUpdateServiceAllowed: true,
          driversExcluded: false,
          qualityUpdatesDeferralPeriodInDays: Number(p.qualityDeferral),
          featureUpdatesDeferralPeriodInDays: Number(p.featureDeferral),
          qualityUpdatesPaused: false,
          featureUpdatesPaused: false,
          businessReadyUpdatesOnly: 'userDefined',
          deadlineForQualityUpdatesInDays: Number(p.qualityDeadline),
          deadlineForFeatureUpdatesInDays: Number(p.featureDeadline),
          deadlineGracePeriodInDays: Number(p.grace),
          postponeRebootUntilAfterDeadline: false,
          userPauseAccess: 'disabled',
          userWindowsUpdateScanAccess: 'enabled',
        },
      });
      const steps = [r.step];
      if (r.created) steps.push(await assign(ctx, { path: CONFIG_PATH, id: r.id, targets: [allDevicesTarget], label: name }));
      return steps;
    },
  },

  {
    ...intuneBase,
    id: 'intune-whfb',
    title: 'Windows Hello for Business',
    tiles: ['windows-hello'],
    summary: 'Inicio de sesión en Windows con PIN o biometría ligados al hardware: reemplaza la contraseña.',
    changes: ['WHfB habilitado a nivel de tenant', 'PIN mínimo de 6 dígitos', 'Requiere TPM', 'Biometría permitida'],
    userImpact: 'Al configurar o iniciar Windows se pedirá crear un PIN y opcionalmente huella/rostro.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [{ key: 'pinMin', label: 'Largo mínimo del PIN', type: 'number', default: 6, min: 4, max: 127 }],
    permissions: ['DeviceManagementServiceConfig.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/mem/intune/protect/windows-hello',
    run: async (ctx, p) => {
      const configs = await ctx.graph.list<any>('/deviceManagement/deviceEnrollmentConfigurations');
      const whfb = configs.find((c) => c['@odata.type'] === '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration');
      if (!whfb) throw new Error('No se encontró la configuración de inscripción de Windows Hello for Business');
      return [
        await ensureSingleton(ctx, {
          path: `/deviceManagement/deviceEnrollmentConfigurations/${whfb.id}`,
          label: 'Windows Hello for Business (inscripción)',
          desired: {
            '@odata.type': '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration',
            state: 'enabled',
            pinMinimumLength: Number(p.pinMin),
            pinMaximumLength: 127,
            pinUppercaseCharactersUsage: 'allowed',
            pinLowercaseCharactersUsage: 'allowed',
            pinSpecialCharactersUsage: 'allowed',
            securityDeviceRequired: true,
            unlockWithBiometricsEnabled: true,
            remotePassportEnabled: true,
            pinPreviousBlockCount: 0,
            pinExpirationInDays: 0,
          },
        }),
      ];
    },
  },

  {
    ...intuneBase,
    id: 'intune-mam',
    title: 'Protección de aplicaciones móviles (MAM / BYOD)',
    tiles: ['application-management', 'm365-mobile-app'],
    summary:
      'Protege los datos de la empresa dentro de Outlook, Teams, OneDrive y Office en celulares, aunque el equipo sea personal.',
    changes: [
      'PIN de 6 dígitos para abrir apps corporativas',
      'Copiar/pegar y "Guardar como" solo entre apps corporativas',
      'Sin respaldo en iCloud/Google de datos corporativos',
      'Borrado selectivo si no se conecta en 90 días',
    ],
    userImpact: 'Las apps de Microsoft pedirán un PIN y no permitirán copiar datos a apps personales.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'platforms',
        label: 'Plataformas',
        type: 'multiselect',
        default: ['ios', 'android'],
        options: [
          { value: 'ios', label: 'iOS / iPadOS' },
          { value: 'android', label: 'Android' },
        ],
      },
      { key: 'offlineWipeDays', label: 'Borrado selectivo tras días sin conexión', type: 'number', default: 90, min: 1, max: 365 },
      { key: 'blockPrint', label: 'Bloquear impresión', type: 'boolean', default: false },
    ],
    presets: { estricto: { offlineWipeDays: 30, blockPrint: true } },
    permissions: ['DeviceManagementApps.ReadWrite.All'],
    dependsOn: ['entra-dynamic-groups'],
    docsUrl: 'https://learn.microsoft.com/mem/intune/apps/app-protection-framework',
    run: async (ctx, p) => {
      const groupId = ctx.outputs['group:Usuarios-Internos'] ?? pending(`${PREFIX}-Usuarios-Internos`);
      const common = {
        periodOfflineBeforeAccessCheck: 'PT12H',
        periodOnlineBeforeAccessCheck: 'PT30M',
        allowedInboundDataTransferSources: 'allApps',
        allowedOutboundDataTransferDestinations: 'managedApps',
        allowedOutboundClipboardSharingLevel: 'managedAppsWithPasteIn',
        organizationalCredentialsRequired: false,
        dataBackupBlocked: true,
        deviceComplianceRequired: false,
        saveAsBlocked: true,
        periodOfflineBeforeWipeIsEnforced: `P${Number(p.offlineWipeDays)}D`,
        pinRequired: true,
        maximumPinRetries: 5,
        simplePinBlocked: true,
        minimumPinLength: 6,
        pinCharacterSet: 'numeric',
        periodBeforePinReset: 'PT0S',
        allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'],
        printBlocked: Boolean(p.blockPrint),
        fingerprintBlocked: false,
        disableAppPinIfDevicePinIsSet: false,
        appGroupType: 'allCoreMicrosoftApps',
        targetedAppManagementLevels: 'unspecified',
      };
      const steps: PlanStep[] = [];
      const platforms = asList(p.platforms);
      const defs = [
        { key: 'ios', path: '/deviceAppManagement/iosManagedAppProtections', type: 'iosManagedAppProtection', extra: { appDataEncryptionType: 'whenDeviceLocked' } },
        { key: 'android', path: '/deviceAppManagement/androidManagedAppProtections', type: 'androidManagedAppProtection', extra: { screenCaptureBlocked: true } },
      ];
      for (const d of defs.filter((x) => platforms.includes(x.key))) {
        const name = `${PREFIX}-MAM-${d.key === 'ios' ? 'iOS' : 'Android'}`;
        const r = await ensureObject(ctx, {
          path: d.path,
          name,
          beta: true,
          label: 'Protección de aplicaciones',
          body: {
            '@odata.type': `#microsoft.graph.${d.type}`,
            displayName: name,
            description: 'Protección de datos corporativos en apps móviles (Gobierno M365)',
            ...common,
            ...d.extra,
          },
        });
        steps.push(r.step);
        if (r.created) steps.push(await assign(ctx, { path: d.path, id: r.id, beta: true, targets: [groupTarget(groupId)], label: name }));
      }
      return steps;
    },
  },

  {
    ...intuneBase,
    id: 'intune-autopilot',
    title: 'Perfil de Windows Autopilot',
    tiles: ['windows-autopilot-ems'],
    summary: 'Equipos nuevos se configuran solos al conectarse a internet: el usuario inicia sesión y todo queda listo.',
    changes: [
      'Perfil unido a Entra ID, usuario estándar (sin admin local)',
      'Oculta EULA, privacidad y opciones de cuenta local',
      'Nombre de equipo con plantilla',
      'Asignado al grupo dinámico de dispositivos Autopilot',
    ],
    userImpact: 'Los equipos nuevos o reseteados pasarán por la experiencia de configuración corporativa.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'nameTemplate', label: 'Plantilla de nombre de equipo', type: 'text', default: 'EMP-%SERIAL%', help: 'Máx. 15 caracteres. %SERIAL% o %RAND:x%.' },
    ],
    permissions: ['DeviceManagementServiceConfig.ReadWrite.All'],
    dependsOn: ['entra-dynamic-groups', 'entra-device-join'],
    manualSteps: [{ text: 'Registra los hashes de hardware (o pídelo a tu proveedor/OEM) en Intune → Dispositivos → Windows → Autopilot.' }],
    docsUrl: 'https://learn.microsoft.com/autopilot/profiles',
    run: async (ctx, p) => {
      const path = '/deviceManagement/windowsAutopilotDeploymentProfiles';
      const name = `${PREFIX}-Autopilot-Estandar`;
      const r = await ensureObject(ctx, {
        path,
        name,
        beta: true,
        label: 'Perfil Autopilot',
        body: {
          '@odata.type': '#microsoft.graph.azureADWindowsAutopilotDeploymentProfile',
          displayName: name,
          description: 'Perfil estándar unido a Entra ID (Gobierno M365)',
          language: 'os-default',
          deviceNameTemplate: String(p.nameTemplate).slice(0, 15),
          deviceType: 'windowsPc',
          enableWhiteGlove: true,
          extractHardwareHash: true,
          outOfBoxExperienceSettings: {
            hidePrivacySettings: true,
            hideEULA: true,
            userType: 'standard',
            deviceUsageType: 'singleUser',
            skipKeyboardSelectionPage: true,
            hideEscapeLink: true,
          },
        },
      });
      const steps = [r.step];
      if (r.created) {
        const groupId = ctx.outputs['group:Dispositivos-Autopilot'] ?? pending(`${PREFIX}-Dispositivos-Autopilot`);
        const body = { target: groupTarget(groupId) };
        if (!ctx.dryRun) await ctx.graph.post(`${path}/${r.id}/assignments`, body, { beta: true });
        steps.push({ action: 'asegurar', target: `Asignación de ${name}`, payload: body });
      }
      return steps;
    },
  },

  {
    id: 'intune-endpoint-analytics',
    title: 'Análisis de puntos de conexión',
    pillar: 'intune',
    engine: 'manual',
    tiles: ['endpoint-analytics'],
    summary: 'Mide rendimiento de arranque, fallas de apps y experiencia de usuario para priorizar renovaciones de equipos.',
    changes: ['Recolección de datos de Endpoint Analytics en equipos Intune'],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 4,
    profiles: ['recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Intune → Informes → Análisis de puntos de conexión → Configuración → Conectar dispositivos Intune ("Todos los dispositivos inscritos en la nube").',
        url: 'https://intune.microsoft.com/#view/Microsoft_Intune_Enrollment/UXAnalyticsMenu/~/overview',
      },
    ],
  },

  {
    id: 'intune-autopatch',
    title: 'Windows Autopatch',
    pillar: 'intune',
    engine: 'manual',
    tiles: ['windows-autopatch'],
    summary: 'Microsoft orquesta las actualizaciones de Windows, Office, Edge y Teams por anillos automáticamente.',
    changes: ['Activación de Autopatch', 'Grupos de despliegue automáticos'],
    userImpact: 'Ninguno directo.',
    risk: 'medio',
    phase: 4,
    profiles: ['estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Intune → Administración de inquilinos → Windows Autopatch → Activar. Si usas Autopatch, NO uses el anillo GOB-Windows-Update-General (conflicto).',
        url: 'https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/TenantAdminMenu/~/windowsAutopatch',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/windows/deployment/windows-autopatch/overview/windows-autopatch-overview',
  },
];
