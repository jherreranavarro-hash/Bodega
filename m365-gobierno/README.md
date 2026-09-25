# Gobierno M365 — Business Premium en un clic

Aplicación web para **activar y gobernar Entra ID, Intune, Defender y Purview** de Microsoft 365
Business Premium desde un frontend didáctico. El frontend replica el
[mapa de licencias de m365maps.com](https://m365maps.com/files/Microsoft-365-Business-Premium.htm):
cada caja es un botón que explica la capacidad, muestra la recomendación del Assessment y permite
aplicarla en el tenant. Por debajo, un motor de automatización (playbooks idempotentes) aplica las
políticas vía **Microsoft Graph** y **Exchange Online / Purview PowerShell**.

```
backend/   API (Node.js + TypeScript + Express): motor de playbooks, assessment, despliegues
frontend/  Aplicación web (React + Vite): mapa, fichas, assessment, plan, historial, conexión
```

## Flujo de trabajo

1. **Assessment** — lee el tenant en solo lectura (licencias, MFA, Acceso Condicional, admins,
   dispositivos, Secure Score, uso compartido…) y lo combina con un cuestionario de contexto
   (industria, BYOD, datos sensibles, Ley 21.719, equipo de TI, tolerancia al cambio). Entrega
   puntaje por pilar, hallazgos priorizados, **perfil de gobierno** (esencial / recomendado /
   estricto) y una hoja de ruta en 5 fases con parámetros ya ajustados a la empresa.
2. **Mapa** — cada caja muestra su estado (✓ desplegado, ◐ parcial, ⚙ configurable, ⧗ pasos
   manuales, ★ recomendado). Al abrirla: qué es, qué se configura, impacto en usuarios, riesgo,
   parámetros editables, requisitos y documentación de Microsoft.
3. **Plan de despliegue** — reúne playbooks (desde el mapa o "Cargar plan recomendado"),
   agrega dependencias automáticamente y las ordena.
4. **Previsualizar** — lee el tenant y muestra exactamente qué se creará/actualizará (con la
   petición a Graph o el script PowerShell). No escribe nada.
5. **Desplegar** — ejecuta en orden, con registro en vivo e historial trazable.

## Gobierno documental, evidencia y métricas

**Documentos formales** (página *Documentos*; se abren listos para imprimir/guardar como PDF,
con tabla de aprobaciones para firma):

| Código | Documento | Contenido |
|---|---|---|
| GOB-DEC-01 | Declaración de aplicabilidad y hoja de ruta | Declaración formal, hallazgos del Assessment, hoja de ruta con fechas por fase, **SoA ISO/IEC 27001:2022** (estado por control) y matriz de la **Ley 21.719** |
| GOB-POL-IAM / END / THR / DAT | Política por módulo (Entra ID, Intune, Defender, Purview) | Objetivo, alcance, referencias normativas, roles, declaraciones con los valores configurados, excepciones, revisión |
| GOB-PRC-&lt;acción&gt; | Procedimiento de ejecución por playbook | Justificación, configuración, impacto, prerrequisitos, pasos DEV→POC→PRD, criterios de aceptación, plan de reversa, controles |
| GOB-EVD-&lt;id&gt; | Acta de evidencia de despliegue | Por cada recurso modificado: **cómo estaba y cómo quedó**, métricas antes/después, controles ISO 27001 y deberes de la Ley 21.719; huella **SHA-256** que detecta alteraciones |

**Evidencia:** cada despliegue lee cada recurso antes y después de escribirlo (Graph) o
registra el script y su salida (PowerShell). Se guarda en `backend/data/evidencia/<id>.json`
+ `.sha256`, y se descarga como acta o JSON desde *Historial* o *Documentos*.

**Métricas:** cada Assessment, cada despliegue (antes y después) y cada medición manual guardan
una instantánea por ambiente: madurez global y por módulo, Secure Score, % MFA, Acceso
Condicional aplicado, administradores globales, dispositivos administrados/conformes/cifrados,
hallazgos críticos+altos y controles desplegados. La página *Métricas* compara línea base vs
actual y muestra la evolución y el antes/después de cada despliegue.

La correspondencia con ISO 27001 y la Ley 21.719 está en `backend/src/compliance/controls.ts`.
Las referencias legales son orientativas y deben validarse con asesoría legal.

## Qué automatiza

| Pilar | Automatizado | Motor |
|---|---|---|
| **Entra ID** | Cuentas de emergencia, Authenticator + contexto, campaña de registro, TAP, FIDO2/passkeys, Acceso Condicional CA01–CA09 (admins, todos, legacy, Azure, países, dispositivo conforme, móviles MAM, sesión, registro MFA), reemplazo seguro de security defaults, permisos de usuario/consentimiento, protección de contraseñas, gobierno de grupos, grupos dinámicos, unidades administrativas, branding | Graph |
| **Intune** | Cumplimiento Windows/iOS/Android/macOS, BitLocker, BitLocker To Go, Firewall, LAPS, Windows Update for Business, Windows Hello, MAM iOS/Android, Autopilot | Graph |
| **Defender** | Antivirus NGP + bloqueo a primera vista, reglas ASR, Safe Links, Safe Attachments, antiphishing, bloqueo de reenvío externo, endurecimiento de Exchange (SMTP AUTH, etiqueta externa, DKIM) | Graph + Exchange PowerShell |
| **Purview** | Auditoría unificada, etiquetas de confidencialidad (con cifrado), DLP (RUT, tarjetas, IBAN…), retención, archivo, cifrado de mensajes, uso compartido SharePoint/OneDrive | Purview/Exchange PowerShell + Graph |

Lo que Microsoft **no expone por API** (SSPR, conector Defender↔Intune, tamper protection,
filtrado web, Autopatch, términos de uso…) aparece como **playbook guiado**: pasos con enlace
directo al portal y botón "Marcar como completado". Las cajas de productividad (Bookings,
Forms, Sway…) se muestran como incluidas en la licencia.

### Salvaguardas de gobierno

- Todo objeto creado lleva prefijo `GOB-` y los playbooks son **idempotentes** (si ya existe,
  solo se actualiza lo que difiere).
- Todas las políticas de Acceso Condicional excluyen el grupo de **cuentas de emergencia**.
- Las políticas de impacto amplio se crean por defecto en **modo informe** (report-only).
- Los *security defaults* **solo** se desactivan si CA01–CA03 quedan aplicadas en el mismo
  despliegue; si están activos, las políticas se crean en modo informe y se activan justo
  después de desactivarlos.
- Si un playbook falla, sus dependientes se omiten.
- En modo real el despliegue exige confirmación explícita del tenant.

## Puesta en marcha

Requisitos: Node.js 20+. Para Exchange/Purview: PowerShell 7 (`pwsh`) en el servidor.

```bash
./iniciar.sh            # macOS / Linux
./iniciar.ps1           # Windows (PowerShell)
```

Abre http://localhost:4100. Sin ambientes conectados trabaja en **modo simulación** contra un tenant
de demostración (pyme chilena con Business Premium), ideal para capacitación y para validar
el plan. Desarrollo: `npm run dev` en `backend/` y en `frontend/` (http://localhost:5180).

## Ambientes DEV / POC / PRD e inicio de sesión del administrador

La app trabaja con **ambientes**: cada uno es un tenant (DEV, POC, PRD) con su propio registro
de aplicación. Se administran en la página **Conexión**, y el ambiente activo se elige en la
barra superior (insignia azul DEV, morada POC, roja PRD).

**Cómo se autentica el administrador:** al pulsar *Iniciar sesión con Microsoft (MFA)* se abre
la página oficial `login.microsoftonline.com`. Allí el administrador escribe **su contraseña y
aprueba el MFA**; Microsoft devuelve un código que la app canjea por un token (OAuth 2.0
*authorization code* + PKCE, sin secreto). La aplicación:

- **nunca ve ni guarda la contraseña** (pedirla en un formulario propio no es compatible con MFA
  y Microsoft lo bloquea);
- **rechaza la sesión si no se validó con MFA** (claim `amr`), si la cuenta es de otro tenant o
  si no es la cuenta de administrador asignada al ambiente;
- fuerza reingresar credenciales en cada inicio (`prompt=login`);
- guarda los tokens **solo en memoria**: expiran tras 8 h sin uso o al reiniciar el servidor;
- registra en el historial qué cuenta ejecutó cada despliegue.

**Salvaguardas de producción (PRD):** el despliegue exige escribir el nombre del ambiente, y
advierte (con confirmación adicional) de los playbooks que aún no se desplegaron con éxito en
DEV o POC. Flujo recomendado: DEV → POC → PRD.

### Revisión previa de accesos (solo lectura)

Antes de registrar la app, verifica que la cuenta tenga lo necesario (roles, MFA, licencia
Business Premium, lectura de Acceso Condicional e Intune):

```powershell
# Windows, sin instalar nada:
powershell -ExecutionPolicy Bypass -File .\revisar-accesos.ps1 -Tenant contoso.onmicrosoft.com
# o con Node.js:
cd backend; npm run revisar-accesos -- contoso.onmicrosoft.com
```

Muestra un código para ingresar en https://microsoft.com/devicelogin: la contraseña y el MFA se
ingresan en tu navegador. Solo pide permisos de lectura y no modifica nada.

### Registro de aplicación automático

```powershell
powershell -ExecutionPolicy Bypass -File .\crear-registro-app.ps1 -Tenant contoso.onmicrosoft.com
```

Crea el registro "Gobierno M365" (sin secretos, cliente público con la URI de redirección),
concede los permisos delegados con consentimiento de administrador y restringe su uso a las
cuentas asignadas (quien lo ejecuta y las indicadas en `-Administradores`). Muestra el Tenant ID
y el Client ID para agregar el ambiente en la app. Pide confirmación antes de escribir.

### Registro de aplicación manual (una vez por tenant)

1. Entra ID → Registros de aplicaciones → **Nuevo registro** (solo este directorio).
2. Autenticación → Agregar plataforma → **Aplicaciones móviles y de escritorio** → URI de
   redirección `http://localhost:4100/api/auth/callback` (o `<PUBLIC_URL>/api/auth/callback`;
   la página Conexión muestra el valor exacto).
3. Permisos de API → Microsoft Graph → **permisos delegados** (+ consentimiento de administrador):
   `Policy.Read.All, Policy.ReadWrite.ConditionalAccess, Policy.ReadWrite.AuthenticationMethod,
   Policy.ReadWrite.Authorization, Application.Read.All, Directory.ReadWrite.All,
   Group.ReadWrite.All, User.Read.All, AdministrativeUnit.ReadWrite.All,
   Organization.ReadWrite.All, DeviceManagementConfiguration.ReadWrite.All,
   DeviceManagementServiceConfig.ReadWrite.All, DeviceManagementApps.ReadWrite.All,
   SharePointTenantSettings.ReadWrite.All, offline_access` y, para el Assessment,
   `AuditLog.Read.All, UserAuthenticationMethod.Read.All, RoleManagement.Read.Directory,
   DeviceManagementManagedDevices.Read.All, SecurityEvents.Read.All, Reports.Read.All`.
   Para Exchange/Purview: Office 365 Exchange Online → delegado `Exchange.Manage`.
4. En la app: Conexión → *Agregar ambiente* → nombre, tipo, **Tenant ID**, **Client ID**,
   cuenta de administrador y (opcional) dominio inicial → *Iniciar sesión con Microsoft (MFA)*.

La cuenta necesita roles suficientes (Administrador global, o Seguridad + Intune + Exchange +
Cumplimiento). Con sesión delegada, los scripts de Exchange/Purview se ejecutan con el token del
administrador (`Connect-ExchangeOnline -AccessToken`, requiere `pwsh` y el módulo
ExchangeOnlineManagement 3.x en el servidor); si no están disponibles o la versión del módulo no
admite token para Purview, se ofrece **Descargar script .ps1** para ejecutarlo con inicio de
sesión interactivo.

### Opcional: ambiente desatendido

Para automatización sin persona se puede seguir usando un registro con permisos de
**aplicación** y certificado en `backend/.env` (`TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` o
`CERT_PEM_PATH`, `CERT_PFX_PATH`). Aparece como ambiente "Aplicación (.env)" y se trata como
producción.

## Pruebas

```bash
cd backend && npm test
```

Cubren el inicio de sesión del administrador (PKCE, rechazo sin MFA, otro tenant o cuenta distinta, renovación de tokens), las salvaguardas de PRD, la integridad del catálogo (cajas, dependencias, ciclos), despliegue completo en el
tenant simulado + idempotencia (segunda ejecución sin cambios), que la previsualización no
escribe, la salvaguarda de *security defaults*, el Assessment y la API.

## Recomendación antes de producción

Ejecuta primero contra un **tenant de pruebas** (o de desarrollo de Microsoft 365). Los
playbooks de catálogo de configuración de Intune usan identificadores de configuración
(`settingDefinitionId`) documentados por Microsoft que pueden cambiar entre versiones; el marcado
"Validar en tenant de pruebas" indica los de menor certeza. Revisa los registros de inicio de
sesión 7–14 días antes de pasar políticas de Acceso Condicional de "solo informe" a "aplicada".
