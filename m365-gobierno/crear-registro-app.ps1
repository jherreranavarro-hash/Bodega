<#
  Crea (o actualiza) el registro de aplicación "Gobierno M365" en el tenant, listo para que la app
  inicie sesión con la cuenta del administrador (contraseña + MFA en Microsoft).

  Uso (PowerShell de Windows, sin instalar nada):
    powershell -ExecutionPolicy Bypass -File .\crear-registro-app.ps1 -Tenant contoso.onmicrosoft.com

  Qué hace (muestra el resumen y pide confirmación antes de escribir):
    1. Registro "Gobierno M365" de un solo tenant, cliente público (sin secretos), con la
       URI de redirección http://localhost:4100/api/auth/callback
    2. Permisos delegados de Microsoft Graph y Exchange.Manage, con consentimiento de administrador
    3. "Asignación requerida": SOLO las cuentas asignadas pueden usar la app (se asigna quien lo ejecuta
       y las cuentas de -Administradores)
  Es idempotente: si ya existe, solo completa lo que falte. No crea secretos ni certificados.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tenant,
  [string]$RedirectUri = 'http://localhost:4100/api/auth/callback',
  [string[]]$Administradores = @()
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$AppName = 'Gobierno M365'
$GraphAppId = '00000003-0000-0000-c000-000000000000'
$ExchangeAppId = '00000002-0000-0ff1-ce00-000000000000'
$GraphScopes = @(
  'User.Read', 'openid', 'profile', 'offline_access',
  'Policy.Read.All', 'Policy.ReadWrite.ConditionalAccess', 'Policy.ReadWrite.SecurityDefaults',
  'Policy.ReadWrite.AuthenticationMethod', 'Policy.ReadWrite.Authorization',
  'Application.Read.All', 'Directory.ReadWrite.All', 'Group.ReadWrite.All', 'User.Read.All',
  'AdministrativeUnit.ReadWrite.All', 'Organization.ReadWrite.All',
  'DeviceManagementConfiguration.ReadWrite.All', 'DeviceManagementServiceConfig.ReadWrite.All',
  'DeviceManagementApps.ReadWrite.All', 'DeviceManagementManagedDevices.Read.All',
  'SharePointTenantSettings.ReadWrite.All',
  'AuditLog.Read.All', 'UserAuthenticationMethod.Read.All', 'RoleManagement.Read.Directory',
  'SecurityEvents.Read.All', 'Reports.Read.All'
)
$ExchangeScopes = @('Exchange.Manage')

# ---------- Inicio de sesión (código de dispositivo; contraseña y MFA en Microsoft) ----------
$CliClient = '14d82eec-204b-4c2f-b7e8-296a70dab67e'  # Microsoft Graph Command Line Tools
$LoginScopes = @('Application.ReadWrite.All', 'DelegatedPermissionGrant.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'User.Read.All') |
  ForEach-Object { "https://graph.microsoft.com/$_" }
$Login = "https://login.microsoftonline.com/$Tenant/oauth2/v2.0"
$dc = Invoke-RestMethod -Method Post -Uri "$Login/devicecode" -Body @{ client_id = $CliClient; scope = (($LoginScopes + 'openid', 'profile') -join ' ') }
Write-Host ''
Write-Host "Abre $($dc.verification_uri) e ingresa el código: $($dc.user_code)" -ForegroundColor Yellow
Write-Host 'Inicia sesión como Administrador global y aprueba el MFA (expira en 15 minutos).' -ForegroundColor Yellow
try { Set-Clipboard -Value $dc.user_code; Write-Host '(El código quedó copiado en el portapapeles)' } catch {}
try { Start-Process $dc.verification_uri } catch {}
$token = $null
$until = (Get-Date).AddSeconds([int]$dc.expires_in)
while (-not $token -and (Get-Date) -lt $until) {
  Start-Sleep -Seconds ([int]$dc.interval)
  try {
    $token = (Invoke-RestMethod -Method Post -Uri "$Login/token" -Body @{
        client_id = $CliClient; grant_type = 'urn:ietf:params:oauth:grant-type:device_code'; device_code = $dc.device_code
      }).access_token
  } catch {
    $e = $null; try { $e = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
    if (-not $e -or ($e.error -ne 'authorization_pending' -and $e.error -ne 'slow_down')) { throw "Inicio de sesión rechazado: $(if ($e) { $e.error_description } else { $_ })" }
  }
}
if (-not $token) { throw 'El código expiró sin iniciar sesión.' }
$H = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function G([string]$method, [string]$path, $body = $null) {
  $p = @{ Method = $method; Uri = "https://graph.microsoft.com/v1.0$path"; Headers = $H }
  if ($null -ne $body) { $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10 -Compress)) }
  Invoke-RestMethod @p
}
function One($r) { if ($r.value) { $r.value[0] } else { $null } }
# Los objetos recién creados tardan unos segundos en replicarse en Entra ID
function Retry([scriptblock]$fn) {
  for ($i = 1; ; $i++) {
    try { return & $fn } catch { if ($i -ge 6) { throw }; Start-Sleep -Seconds (3 * $i) }
  }
}

# ---------- Resolver permisos ----------
$graphSp = One (G GET "/servicePrincipals?`$filter=appId eq '$GraphAppId'&`$select=id,oauth2PermissionScopes")
$exoSp = One (G GET "/servicePrincipals?`$filter=appId eq '$ExchangeAppId'&`$select=id,oauth2PermissionScopes")
function Resolve($sp, [string[]]$names) {
  $out = @()
  foreach ($n in $names) {
    $s = $sp.oauth2PermissionScopes | Where-Object { $_.value -eq $n } | Select-Object -First 1
    if ($s) { $out += @{ id = $s.id; type = 'Scope' } } else { Write-Warning "Permiso no encontrado y omitido: $n" }
  }
  , $out
}
$required = @(@{ resourceAppId = $GraphAppId; resourceAccess = (Resolve $graphSp $GraphScopes) })
if ($exoSp) { $required += @{ resourceAppId = $ExchangeAppId; resourceAccess = (Resolve $exoSp $ExchangeScopes) } }
else { Write-Warning 'Exchange Online no está disponible en el tenant: se omite Exchange.Manage' }

$me = G GET '/me?$select=id,userPrincipalName'
$assignees = @($me)
foreach ($upn in $Administradores) {
  try { $assignees += G GET "/users/$([uri]::EscapeDataString($upn))?`$select=id,userPrincipalName" } catch { Write-Warning "No existe el usuario $upn" }
}

Write-Host ''
Write-Host "Se configurará en el tenant $Tenant :" -ForegroundColor Cyan
Write-Host "  - Registro de aplicación '$AppName' (un solo tenant, sin secretos)"
Write-Host "  - URI de redirección (cliente público): $RedirectUri"
Write-Host "  - $($GraphScopes.Count) permisos delegados de Graph + Exchange.Manage, con consentimiento de administrador"
Write-Host "  - Uso restringido a: $(($assignees | ForEach-Object userPrincipalName) -join ', ')"
$ok = Read-Host '¿Continuar? (S/N)'
if ($ok -notmatch '^[sS]') { Write-Host 'Cancelado, no se hizo ningún cambio.'; exit 0 }

# ---------- Registro de aplicación ----------
$app = One (G GET "/applications?`$filter=displayName eq '$AppName'&`$select=id,appId")
$appBody = @{
  displayName = $AppName
  signInAudience = 'AzureADMyOrg'
  publicClient = @{ redirectUris = @($RedirectUri) }
  requiredResourceAccess = $required
  notes = 'Gobierno M365: inicio de sesión delegado del administrador con MFA. Sin secretos.'
}
if ($app) {
  G PATCH "/applications/$($app.id)" $appBody | Out-Null
  Write-Host "Registro existente actualizado ($($app.appId))" -ForegroundColor Green
} else {
  $app = G POST '/applications' $appBody
  Write-Host "Registro creado ($($app.appId))" -ForegroundColor Green
}

# ---------- Entidad de servicio, restringida a cuentas asignadas ----------
$sp = $null
for ($i = 0; $i -lt 10 -and -not $sp; $i++) {
  $sp = One (G GET "/servicePrincipals?`$filter=appId eq '$($app.appId)'&`$select=id")
  if (-not $sp) {
    try { $sp = G POST '/servicePrincipals' @{ appId = $app.appId; appRoleAssignmentRequired = $true } } catch { Start-Sleep -Seconds 3 }
  }
}
if (-not $sp) { throw 'No se pudo crear la entidad de servicio (reintenta en un minuto).' }
Retry { G PATCH "/servicePrincipals/$($sp.id)" @{ appRoleAssignmentRequired = $true; tags = @('WindowsAzureActiveDirectoryIntegratedApp') } | Out-Null }
Write-Host 'Uso restringido a cuentas asignadas' -ForegroundColor Green

# ---------- Consentimiento de administrador ----------
function Grant($resourceSp, [string[]]$names) {
  $scope = ($names -join ' ')
  $existing = One (G GET "/oauth2PermissionGrants?`$filter=clientId eq '$($sp.id)' and resourceId eq '$($resourceSp.id)' and consentType eq 'AllPrincipals'")
  if ($existing) { G PATCH "/oauth2PermissionGrants/$($existing.id)" @{ scope = $scope } | Out-Null }
  else { G POST '/oauth2PermissionGrants' @{ clientId = $sp.id; consentType = 'AllPrincipals'; resourceId = $resourceSp.id; scope = $scope } | Out-Null }
}
Retry { Grant $graphSp $GraphScopes }
if ($exoSp) { Retry { Grant $exoSp $ExchangeScopes } }
Write-Host 'Consentimiento de administrador concedido' -ForegroundColor Green

# ---------- Asignación de administradores ----------
$assigned = (G GET "/servicePrincipals/$($sp.id)/appRoleAssignedTo?`$select=principalId").value | ForEach-Object principalId
foreach ($u in $assignees) {
  if ($assigned -contains $u.id) { continue }
  Retry { G POST "/servicePrincipals/$($sp.id)/appRoleAssignedTo" @{ principalId = $u.id; resourceId = $sp.id; appRoleId = '00000000-0000-0000-0000-000000000000' } | Out-Null }
  Write-Host "Asignado: $($u.userPrincipalName)" -ForegroundColor Green
}

$tid = ((G GET '/organization?$select=id').value[0]).id
Write-Host ''
Write-Host '=== Listo. Ingresa estos datos en la app (Conexión -> Agregar ambiente) ===' -ForegroundColor Cyan
Write-Host "Tenant ID : $tid"
Write-Host "Client ID : $($app.appId)"
Write-Host "Cuenta    : $($me.userPrincipalName)"
@"
Tenant ID: $tid
Client ID: $($app.appId)
Cuenta: $($me.userPrincipalName)
Redirect URI: $RedirectUri
"@ | Set-Content -Path (Join-Path (Get-Location) 'registro-app.txt') -Encoding UTF8
Write-Host 'Guardado también en registro-app.txt (no contiene secretos).'
