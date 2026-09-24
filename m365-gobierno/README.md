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

Abre http://127.0.0.1:4100. Sin credenciales arranca en **modo simulación** contra un tenant
de demostración (pyme chilena con Business Premium), ideal para capacitación y para validar
el plan. Desarrollo: `npm run dev` en `backend/` y en `frontend/` (http://localhost:5180).

## Conectar el tenant real

1. Entra ID → Registros de aplicaciones → Nuevo registro (un solo inquilino).
2. Permisos de **aplicación** de Microsoft Graph (+ consentimiento de administrador). La lista
   exacta aparece en la página **Conexión** con ✓/✖ según lo concedido:
   `Policy.Read.All, Policy.ReadWrite.ConditionalAccess, Policy.ReadWrite.AuthenticationMethod,
   Policy.ReadWrite.Authorization, Application.Read.All, Directory.ReadWrite.All,
   Group.ReadWrite.All, User.Read.All, AdministrativeUnit.ReadWrite.All,
   Organization.ReadWrite.All, DeviceManagementConfiguration.ReadWrite.All,
   DeviceManagementServiceConfig.ReadWrite.All, DeviceManagementApps.ReadWrite.All,
   SharePointTenantSettings.ReadWrite.All` y, para el Assessment,
   `AuditLog.Read.All, UserAuthenticationMethod.Read.All, RoleManagement.Read.Directory,
   DeviceManagementManagedDevices.Read.All, SecurityEvents.Read.All, Reports.Read.All`.
3. Exchange/Purview: permiso `Office 365 Exchange Online → Exchange.ManageAsApp` y roles
   **Administrador de Exchange** y **Administrador de cumplimiento** asignados a la app.
4. Sube un certificado a la app. Completa `backend/.env` (ver `.env.example`):
   `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` o `CERT_PEM_PATH`, y `CERT_PFX_PATH` +
   `CERT_PFX_PASSWORD` para PowerShell. Reinicia: la barra superior mostrará el tenant.

Si `pwsh` o el certificado no están disponibles, los playbooks de Exchange/Purview quedan como
"pasos manuales" y ofrecen **Descargar script .ps1** (idempotente, con inicio de sesión
interactivo) para que un administrador lo ejecute.

## Pruebas

```bash
cd backend && npm test
```

Cubren la integridad del catálogo (cajas, dependencias, ciclos), despliegue completo en el
tenant simulado + idempotencia (segunda ejecución sin cambios), que la previsualización no
escribe, la salvaguarda de *security defaults*, el Assessment y la API.

## Recomendación antes de producción

Ejecuta primero contra un **tenant de pruebas** (o de desarrollo de Microsoft 365). Los
playbooks de catálogo de configuración de Intune usan identificadores de configuración
(`settingDefinitionId`) documentados por Microsoft que pueden cambiar entre versiones; el marcado
"Validar en tenant de pruebas" indica los de menor certeza. Revisa los registros de inicio de
sesión 7–14 días antes de pasar políticas de Acceso Condicional de "solo informe" a "aplicada".
