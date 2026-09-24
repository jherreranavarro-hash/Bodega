/**
 * Revisión de accesos (SOLO LECTURA) de una cuenta de administrador antes de usar Gobierno M365.
 *
 *   npx tsx scripts/revisar-accesos.ts <tenant>      ej: contoso.onmicrosoft.com
 *
 * Usa el flujo "device code": el script muestra un código, el administrador lo ingresa en
 * https://microsoft.com/devicelogin desde SU navegador y allí escribe contraseña y aprueba MFA.
 * El script nunca ve la contraseña, solo pide permisos de lectura, y el token vive en memoria.
 * No modifica nada en el tenant.
 */
import { GraphClient, decodeJwt } from '../src/graph/client.js';

// "Microsoft Graph Command Line Tools": cliente público de Microsoft, no requiere registrar una app
const CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const SCOPES = [
  'User.Read',
  'Directory.Read.All',
  'Policy.Read.All',
  'RoleManagement.Read.Directory',
  'Application.Read.All',
  'UserAuthenticationMethod.Read',
  'DeviceManagementManagedDevices.Read.All',
  'DeviceManagementConfiguration.Read.All',
  'SecurityEvents.Read.All',
].map((s) => `https://graph.microsoft.com/${s}`);

const tenant = process.argv[2];
if (!tenant) {
  console.error('Uso: npx tsx scripts/revisar-accesos.ts <tenant.onmicrosoft.com | tenant-id>');
  process.exit(1);
}
const LOGIN = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deviceCodeLogin(): Promise<string> {
  const dc: any = await (await fetch(`${LOGIN}/devicecode`, form({ client_id: CLIENT_ID, scope: `${SCOPES.join(' ')} openid profile` }))).json();
  if (!dc.device_code) throw new Error(`No se pudo iniciar el inicio de sesión: ${dc.error_description ?? JSON.stringify(dc)}`);
  console.log(`\n>>> Abre ${dc.verification_uri} e ingresa el código: ${dc.user_code}`);
  console.log('>>> Inicia sesión con la cuenta de administrador y aprueba el MFA. (Expira en 15 minutos)\n');
  const until = Date.now() + dc.expires_in * 1000;
  while (Date.now() < until) {
    await sleep((dc.interval ?? 5) * 1000);
    const r: any = await (
      await fetch(`${LOGIN}/token`, form({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code }))
    ).json();
    if (r.access_token) return r.access_token;
    if (r.error !== 'authorization_pending' && r.error !== 'slow_down') throw new Error(r.error_description ?? r.error);
  }
  throw new Error('El código expiró sin iniciar sesión');
}

type Row = { area: string; ok: boolean | null; detail: string; fix?: string };

async function main() {
  const token = await deviceCodeLogin();
  const claims = decodeJwt(token);
  const graph = new GraphClient(async () => token);
  const rows: Row[] = [];
  const check = async (area: string, fn: () => Promise<Omit<Row, 'area'>>) => {
    try {
      rows.push({ area, ...(await fn()) });
    } catch (e: any) {
      rows.push({ area, ok: null, detail: e?.status === 403 ? 'Sin permiso para leer (403)' : e?.message ?? String(e) });
    }
  };
  const amr: string[] = claims.amr ?? [];

  await check('Sesión', async () => ({
    ok: amr.includes('mfa') || amr.includes('ngcmfa') || amr.includes('fido'),
    detail: `${claims.upn ?? claims.unique_name} · tenant ${claims.tid} · métodos: ${amr.join(', ')}`,
    fix: 'La sesión no registró MFA: registra Authenticator/FIDO2 para esta cuenta.',
  }));
  await check('Roles del administrador', async () => {
    const roles = await graph.list<any>('/me/transitiveMemberOf/microsoft.graph.directoryRole?$select=displayName,roleTemplateId');
    const names = roles.map((r) => r.displayName);
    const ga = roles.some((r) => r.roleTemplateId === '62e90394-69f5-4237-9190-012177145e10');
    return { ok: ga, detail: names.join(', ') || 'ninguno activo (¿PIM sin activar?)', fix: 'Se necesita Administrador global (o Seguridad + Intune + Exchange + Cumplimiento + Aplicaciones).' };
  });
  await check('Métodos MFA de la cuenta', async () => {
    const m = await graph.list<any>('/me/authentication/methods');
    const types = m.map((x) => String(x['@odata.type']).replace('#microsoft.graph.', '').replace('AuthenticationMethod', ''));
    return { ok: types.some((t) => t !== 'password'), detail: types.join(', '), fix: 'Registra Microsoft Authenticator o una llave FIDO2.' };
  });
  await check('Licencia Business Premium', async () => {
    const skus = await graph.list<any>('/subscribedSkus');
    const spb = skus.find((s) => s.skuPartNumber === 'SPB');
    return {
      ok: Boolean(spb),
      detail: spb ? `${spb.consumedUnits}/${spb.prepaidUnits?.enabled} asignadas` : `SKUs: ${skus.map((s) => s.skuPartNumber).join(', ') || 'ninguno'}`,
      fix: 'Sin Business Premium no hay Entra ID P1 ni Intune (Acceso Condicional, cumplimiento).',
    };
  });
  await check('Administradores globales', async () => {
    const m = await graph.list<any>("/directoryRoles(roleTemplateId='62e90394-69f5-4237-9190-012177145e10')/members?$select=userPrincipalName");
    return { ok: m.length >= 2 && m.length <= 4, detail: `${m.length}: ${m.map((x) => x.userPrincipalName).join(', ')}`, fix: 'Recomendado 2-4, incluidas cuentas de emergencia.' };
  });
  await check('Valores predeterminados de seguridad', async () => {
    const sd = await graph.get<any>('/policies/identitySecurityDefaultsEnforcementPolicy');
    return { ok: true, detail: sd.isEnabled ? 'Activos (la app los reemplaza de forma segura por Acceso Condicional)' : 'Inactivos' };
  });
  await check('Acceso Condicional (lectura)', async () => {
    const p = await graph.list<any>('/identity/conditionalAccess/policies?$select=displayName,state');
    return { ok: true, detail: `${p.length} políticas: ${p.map((x) => `${x.displayName} [${x.state}]`).join('; ') || '—'}` };
  });
  await check('Registro de apps permitido', async () => {
    const apps = await graph.list<any>("/applications?$filter=startswith(displayName,'Gobierno')&$select=displayName,appId");
    return { ok: true, detail: apps.length ? `Ya existe: ${apps.map((a) => `${a.displayName} (${a.appId})`).join(', ')}` : 'Aún no existe el registro "Gobierno M365"' };
  });
  await check('Intune (lectura)', async () => {
    const [d, c] = await Promise.all([
      graph.list<any>('/deviceManagement/managedDevices?$select=id', { max: 1000 }),
      graph.list<any>('/deviceManagement/deviceCompliancePolicies?$select=id'),
    ]);
    return { ok: true, detail: `${d.length} dispositivos administrados, ${c.length} políticas de cumplimiento` };
  });
  await check('Secure Score', async () => {
    const s = (await graph.list<any>('/security/secureScores?$top=1', { max: 1 }))[0];
    return { ok: true, detail: s ? `${Math.round(s.currentScore)}/${Math.round(s.maxScore)} (${Math.round((s.currentScore / s.maxScore) * 100)}%)` : 'sin datos' };
  });

  console.log('\n=== Revisión de accesos (solo lectura) ===');
  for (const r of rows) {
    const mark = r.ok === null ? '?' : r.ok ? '✓' : '✖';
    console.log(`${mark} ${r.area}: ${r.detail}${r.ok === false && r.fix ? `\n    → ${r.fix}` : ''}`);
  }
}

main().catch((e) => {
  console.error(`Error: ${e?.message ?? e}`);
  process.exit(1);
});
