import type { Ctx, Params, PlanStep, Playbook } from '../engine/types.js';
import { GraphError } from '../graph/client.js';
import { PREFIX, asList, ensureObject, ensureSingleton, findByName, pending, diff } from '../engine/helpers.js';

// Plantillas de rol de Entra ID con privilegios administrativos (ids fijos en todos los tenants)
export const ADMIN_ROLES = [
  '62e90394-69f5-4237-9190-012177145e10', // Administrador global
  'e8611ab8-c189-46e8-94e1-60213ab1f814', // Administrador de roles con privilegios
  '7be44c8a-adaf-4e2a-84d6-ab2649e08a13', // Administrador de autenticación con privilegios
  '194ae4cb-b126-40b2-bd5b-6091b380977d', // Administrador de seguridad
  'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9', // Administrador de acceso condicional
  '29232cdf-9323-42fd-ade2-1d097af3e4de', // Administrador de Exchange
  'f28a1f50-f6e7-4571-818b-6a12f2af6b6c', // Administrador de SharePoint
  '3a2c62db-5318-420d-8d74-23affee5d9d5', // Administrador de Intune
  '17315797-102d-40b4-93e0-432062caca18', // Administrador de cumplimiento
  'fe930be7-5e62-47db-91af-98c3a49a38b1', // Administrador de usuarios
  'c4e39bd9-1100-46d3-8c65-fb160da0071f', // Administrador de autenticación
  '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3', // Administrador de aplicaciones
  '158c047a-c907-4556-b7ef-446551a6b5f7', // Administrador de aplicaciones en la nube
  '729827e3-9c14-49f7-bb1b-9608f156bbb8', // Administrador del departamento de soporte técnico
  '966707d0-3269-4727-9be2-8c3a10f19b9d', // Administrador de contraseñas
  'b0f54661-2d74-4c50-afa3-1ec803f12efe', // Administrador de facturación
];
const DIRECTORY_SYNC_ROLE = 'd29b2b05-8046-44ba-8758-1e26182fcf32';
const AZURE_MANAGEMENT_APP = '797f4846-ba00-4fd7-ba43-dac1f8f63013';
const STRENGTH_PHISHING_RESISTANT = '00000000-0000-0000-0000-000000000004';

const EXTERNAL_USERS = {
  guestOrExternalUserTypes:
    'internalGuest,b2bCollaborationGuest,b2bCollaborationMember,b2bDirectConnectUser,otherExternalUser,serviceProvider',
  externalTenants: { '@odata.type': '#microsoft.graph.conditionalAccessAllExternalTenants', membershipKind: 'all' },
};

const CA_PATH = '/identity/conditionalAccess/policies';
const SD_PATH = '/policies/identitySecurityDefaultsEnforcementPolicy';
const AM_PATH = '/policies/authenticationMethodsPolicy/authenticationMethodConfigurations';

const STATE_PARAM = (def: string) => ({
  key: 'state',
  label: 'Estado de la política',
  type: 'select' as const,
  default: def,
  options: [
    { value: 'enabledForReportingButNotEnforced', label: 'Solo informe (report-only): mide impacto sin bloquear' },
    { value: 'enabled', label: 'Aplicada' },
    { value: 'disabled', label: 'Desactivada' },
  ],
  help: 'Buena práctica: comenzar en "solo informe", revisar los registros de inicio de sesión 7-14 días y luego aplicar.',
});

export const CA_NAMES = {
  admins: `${PREFIX}-CA01 MFA para administradores`,
  allUsers: `${PREFIX}-CA02 MFA para todos los usuarios`,
  legacy: `${PREFIX}-CA03 Bloquear autenticación heredada`,
  azure: `${PREFIX}-CA04 MFA para administración de Azure`,
  compliant: `${PREFIX}-CA05 Requerir dispositivo conforme`,
  countries: `${PREFIX}-CA06 Bloquear países no permitidos`,
  mobile: `${PREFIX}-CA07 Móviles: app protegida o dispositivo conforme`,
  session: `${PREFIX}-CA08 Sesión limitada en navegador no administrado`,
  registration: `${PREFIX}-CA09 Proteger registro de información de seguridad`,
};

export const EMERGENCY_GROUP = `${PREFIX}-Exclusion-AccesoEmergencia`;

async function securityDefaultsEnabled(ctx: Ctx): Promise<boolean> {
  if (ctx.outputs.securityDefaultsEnabled === undefined) {
    const sd = await ctx.graph.get<any>(SD_PATH);
    ctx.outputs.securityDefaultsEnabled = Boolean(sd?.isEnabled);
  }
  return ctx.outputs.securityDefaultsEnabled;
}

interface CaDef {
  name: string;
  conditions: Record<string, any>;
  grantControls?: Record<string, any>;
  sessionControls?: Record<string, any>;
}

async function ensureCa(ctx: Ctx, params: Params, def: CaDef): Promise<PlanStep[]> {
  const steps: PlanStep[] = [];
  const exclusion = ctx.outputs.emergencyGroupId ?? pending(EMERGENCY_GROUP);
  let state: string = params.state;
  if (state === 'enabled' && (await securityDefaultsEnabled(ctx))) {
    // Con los valores predeterminados de seguridad activos no se puede aplicar Acceso Condicional:
    // se crea en modo informe y el playbook entra-security-defaults la habilita tras desactivarlos.
    state = 'enabledForReportingButNotEnforced';
    (ctx.outputs.caPendingEnable ??= []).push(def.name);
    steps.push({
      action: 'aviso',
      target: def.name,
      detail:
        'Los valores predeterminados de seguridad están activos: se crea en "solo informe" y se aplicará cuando se ejecute "Reemplazar valores predeterminados de seguridad".',
    });
  }
  const users = def.conditions.users ?? {};
  const conditions = {
    ...def.conditions,
    users: { ...users, excludeGroups: [...(users.excludeGroups ?? []), exclusion] },
  };
  const body: Record<string, any> = { displayName: def.name, state, conditions };
  if (def.grantControls) body.grantControls = def.grantControls;
  if (def.sessionControls) body.sessionControls = def.sessionControls;
  const r = await ensureObject(ctx, { path: CA_PATH, name: def.name, body, label: 'Acceso Condicional' });
  steps.unshift(r.step);
  return steps;
}

const caBase = {
  pillar: 'entra' as const,
  engine: 'graph' as const,
  permissions: ['Policy.Read.All', 'Policy.ReadWrite.ConditionalAccess', 'Application.Read.All', 'Group.Read.All'],
  docsUrl: 'https://learn.microsoft.com/entra/identity/conditional-access/plan-conditional-access',
};

const grantMfa = { operator: 'OR', builtInControls: ['mfa'] };
const grantBlock = { operator: 'OR', builtInControls: ['block'] };

export const entraPlaybooks: Playbook[] = [
  {
    id: 'entra-emergency-access',
    title: 'Cuentas de acceso de emergencia (break-glass)',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['conditional-access', 'mfa'],
    summary:
      'Crea el grupo que se excluye de todas las políticas de Acceso Condicional para no quedar bloqueados fuera del tenant.',
    changes: [
      `Grupo de seguridad "${EMERGENCY_GROUP}"`,
      'Agrega como miembros las cuentas de emergencia indicadas',
      'Todas las políticas GOB-CA se crean excluyendo este grupo',
    ],
    userImpact: 'Ninguno para los usuarios. Es el seguro contra bloqueos accidentales.',
    risk: 'bajo',
    phase: 0,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'upns',
        label: 'Cuentas de emergencia (UPN, una por línea)',
        type: 'list',
        default: [],
        help: 'Mínimo 2 cuentas solo-nube (…@dominio.onmicrosoft.com), rol Administrador global, contraseña larga guardada en sobre/caja fuerte y llave FIDO2.',
      },
    ],
    permissions: ['Group.ReadWrite.All', 'User.Read.All'],
    manualSteps: [
      {
        text: 'Crea 2 cuentas solo-nube (ej. emergencia01@tu-tenant.onmicrosoft.com) con rol Administrador global y registra llaves FIDO2 para ellas.',
        url: 'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers',
      },
      { text: 'Configura una alerta de inicio de sesión de estas cuentas (Log Analytics o alerta de actividad).' },
    ],
    docsUrl: 'https://learn.microsoft.com/entra/identity/role-based-access-control/security-emergency-access',
    run: async (ctx, p) => {
      const r = await ensureObject(ctx, {
        path: '/groups',
        name: EMERGENCY_GROUP,
        serverFilter: true,
        body: {
          displayName: EMERGENCY_GROUP,
          description: 'Cuentas de acceso de emergencia excluidas de Acceso Condicional (gestionado por Gobierno M365)',
          mailEnabled: false,
          mailNickname: 'gob-exclusion-emergencia',
          securityEnabled: true,
        },
        updateOmit: ['mailEnabled', 'mailNickname', 'securityEnabled'],
        label: 'Grupo',
      });
      ctx.outputs.emergencyGroupId = r.id;
      const steps: PlanStep[] = [r.step];
      const upns = asList(p.upns);
      if (upns.length === 0) {
        steps.push({
          action: 'aviso',
          target: 'Cuentas de emergencia',
          detail: 'No se indicaron cuentas: el grupo queda vacío. Agrega al menos 2 cuentas antes de aplicar políticas de Acceso Condicional.',
        });
        return steps;
      }
      const members = r.created ? [] : await ctx.graph.list<any>(`/groups/${r.id}/members?$select=id,userPrincipalName`);
      for (const upn of upns) {
        let user: any;
        try {
          user = await ctx.graph.get(`/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName`);
        } catch (e) {
          if (e instanceof GraphError && e.status === 404) {
            steps.push({ action: 'aviso', target: upn, detail: 'El usuario no existe en el tenant' });
            continue;
          }
          throw e;
        }
        if (members.some((m) => m.id === user.id)) {
          steps.push({ action: 'sin-cambios', target: `Miembro ${upn}` });
          continue;
        }
        if (!ctx.dryRun) {
          await ctx.graph.post(`/groups/${r.id}/members/$ref`, {
            '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${user.id}`,
          });
        }
        steps.push({ action: 'crear', target: `Miembro ${upn}` });
      }
      return steps;
    },
  },

  {
    id: 'entra-authenticator',
    title: 'MFA con Microsoft Authenticator',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['mfa', 'sms-sign-in'],
    summary: 'Habilita Microsoft Authenticator (notificaciones con número y contexto) como método MFA principal.',
    changes: [
      'Microsoft Authenticator habilitado para todos los usuarios',
      'Muestra nombre de la aplicación y ubicación en cada aprobación (antifatiga MFA)',
      'Opcional: desactiva SMS y llamada de voz (métodos débiles)',
    ],
    userImpact: 'Los usuarios verán más contexto al aprobar un inicio de sesión. Si se desactiva SMS, deberán usar la app.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      { key: 'showContext', label: 'Mostrar aplicación y ubicación al aprobar', type: 'boolean', default: true },
      {
        key: 'disableSms',
        label: 'Desactivar SMS y llamada de voz',
        type: 'boolean',
        default: false,
        help: 'Solo cuando la mayoría ya registró Authenticator. SMS es vulnerable a SIM swapping.',
      },
    ],
    presets: { estricto: { disableSms: true } },
    permissions: ['Policy.ReadWrite.AuthenticationMethod'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/how-to-mfa-additional-context',
    run: async (ctx, p) => {
      const ctxState = p.showContext ? 'enabled' : 'default';
      const target = { targetType: 'group', id: 'all_users' };
      const steps = [
        await ensureSingleton(ctx, {
          path: `${AM_PATH}/MicrosoftAuthenticator`,
          label: 'Método Microsoft Authenticator',
          desired: {
            '@odata.type': '#microsoft.graph.microsoftAuthenticatorAuthenticationMethodConfiguration',
            state: 'enabled',
            featureSettings: {
              displayAppInformationRequiredState: { state: ctxState, includeTarget: target },
              displayLocationInformationRequiredState: { state: ctxState, includeTarget: target },
            },
          },
        }),
      ];
      if (p.disableSms) {
        for (const [id, type] of [
          ['Sms', 'smsAuthenticationMethodConfiguration'],
          ['Voice', 'voiceAuthenticationMethodConfiguration'],
        ]) {
          steps.push(
            await ensureSingleton(ctx, {
              path: `${AM_PATH}/${id}`,
              label: `Método ${id}`,
              desired: { '@odata.type': `#microsoft.graph.${type}`, state: 'disabled' },
            }),
          );
        }
      }
      return steps;
    },
  },

  {
    id: 'entra-registration-campaign',
    title: 'Campaña de registro de MFA',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['mfa'],
    summary: 'Invita a los usuarios que aún no tienen Authenticator a registrarlo al iniciar sesión.',
    changes: ['Campaña de registro (nudge) habilitada para todos los usuarios, apuntando a Microsoft Authenticator'],
    userImpact: 'Al iniciar sesión, los usuarios sin Authenticator verán una invitación a registrarlo (pueden posponer).',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [{ key: 'snoozeDays', label: 'Días que se puede posponer', type: 'number', default: 3, min: 0, max: 14 }],
    presets: { estricto: { snoozeDays: 1 } },
    permissions: ['Policy.ReadWrite.AuthenticationMethod'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/how-to-mfa-registration-campaign',
    run: async (ctx, p) => [
      await ensureSingleton(ctx, {
        path: '/policies/authenticationMethodsPolicy',
        label: 'Campaña de registro de Authenticator',
        desired: {
          registrationEnforcement: {
            authenticationMethodsRegistrationCampaign: {
              state: 'enabled',
              snoozeDurationInDays: Number(p.snoozeDays),
              includeTargets: [{ id: 'all_users', targetType: 'group', targetedAuthenticationMethod: 'microsoftAuthenticator' }],
            },
          },
        },
      }),
    ],
  },

  {
    id: 'entra-tap',
    title: 'Pase de acceso temporal (TAP)',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['temporary-access-pass'],
    summary: 'Permite a TI entregar un código temporal para que un usuario nuevo registre sus métodos sin contraseña.',
    changes: ['Método Temporary Access Pass habilitado', 'De un solo uso y con vigencia limitada'],
    userImpact: 'Ninguno directo. Facilita el onboarding y la recuperación de cuentas.',
    risk: 'bajo',
    phase: 1,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'lifetime', label: 'Vigencia por defecto (minutos)', type: 'number', default: 60, min: 60, max: 480 },
      { key: 'once', label: 'De un solo uso', type: 'boolean', default: true },
    ],
    permissions: ['Policy.ReadWrite.AuthenticationMethod'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/howto-authentication-temporary-access-pass',
    run: async (ctx, p) => [
      await ensureSingleton(ctx, {
        path: `${AM_PATH}/TemporaryAccessPass`,
        label: 'Método Temporary Access Pass',
        desired: {
          '@odata.type': '#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration',
          state: 'enabled',
          minimumLifetimeInMinutes: 60,
          maximumLifetimeInMinutes: 480,
          defaultLifetimeInMinutes: Number(p.lifetime),
          defaultLength: 8,
          isUsableOnce: Boolean(p.once),
          includeTargets: [{ targetType: 'group', id: 'all_users' }],
        },
      }),
    ],
  },

  {
    id: 'entra-fido2',
    title: 'Autenticación sin contraseña (FIDO2 / passkeys)',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['passwordless'],
    summary: 'Habilita llaves de seguridad y passkeys: el método más resistente al phishing.',
    changes: ['Método FIDO2/passkeys habilitado con autoregistro'],
    userImpact: 'Los usuarios podrán registrar una passkey (en Authenticator) o una llave física como método de inicio de sesión.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'attestation',
        label: 'Exigir atestación del fabricante',
        type: 'boolean',
        default: false,
        help: 'Actívalo solo si compras llaves certificadas; bloquea passkeys sin atestación.',
      },
    ],
    permissions: ['Policy.ReadWrite.AuthenticationMethod'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/how-to-enable-passkey-fido2',
    run: async (ctx, p) => [
      await ensureSingleton(ctx, {
        path: `${AM_PATH}/Fido2`,
        label: 'Método FIDO2 / passkeys',
        desired: {
          '@odata.type': '#microsoft.graph.fido2AuthenticationMethodConfiguration',
          state: 'enabled',
          isSelfServiceRegistrationAllowed: true,
          isAttestationEnforced: Boolean(p.attestation),
          includeTargets: [{ targetType: 'group', id: 'all_users' }],
        },
      }),
    ],
  },

  {
    ...caBase,
    id: 'entra-ca-admins-mfa',
    title: 'CA01 · MFA obligatorio para administradores',
    tiles: ['conditional-access', 'mfa'],
    summary: 'Todo rol administrativo debe usar MFA (o MFA resistente a phishing) en cualquier aplicación.',
    changes: [`Política "${CA_NAMES.admins}" dirigida a ${ADMIN_ROLES.length} roles administrativos`],
    userImpact: 'Solo afecta a administradores: se les pedirá MFA en cada sesión nueva.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      STATE_PARAM('enabled'),
      {
        key: 'strength',
        label: 'Fortaleza exigida',
        type: 'select',
        default: 'mfa',
        options: [
          { value: 'mfa', label: 'MFA estándar' },
          { value: 'phishingResistant', label: 'MFA resistente a phishing (FIDO2, WHfB)' },
        ],
      },
    ],
    presets: { estricto: { strength: 'phishingResistant' } },
    dependsOn: (p) => ['entra-emergency-access', ...(p.strength === 'phishingResistant' ? ['entra-fido2'] : [])],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.admins,
        conditions: {
          users: { includeRoles: ADMIN_ROLES },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['all'],
        },
        grantControls:
          p.strength === 'phishingResistant'
            ? { operator: 'OR', authenticationStrength: { id: STRENGTH_PHISHING_RESISTANT } }
            : grantMfa,
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-all-users-mfa',
    title: 'CA02 · MFA para todos los usuarios',
    tiles: ['conditional-access', 'mfa'],
    summary: 'Exige MFA a todos los usuarios en todas las aplicaciones. Bloquea más del 99% de los ataques a cuentas.',
    changes: [`Política "${CA_NAMES.allUsers}"`, 'Excluye cuentas de emergencia y la cuenta de sincronización de directorio'],
    userImpact: 'Usuarios sin MFA registrado deberán registrarlo en su próximo inicio de sesión.',
    risk: 'medio',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [STATE_PARAM('enabledForReportingButNotEnforced')],
    dependsOn: ['entra-emergency-access', 'entra-authenticator'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.allUsers,
        conditions: {
          users: { includeUsers: ['All'], excludeRoles: [DIRECTORY_SYNC_ROLE] },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['all'],
        },
        grantControls: grantMfa,
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-block-legacy',
    title: 'CA03 · Bloquear autenticación heredada',
    tiles: ['conditional-access'],
    summary: 'Bloquea protocolos antiguos (POP, IMAP, SMTP AUTH, ActiveSync básico) que no soportan MFA.',
    changes: [`Política "${CA_NAMES.legacy}"`],
    userImpact: 'Clientes de correo antiguos o impresoras que envían correo con usuario/contraseña dejarán de funcionar.',
    risk: 'medio',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [STATE_PARAM('enabledForReportingButNotEnforced')],
    dependsOn: ['entra-emergency-access'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.legacy,
        conditions: {
          users: { includeUsers: ['All'], excludeRoles: [DIRECTORY_SYNC_ROLE] },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['exchangeActiveSync', 'other'],
        },
        grantControls: grantBlock,
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-azure-mgmt',
    title: 'CA04 · MFA para administración de Azure',
    tiles: ['conditional-access'],
    summary: 'Exige MFA para acceder al portal de Azure, Azure CLI y PowerShell.',
    changes: [`Política "${CA_NAMES.azure}"`],
    userImpact: 'Solo usuarios que administran Azure.',
    risk: 'bajo',
    phase: 1,
    profiles: ['recomendado', 'estricto'],
    params: [STATE_PARAM('enabled')],
    dependsOn: ['entra-emergency-access'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.azure,
        conditions: {
          users: { includeUsers: ['All'] },
          applications: { includeApplications: [AZURE_MANAGEMENT_APP] },
          clientAppTypes: ['all'],
        },
        grantControls: grantMfa,
      }),
  },

  {
    id: 'entra-security-defaults',
    title: 'Reemplazar valores predeterminados de seguridad por Acceso Condicional',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['conditional-access'],
    summary:
      'Desactiva los "security defaults" SOLO si las políticas base (CA01, CA02, CA03) quedan aplicadas en el mismo despliegue, y luego las activa.',
    changes: [
      'Verifica que CA01, CA02 y CA03 existan y queden aplicadas',
      'Desactiva los valores predeterminados de seguridad',
      'Pasa de "solo informe" a "aplicada" las políticas que esperaban este paso',
    ],
    userImpact: 'Sin cambio perceptible: la protección MFA se mantiene, ahora gobernada por Acceso Condicional.',
    risk: 'alto',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    dependsOn: ['entra-ca-admins-mfa', 'entra-ca-all-users-mfa', 'entra-ca-block-legacy'],
    permissions: ['Policy.Read.All', 'Policy.ReadWrite.ConditionalAccess'],
    docsUrl: 'https://learn.microsoft.com/entra/fundamentals/security-defaults',
    run: async (ctx) => {
      const steps: PlanStep[] = [];
      const pendingNames: string[] = ctx.outputs.caPendingEnable ?? [];
      const enabled = await securityDefaultsEnabled(ctx);
      if (enabled) {
        const policies = await ctx.graph.list<any>(CA_PATH);
        const baseline = [CA_NAMES.admins, CA_NAMES.allUsers, CA_NAMES.legacy];
        const missing = baseline.filter(
          (n) => !pendingNames.includes(n) && !policies.some((p) => p.displayName === n && p.state === 'enabled'),
        );
        if (missing.length) {
          throw new Error(
            `Protección: no se desactivan los valores predeterminados porque estas políticas no quedarían aplicadas: ${missing.join('; ')}. Configúralas con estado "Aplicada".`,
          );
        }
        if (!ctx.dryRun) await ctx.graph.patch(SD_PATH, { isEnabled: false });
        steps.push({ action: 'actualizar', target: 'Valores predeterminados de seguridad', detail: 'Activos → desactivados' });
      } else {
        steps.push({ action: 'sin-cambios', target: 'Valores predeterminados de seguridad', detail: 'Ya estaban desactivados' });
      }
      ctx.outputs.securityDefaultsEnabled = false;
      for (const name of pendingNames) {
        if (!ctx.dryRun) {
          const policy = await findByName(ctx, CA_PATH, name);
          if (policy) await ctx.graph.patch(`${CA_PATH}/${policy.id}`, { state: 'enabled' });
        }
        steps.push({ action: 'actualizar', target: name, detail: 'Solo informe → aplicada' });
      }
      ctx.outputs.caPendingEnable = [];
      return steps;
    },
  },

  {
    id: 'entra-named-locations',
    title: 'Ubicación con nombre: países permitidos',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['conditional-access'],
    summary: 'Define los países desde donde opera la empresa para usarlos en Acceso Condicional.',
    changes: [`Ubicación con nombre "${PREFIX}-Paises-Permitidos"`],
    userImpact: 'Ninguno por sí sola.',
    risk: 'bajo',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'countries',
        label: 'Países permitidos (código ISO de 2 letras)',
        type: 'list',
        default: ['CL'],
        help: 'Incluye países donde viajan los ejecutivos. Ej: CL, AR, PE, US.',
      },
    ],
    permissions: ['Policy.Read.All', 'Policy.ReadWrite.ConditionalAccess'],
    run: async (ctx, p) => {
      const name = `${PREFIX}-Paises-Permitidos`;
      const countries = asList(p.countries).map((c) => c.toUpperCase());
      if (countries.length === 0) throw new Error('Indica al menos un país permitido');
      const r = await ensureObject(ctx, {
        path: '/identity/conditionalAccess/namedLocations',
        name,
        body: {
          '@odata.type': '#microsoft.graph.countryNamedLocation',
          displayName: name,
          countriesAndRegions: countries,
          includeUnknownCountriesAndRegions: false,
        },
        label: 'Ubicación con nombre',
      });
      ctx.outputs.allowedCountriesLocationId = r.id;
      return [r.step];
    },
  },

  {
    ...caBase,
    id: 'entra-ca-block-countries',
    title: 'CA06 · Bloquear inicios de sesión fuera de los países permitidos',
    tiles: ['conditional-access'],
    summary: 'Bloquea accesos desde países donde la empresa no opera: reduce ataques automatizados.',
    changes: [`Política "${CA_NAMES.countries}"`],
    userImpact: 'Usuarios que viajen a otros países no podrán iniciar sesión (TI puede agregarlos temporalmente a la exclusión).',
    risk: 'medio',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [STATE_PARAM('enabledForReportingButNotEnforced')],
    dependsOn: ['entra-emergency-access', 'entra-named-locations'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.countries,
        conditions: {
          users: { includeUsers: ['All'], excludeRoles: [DIRECTORY_SYNC_ROLE] },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['all'],
          locations: {
            includeLocations: ['All'],
            excludeLocations: [ctx.outputs.allowedCountriesLocationId ?? pending('ubicación países permitidos')],
          },
        },
        grantControls: grantBlock,
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-compliant-device',
    title: 'CA05 · Requerir dispositivo conforme (Windows / macOS)',
    tiles: ['conditional-access', 'windows-conditional-access'],
    summary: 'Solo equipos administrados por Intune y conformes pueden acceder a los datos de la empresa.',
    changes: [`Política "${CA_NAMES.compliant}"`],
    userImpact: 'Equipos personales o no inscritos en Intune no podrán acceder desde aplicaciones de escritorio.',
    risk: 'alto',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      STATE_PARAM('enabledForReportingButNotEnforced'),
      {
        key: 'platforms',
        label: 'Plataformas',
        type: 'multiselect',
        default: ['windows', 'macOS'],
        options: [
          { value: 'windows', label: 'Windows' },
          { value: 'macOS', label: 'macOS' },
        ],
      },
    ],
    dependsOn: ['entra-emergency-access', 'intune-compliance'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.compliant,
        conditions: {
          users: { includeUsers: ['All'], excludeRoles: [DIRECTORY_SYNC_ROLE], excludeGuestsOrExternalUsers: EXTERNAL_USERS },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['all'],
          platforms: { includePlatforms: asList(p.platforms) },
        },
        grantControls: { operator: 'OR', builtInControls: ['compliantDevice', 'domainJoinedDevice'] },
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-mobile-app-protection',
    title: 'CA07 · Móviles: aplicación protegida o dispositivo conforme',
    tiles: ['conditional-access', 'application-management'],
    summary: 'En iOS/Android solo se accede a Office 365 desde apps con protección de Intune (MAM) o equipos inscritos.',
    changes: [`Política "${CA_NAMES.mobile}"`],
    userImpact: 'En el celular deberán usar Outlook/Teams/OneDrive oficiales (no la app de correo nativa).',
    risk: 'medio',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [STATE_PARAM('enabledForReportingButNotEnforced')],
    dependsOn: ['entra-emergency-access', 'intune-mam'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.mobile,
        conditions: {
          users: { includeUsers: ['All'], excludeGuestsOrExternalUsers: EXTERNAL_USERS },
          applications: { includeApplications: ['Office365'] },
          clientAppTypes: ['browser', 'mobileAppsAndDesktopClients'],
          platforms: { includePlatforms: ['android', 'iOS'] },
        },
        grantControls: { operator: 'OR', builtInControls: ['compliantApplication', 'compliantDevice'] },
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-unmanaged-session',
    title: 'CA08 · Sesión limitada en navegadores no administrados',
    tiles: ['conditional-access'],
    summary: 'En equipos no conformes, la sesión web expira y no se mantiene iniciada ("¿Mantener sesión?" = No).',
    changes: [`Política "${CA_NAMES.session}"`],
    userImpact: 'Desde equipos personales tendrán que volver a iniciar sesión periódicamente.',
    risk: 'bajo',
    phase: 3,
    profiles: ['recomendado', 'estricto'],
    params: [
      STATE_PARAM('enabledForReportingButNotEnforced'),
      { key: 'hours', label: 'Frecuencia de inicio de sesión (horas)', type: 'number', default: 12, min: 1, max: 72 },
    ],
    presets: { estricto: { hours: 8 } },
    dependsOn: ['entra-emergency-access'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.session,
        conditions: {
          users: { includeUsers: ['All'], excludeGuestsOrExternalUsers: EXTERNAL_USERS },
          applications: { includeApplications: ['All'] },
          clientAppTypes: ['browser'],
          devices: { deviceFilter: { mode: 'exclude', rule: 'device.isCompliant -eq True -or device.trustType -eq "ServerAD"' } },
        },
        sessionControls: {
          signInFrequency: { value: Number(p.hours), type: 'hours', isEnabled: true, frequencyInterval: 'timeBased' },
          persistentBrowser: { mode: 'never', isEnabled: true },
        },
      }),
  },

  {
    ...caBase,
    id: 'entra-ca-register-security-info',
    title: 'CA09 · Proteger el registro de métodos MFA',
    tiles: ['conditional-access', 'temporary-access-pass'],
    summary: 'Evita que un atacante con la contraseña registre su propio MFA: registrar métodos exige MFA o un TAP.',
    changes: [`Política "${CA_NAMES.registration}"`],
    userImpact: 'Usuarios nuevos deberán recibir un Pase de acceso temporal de TI para registrar MFA.',
    risk: 'medio',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [STATE_PARAM('enabledForReportingButNotEnforced')],
    dependsOn: ['entra-emergency-access', 'entra-tap'],
    run: (ctx, p) =>
      ensureCa(ctx, p, {
        name: CA_NAMES.registration,
        conditions: {
          users: { includeUsers: ['All'], excludeGuestsOrExternalUsers: EXTERNAL_USERS },
          applications: { includeUserActions: ['urn:user:registersecurityinfo'] },
          clientAppTypes: ['all'],
        },
        grantControls: grantMfa,
      }),
  },

  {
    id: 'entra-authorization-hardening',
    title: 'Endurecer permisos predeterminados de usuarios',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['self-service-group-management', 'external-id', 'sso-saas'],
    summary:
      'Limita lo que un usuario común puede hacer en el directorio: registrar apps, dar consentimiento a apps de terceros e invitar invitados.',
    changes: [
      'Usuarios no pueden registrar aplicaciones ni crear tenants',
      'Consentimiento de usuario solo para apps de editores verificados con permisos de bajo riesgo',
      'Invitaciones a invitados solo por administradores y el rol "Invitador de invitados"',
      'Bloquea el antiguo módulo MSOnline PowerShell',
    ],
    userImpact: 'Si un usuario necesita una app de terceros con permisos altos, deberá solicitar aprobación a TI.',
    risk: 'bajo',
    phase: 1,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [
      {
        key: 'guestInvites',
        label: 'Quién puede invitar invitados',
        type: 'select',
        default: 'adminsAndGuestInviters',
        options: [
          { value: 'everyone', label: 'Todos (incluso invitados)' },
          { value: 'adminsGuestInvitersAndAllMembers', label: 'Miembros y administradores' },
          { value: 'adminsAndGuestInviters', label: 'Solo administradores e invitadores' },
          { value: 'none', label: 'Nadie' },
        ],
      },
      {
        key: 'userConsent',
        label: 'Consentimiento de usuarios a aplicaciones',
        type: 'select',
        default: 'low',
        options: [
          { value: 'low', label: 'Solo permisos de bajo riesgo de editores verificados' },
          { value: 'none', label: 'Ninguno (todo requiere aprobación de administrador)' },
        ],
      },
      { key: 'usersCreateSecurityGroups', label: 'Usuarios pueden crear grupos de seguridad', type: 'boolean', default: false },
    ],
    presets: { estricto: { userConsent: 'none' } },
    permissions: ['Policy.Read.All', 'Policy.ReadWrite.Authorization'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent',
    run: async (ctx, p) => {
      const path = '/policies/authorizationPolicy';
      const current = await ctx.graph.get<any>(path);
      // Se conservan las políticas de consentimiento sobre recursos propios (ej. RSC de Teams)
      const keep = (current?.defaultUserRolePermissions?.permissionGrantPoliciesAssigned ?? []).filter((x: string) =>
        x.startsWith('ManagePermissionGrantsForOwnedResource.'),
      );
      const consent = p.userConsent === 'none' ? [] : ['ManagePermissionGrantsForSelf.microsoft-user-default-low'];
      return [
        await ensureSingleton(ctx, {
          path,
          label: 'Política de autorización del directorio',
          desired: {
            allowInvitesFrom: p.guestInvites,
            blockMsolPowerShell: true,
            defaultUserRolePermissions: {
              allowedToCreateApps: false,
              allowedToCreateTenants: false,
              allowedToCreateSecurityGroups: Boolean(p.usersCreateSecurityGroups),
              permissionGrantPoliciesAssigned: [...consent, ...keep],
            },
          },
        }),
      ];
    },
  },

  {
    id: 'entra-password-protection',
    title: 'Protección de contraseñas y bloqueo inteligente',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['password-protection'],
    summary: 'Prohíbe contraseñas con palabras de la empresa y ajusta el bloqueo ante intentos fallidos.',
    changes: ['Lista personalizada de contraseñas prohibidas', 'Umbral y duración de bloqueo inteligente'],
    userImpact: 'Al cambiar la contraseña no podrán usar palabras prohibidas (nombre de la empresa, ciudad, etc.).',
    risk: 'bajo',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'banned',
        label: 'Palabras prohibidas',
        type: 'list',
        default: ['empresa', 'chile', 'santiago', 'bienvenido', 'contraseña', 'verano', 'invierno', 'qwerty'],
        help: 'Agrega el nombre de la empresa, productos, marcas y ciudades. Máximo 1000 términos.',
      },
      { key: 'threshold', label: 'Intentos fallidos antes de bloquear', type: 'number', default: 10, min: 3, max: 50 },
      { key: 'lockoutSeconds', label: 'Duración del bloqueo (segundos)', type: 'number', default: 60, min: 5, max: 3600 },
      { key: 'onPremises', label: 'Aplicar también en Active Directory local', type: 'boolean', default: false },
    ],
    permissions: ['Directory.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/tutorial-configure-custom-password-protection',
    run: async (ctx, p) => {
      const values = [
        { name: 'EnableBannedPasswordCheck', value: 'True' },
        { name: 'BannedPasswordList', value: asList(p.banned).slice(0, 1000).join('\t') },
        { name: 'LockoutThreshold', value: String(p.threshold) },
        { name: 'LockoutDurationInSeconds', value: String(p.lockoutSeconds) },
        { name: 'EnableBannedPasswordCheckOnPremises', value: p.onPremises ? 'True' : 'False' },
        { name: 'BannedPasswordCheckOnPremisesMode', value: 'Enforce' },
      ];
      return [await ensureDirectorySetting(ctx, 'Password Rule Settings', values, 'Protección de contraseñas')];
    },
  },

  {
    id: 'entra-group-governance',
    title: 'Gobierno de grupos de Microsoft 365 y Teams',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['self-service-group-management', 'dynamic-groups'],
    summary: 'Expiración de grupos sin uso, convención de nombres y (opcional) quién puede crear Teams/grupos.',
    changes: [
      'Directiva de expiración: los propietarios deben renovar grupos inactivos',
      'Prefijo de nombres para grupos nuevos (opcional)',
      'Restringir creación de grupos/Teams a un grupo autorizado (opcional)',
      'Etiquetas de confidencialidad en grupos y Teams (opcional, requiere etiquetas publicadas)',
    ],
    userImpact: 'Si se restringe la creación, solo los miembros del grupo autorizado podrán crear equipos de Teams.',
    risk: 'medio',
    phase: 2,
    profiles: ['recomendado', 'estricto'],
    params: [
      { key: 'lifetimeDays', label: 'Días de vigencia antes de pedir renovación', type: 'number', default: 365, min: 30, max: 3650 },
      { key: 'notifyEmail', label: 'Correo para avisos de grupos sin propietario', type: 'text', default: '' },
      { key: 'prefix', label: 'Prefijo de nombres (vacío = sin prefijo)', type: 'text', default: '' },
      { key: 'restrictCreation', label: 'Restringir creación de grupos/Teams', type: 'boolean', default: false },
      { key: 'enableLabels', label: 'Habilitar etiquetas de confidencialidad en grupos', type: 'boolean', default: false },
    ],
    presets: { estricto: { restrictCreation: true, enableLabels: true, lifetimeDays: 180 } },
    permissions: ['Directory.ReadWrite.All', 'Group.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/users/groups-lifecycle',
    run: async (ctx, p) => {
      const steps: PlanStep[] = [];
      // Expiración
      const lifecycle = (await ctx.graph.list<any>('/groupLifecyclePolicies'))[0];
      const desired = {
        groupLifetimeInDays: Number(p.lifetimeDays),
        managedGroupTypes: 'All',
        alternateNotificationEmails: String(p.notifyEmail ?? ''),
      };
      if (!lifecycle) {
        if (!ctx.dryRun) await ctx.graph.post('/groupLifecyclePolicies', desired);
        steps.push({ action: 'crear', target: 'Directiva de expiración de grupos', payload: desired });
      } else if (diff(desired, lifecycle).length) {
        if (!ctx.dryRun) await ctx.graph.patch(`/groupLifecyclePolicies/${lifecycle.id}`, desired);
        steps.push({ action: 'actualizar', target: 'Directiva de expiración de grupos', payload: desired });
      } else {
        steps.push({ action: 'sin-cambios', target: 'Directiva de expiración de grupos' });
      }
      // Creación restringida
      let creatorsId = '';
      if (p.restrictCreation) {
        const name = `${PREFIX}-Creadores-Grupos-M365`;
        const r = await ensureObject(ctx, {
          path: '/groups',
          name,
          serverFilter: true,
          body: {
            displayName: name,
            description: 'Miembros autorizados a crear grupos de Microsoft 365 y equipos de Teams',
            mailEnabled: false,
            mailNickname: 'gob-creadores-grupos',
            securityEnabled: true,
          },
          updateOmit: ['mailEnabled', 'mailNickname', 'securityEnabled'],
          label: 'Grupo',
        });
        steps.push(r.step);
        creatorsId = r.id;
      }
      const prefix = String(p.prefix ?? '').trim();
      steps.push(
        await ensureDirectorySetting(
          ctx,
          'Group.Unified',
          [
            { name: 'EnableGroupCreation', value: p.restrictCreation ? 'false' : 'true' },
            { name: 'GroupCreationAllowedGroupId', value: creatorsId },
            { name: 'PrefixSuffixNamingRequirement', value: prefix ? `${prefix}[GroupName]` : '' },
            { name: 'EnableMIPLabels', value: p.enableLabels ? 'true' : 'false' },
          ],
          'Configuración de grupos (Group.Unified)',
        ),
      );
      return steps;
    },
  },

  {
    id: 'entra-dynamic-groups',
    title: 'Grupos dinámicos base (usuarios y dispositivos)',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['dynamic-groups'],
    summary: 'Grupos que se mantienen solos según reglas: la base para asignar políticas de Intune sin trabajo manual.',
    changes: [
      `${PREFIX}-Usuarios-Internos (miembros activos)`,
      `${PREFIX}-Dispositivos-Windows / iOS / Android / macOS`,
      `${PREFIX}-Dispositivos-Autopilot`,
    ],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 0,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: ['Group.ReadWrite.All'],
    docsUrl: 'https://learn.microsoft.com/entra/identity/users/groups-dynamic-membership',
    run: async (ctx) => {
      const steps: PlanStep[] = [];
      for (const g of DYNAMIC_GROUPS) {
        const name = `${PREFIX}-${g.suffix}`;
        const r = await ensureObject(ctx, {
          path: '/groups',
          name,
          serverFilter: true,
          body: {
            displayName: name,
            description: g.description,
            mailEnabled: false,
            mailNickname: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            securityEnabled: true,
            groupTypes: ['DynamicMembership'],
            membershipRule: g.rule,
            membershipRuleProcessingState: 'On',
          },
          updateOmit: ['mailEnabled', 'mailNickname', 'securityEnabled', 'groupTypes'],
          label: 'Grupo dinámico',
        });
        ctx.outputs[`group:${g.suffix}`] = r.id;
        steps.push(r.step);
      }
      return steps;
    },
  },

  {
    id: 'entra-admin-units',
    title: 'Unidades administrativas por área',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['administrative-units'],
    summary: 'Delega la administración de usuarios por área o sucursal sin dar permisos sobre toda la empresa.',
    changes: ['Una unidad administrativa dinámica por cada área (según el atributo Departamento)'],
    userImpact: 'Ninguno.',
    risk: 'bajo',
    phase: 4,
    profiles: ['estricto'],
    params: [
      {
        key: 'units',
        label: 'Áreas / departamentos',
        type: 'list',
        default: [],
        help: 'Deben coincidir con el campo "Departamento" de los usuarios.',
      },
    ],
    permissions: ['AdministrativeUnit.ReadWrite.All'],
    run: async (ctx, p) => {
      const units = asList(p.units);
      if (!units.length) return [{ action: 'aviso', target: 'Unidades administrativas', detail: 'No se indicaron áreas' }];
      const steps: PlanStep[] = [];
      for (const unit of units) {
        const clean = unit.replace(/["\\]/g, '');
        const name = `${PREFIX}-UA-${clean}`;
        const r = await ensureObject(ctx, {
          path: '/directory/administrativeUnits',
          name,
          beta: true,
          body: {
            displayName: name,
            description: `Usuarios del área ${clean}`,
            membershipType: 'Dynamic',
            membershipRule: `(user.department -eq "${clean}")`,
            membershipRuleProcessingState: 'On',
          },
          label: 'Unidad administrativa',
        });
        steps.push(r.step);
      }
      return steps;
    },
  },

  {
    id: 'entra-branding',
    title: 'Página de inicio de sesión personalizada',
    pillar: 'entra',
    engine: 'graph',
    tiles: ['customized-sign-in'],
    summary: 'Agrega un texto propio en la página de inicio de sesión: ayuda a los usuarios a detectar páginas falsas.',
    changes: ['Texto de la página de inicio de sesión', 'Pista del nombre de usuario'],
    userImpact: 'Verán el mensaje de la empresa al iniciar sesión.',
    risk: 'bajo',
    phase: 4,
    profiles: ['recomendado', 'estricto'],
    params: [
      {
        key: 'signInText',
        label: 'Texto de inicio de sesión',
        type: 'text',
        default: 'Acceso exclusivo para colaboradores. Nunca te pediremos tu contraseña por correo.',
      },
      { key: 'usernameHint', label: 'Pista de usuario', type: 'text', default: 'nombre.apellido@empresa.cl' },
    ],
    permissions: ['Organization.ReadWrite.All'],
    run: async (ctx, p) => {
      const org = (await ctx.graph.list<any>('/organization?$select=id'))[0];
      if (!org) throw new Error('No se pudo leer la organización');
      const path = `/organization/${org.id}/branding`;
      let current: any = {};
      try {
        current = await ctx.graph.get(path);
      } catch (e) {
        if (!(e instanceof GraphError && e.status === 404)) throw e;
      }
      const desired = { signInPageText: String(p.signInText).slice(0, 1024), usernameHintText: String(p.usernameHint).slice(0, 64) };
      if (!diff(desired, current).length) return [{ action: 'sin-cambios', target: 'Personalización de inicio de sesión' }];
      if (!ctx.dryRun) await ctx.graph.patch(path, desired);
      return [{ action: 'actualizar', target: 'Personalización de inicio de sesión', payload: desired }];
    },
  },

  {
    id: 'entra-sspr',
    title: 'Restablecimiento de contraseña de autoservicio (SSPR)',
    pillar: 'entra',
    engine: 'manual',
    tiles: ['sspr', 'self-service-activity-reports'],
    summary:
      'Los usuarios recuperan su contraseña sin llamar a soporte. Microsoft no expone esta activación vía API: se entrega el paso a paso.',
    changes: ['SSPR para todos los usuarios', 'Registro combinado con MFA', 'Escritura diferida a AD local (si hay sincronización)'],
    userImpact: 'Podrán restablecer su contraseña desde aka.ms/sspr.',
    risk: 'bajo',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Entra ID → Restablecimiento de contraseña → Propiedades → "Todos". Métodos: 2 requeridos (Authenticator + correo/teléfono).',
        url: 'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/PasswordResetMenuBlade/~/Properties',
      },
      { text: 'Si usas Entra Connect: habilita "Escritura diferida de contraseñas" en Entra Connect / Cloud Sync.' },
      { text: 'Notifica a los usuarios: aka.ms/sspr para restablecer y aka.ms/mysecurityinfo para registrar métodos.' },
    ],
    docsUrl: 'https://learn.microsoft.com/entra/identity/authentication/tutorial-enable-sspr',
  },

  {
    id: 'entra-device-join',
    title: 'Unión a Entra ID e inscripción automática en Intune',
    pillar: 'entra',
    engine: 'manual',
    tiles: ['entra-id-join', 'manage-by-mdm', 'domain-join', 'enterprise-state-roaming'],
    summary: 'Permite unir equipos Windows a Entra ID e inscribirlos solos en Intune. Requisito para las políticas de dispositivos.',
    changes: ['Quién puede unir dispositivos', 'Ámbito de usuario MDM de Intune = Todos', 'Sin administrador local para el usuario'],
    userImpact: 'Al configurar Windows con la cuenta de trabajo, el equipo queda administrado por la empresa.',
    risk: 'medio',
    phase: 2,
    profiles: ['esencial', 'recomendado', 'estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Entra ID → Dispositivos → Configuración de dispositivos: "Los usuarios pueden unir dispositivos" = Todos (o grupo), "Administradores locales adicionales" = Ninguno, habilitar Microsoft Entra LAPS.',
        url: 'https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DevicesMenuBlade/~/DeviceSettings',
      },
      {
        text: 'Intune → Dispositivos → Inscripción → Windows → Inscripción automática: Ámbito de usuario MDM = Todos.',
        url: 'https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesEnrollmentMenu/~/windowsEnrollment',
      },
      { text: 'Enterprise State Roaming: Dispositivos → Configuración → "Los usuarios pueden sincronizar configuración" = Todos.' },
    ],
    docsUrl: 'https://learn.microsoft.com/mem/intune/enrollment/windows-enroll',
  },

  {
    id: 'entra-terms-of-use',
    title: 'Términos de uso',
    pillar: 'entra',
    engine: 'manual',
    tiles: ['terms-of-use'],
    summary: 'Solicita aceptar la política de uso aceptable (PDF) antes de acceder, con registro de aceptación.',
    changes: ['Términos de uso en PDF', 'Política de Acceso Condicional que exige aceptarlos'],
    userImpact: 'Deberán aceptar el documento una vez (o cada X días).',
    risk: 'bajo',
    phase: 4,
    profiles: ['estricto'],
    params: [],
    permissions: [],
    manualSteps: [
      {
        text: 'Entra ID → Acceso condicional → Términos de uso → Nuevos términos: sube el PDF de la política de uso aceptable.',
        url: 'https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/TermsOfUse.ReactView',
      },
      { text: 'Crea una política de Acceso Condicional que exija estos términos para Todos los usuarios (excluye cuentas de emergencia).' },
    ],
  },
];

export const DYNAMIC_GROUPS = [
  { suffix: 'Usuarios-Internos', description: 'Usuarios miembros habilitados', rule: '(user.userType -eq "Member") -and (user.accountEnabled -eq true)' },
  { suffix: 'Dispositivos-Windows', description: 'Equipos Windows', rule: '(device.deviceOSType -eq "Windows")' },
  { suffix: 'Dispositivos-iOS', description: 'iPhone y iPad', rule: '(device.deviceOSType -eq "iPhone") -or (device.deviceOSType -eq "iPad")' },
  { suffix: 'Dispositivos-Android', description: 'Dispositivos Android', rule: '(device.deviceOSType -eq "Android")' },
  { suffix: 'Dispositivos-macOS', description: 'Equipos macOS', rule: '(device.deviceOSType -eq "MacMDM")' },
  { suffix: 'Dispositivos-Autopilot', description: 'Equipos registrados en Windows Autopilot', rule: '(device.devicePhysicalIDs -any (_ -startsWith "[ZTDid]"))' },
];

/** Configuración de directorio basada en plantilla (Password Rule Settings, Group.Unified). */
async function ensureDirectorySetting(
  ctx: Ctx,
  templateName: string,
  values: { name: string; value: string }[],
  label: string,
): Promise<PlanStep> {
  const templates = await ctx.graph.list<any>('/groupSettingTemplates');
  const template = templates.find((t) => t.displayName === templateName);
  if (!template) throw new Error(`No se encontró la plantilla de configuración "${templateName}"`);
  const existing = (await ctx.graph.list<any>('/settings')).find((s) => s.templateId === template.id);
  if (!existing) {
    const body = { templateId: template.id, values };
    if (!ctx.dryRun) await ctx.graph.post('/settings', body);
    return { action: 'crear', target: label, payload: body };
  }
  const current = new Map<string, string>((existing.values ?? []).map((v: any) => [v.name, String(v.value ?? '')]));
  const changed = values.filter((v) => current.get(v.name) !== v.value);
  if (!changed.length) return { action: 'sin-cambios', target: label };
  // PATCH reemplaza la colección completa: se conservan los valores no gestionados aquí
  const merged = [...current.entries()].map(([name, value]) => ({ name, value }));
  for (const v of values) {
    const found = merged.find((m) => m.name === v.name);
    if (found) found.value = v.value;
    else merged.push(v);
  }
  if (!ctx.dryRun) await ctx.graph.patch(`/settings/${existing.id}`, { values: merged });
  return { action: 'actualizar', target: label, detail: `Valores: ${changed.map((c) => c.name).join(', ')}`, payload: { values: merged } };
}
