<#
  Revisión de accesos de Gobierno M365 — SOLO LECTURA, no modifica nada en el tenant.

  Uso (PowerShell de Windows, sin instalar nada):
    powershell -ExecutionPolicy Bypass -File .\revisar-accesos.ps1 -Tenant contoso.onmicrosoft.com

  Inicio de sesión: el script muestra un código. Abre https://microsoft.com/devicelogin,
  escribe el código y entra con tu cuenta: la contraseña y el MFA se ingresan en la página de
  Microsoft, el script nunca los ve. Solo se piden permisos de lectura y el token no se guarda.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tenant
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

# "Microsoft Graph Command Line Tools": cliente público de Microsoft (no hay que registrar una app)
$ClientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e'
$Scopes = @(
  'User.Read', 'Directory.Read.All', 'Policy.Read.All', 'RoleManagement.Read.Directory',
  'Application.Read.All', 'UserAuthenticationMethod.Read', 'DeviceManagementManagedDevices.Read.All',
  'DeviceManagementConfiguration.Read.All', 'SecurityEvents.Read.All'
) | ForEach-Object { "https://graph.microsoft.com/$_" }
$Login = "https://login.microsoftonline.com/$Tenant/oauth2/v2.0"

# ---------- Inicio de sesión por código de dispositivo ----------
$dc = Invoke-RestMethod -Method Post -Uri "$Login/devicecode" -Body @{ client_id = $ClientId; scope = (($Scopes + 'openid', 'profile') -join ' ') }
Write-Host ''
Write-Host "Abre $($dc.verification_uri) e ingresa el código: $($dc.user_code)" -ForegroundColor Yellow
Write-Host 'Inicia sesión con la cuenta de administrador y aprueba el MFA (expira en 15 minutos).' -ForegroundColor Yellow
try { Set-Clipboard -Value $dc.user_code; Write-Host '(El código quedó copiado en el portapapeles)' } catch {}
try { Start-Process $dc.verification_uri } catch {}

$token = $null
$until = (Get-Date).AddSeconds([int]$dc.expires_in)
while (-not $token -and (Get-Date) -lt $until) {
  Start-Sleep -Seconds ([int]$dc.interval)
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$Login/token" -Body @{
      client_id = $ClientId; grant_type = 'urn:ietf:params:oauth:grant-type:device_code'; device_code = $dc.device_code
    }
    $token = $r.access_token
  } catch {
    $err = $null
    try { $err = ($_.ErrorDetails.Message | ConvertFrom-Json) } catch {}
    if (-not $err -or ($err.error -ne 'authorization_pending' -and $err.error -ne 'slow_down')) {
      throw "Inicio de sesión rechazado: $(if ($err) { $err.error_description } else { $_ })"
    }
  }
}
if (-not $token) { throw 'El código expiró sin iniciar sesión.' }

function Decode-Jwt([string]$jwt) {
  $p = $jwt.Split('.')[1].Replace('-', '+').Replace('_', '/')
  switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
}
$claims = Decode-Jwt $token
$headers = @{ Authorization = "Bearer $token"; ConsistencyLevel = 'eventual' }

function Graph([string]$path) {
  $url = "https://graph.microsoft.com/v1.0$path"
  $items = @()
  do {
    $r = Invoke-RestMethod -Headers $headers -Uri $url
    if ($null -ne $r.value) { $items += $r.value; $url = $r.'@odata.nextLink' } else { return $r }
  } while ($url -and $items.Count -lt 5000)
  , $items
}

$results = New-Object System.Collections.ArrayList
function Check([string]$area, [scriptblock]$fn) {
  try {
    $r = & $fn
    [void]$results.Add([pscustomobject]@{ Area = $area; Ok = $r.Ok; Detalle = $r.Detalle; Solucion = $r.Solucion })
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match '403') { $msg = 'Sin permiso para leer (403)' }
    [void]$results.Add([pscustomobject]@{ Area = $area; Ok = $null; Detalle = $msg; Solucion = '' })
  }
}

$GA = '62e90394-69f5-4237-9190-012177145e10'

Check 'Sesión con MFA' {
  $amr = @($claims.amr)
  @{ Ok = [bool]($amr | Where-Object { $_ -in 'mfa', 'ngcmfa', 'fido' })
     Detalle = "$($claims.upn) · tenant $($claims.tid) · métodos: $($amr -join ', ')"
     Solucion = 'La sesión no registró MFA: registra Authenticator o FIDO2 para esta cuenta.' }
}
Check 'Roles del administrador' {
  $roles = Graph "/me/transitiveMemberOf/microsoft.graph.directoryRole?`$select=displayName,roleTemplateId"
  @{ Ok = [bool]($roles | Where-Object { $_.roleTemplateId -eq $GA })
     Detalle = (($roles | ForEach-Object displayName) -join ', ')
     Solucion = 'Se necesita Administrador global (o Seguridad + Intune + Exchange + Cumplimiento + Aplicaciones). Si usas PIM, activa el rol.' }
}
Check 'Métodos MFA registrados' {
  $m = Graph '/me/authentication/methods'
  $t = $m | ForEach-Object { $_.'@odata.type'.Replace('#microsoft.graph.', '').Replace('AuthenticationMethod', '') }
  @{ Ok = [bool]($t | Where-Object { $_ -ne 'password' }); Detalle = ($t -join ', '); Solucion = 'Registra Microsoft Authenticator o una llave FIDO2.' }
}
Check 'Licencia Business Premium' {
  $skus = Graph '/subscribedSkus'
  $spb = $skus | Where-Object { $_.skuPartNumber -eq 'SPB' } | Select-Object -First 1
  @{ Ok = [bool]$spb
     Detalle = $(if ($spb) { "$($spb.consumedUnits)/$($spb.prepaidUnits.enabled) asignadas" } else { 'SKUs: ' + (($skus | ForEach-Object skuPartNumber) -join ', ') })
     Solucion = 'Sin Business Premium no hay Entra ID P1 ni Intune (Acceso Condicional, cumplimiento).' }
}
Check 'Administradores globales' {
  $m = Graph "/directoryRoles(roleTemplateId='$GA')/members?`$select=userPrincipalName"
  @{ Ok = ($m.Count -ge 2 -and $m.Count -le 4); Detalle = "$($m.Count): " + (($m | ForEach-Object userPrincipalName) -join ', '); Solucion = 'Recomendado entre 2 y 4, incluidas cuentas de emergencia.' }
}
Check 'Valores predeterminados de seguridad' {
  $sd = Graph '/policies/identitySecurityDefaultsEnforcementPolicy'
  @{ Ok = $true; Detalle = $(if ($sd.isEnabled) { 'Activos (la app los reemplaza de forma segura por Acceso Condicional)' } else { 'Inactivos' }) }
}
Check 'Acceso Condicional' {
  $p = Graph "/identity/conditionalAccess/policies?`$select=displayName,state"
  @{ Ok = $true; Detalle = "$($p.Count) políticas: " + (($p | ForEach-Object { "$($_.displayName) [$($_.state)]" }) -join '; ') }
}
Check 'Registro de la app Gobierno M365' {
  $a = Graph "/applications?`$filter=startswith(displayName,'Gobierno')&`$select=displayName,appId"
  @{ Ok = $true; Detalle = $(if ($a.Count) { 'Ya existe: ' + (($a | ForEach-Object { "$($_.displayName) ($($_.appId))" }) -join ', ') } else { 'Aún no existe (se crea en el siguiente paso)' }) }
}
Check 'Intune' {
  $d = Graph "/deviceManagement/managedDevices?`$select=id"
  $c = Graph "/deviceManagement/deviceCompliancePolicies?`$select=id"
  @{ Ok = $true; Detalle = "$($d.Count) dispositivos administrados, $($c.Count) políticas de cumplimiento" }
}
Check 'Secure Score' {
  $s = (Graph "/security/secureScores?`$top=1") | Select-Object -First 1
  @{ Ok = $true; Detalle = $(if ($s) { "{0}/{1} ({2}%)" -f [math]::Round($s.currentScore), [math]::Round($s.maxScore), [math]::Round(100 * $s.currentScore / $s.maxScore) } else { 'sin datos' }) }
}

Write-Host ''
Write-Host '=== Revisión de accesos (solo lectura) ===' -ForegroundColor Cyan
foreach ($r in $results) {
  if ($null -eq $r.Ok) { $mark = '?'; $color = 'DarkYellow' } elseif ($r.Ok) { $mark = 'OK'; $color = 'Green' } else { $mark = 'X'; $color = 'Red' }
  Write-Host ("[{0}] {1}: {2}" -f $mark, $r.Area, $r.Detalle) -ForegroundColor $color
  if ($r.Ok -eq $false -and $r.Solucion) { Write-Host "     -> $($r.Solucion)" }
}
$out = Join-Path (Get-Location) 'revision-accesos.txt'
$results | Format-List | Out-String -Width 200 | Set-Content -Path $out -Encoding UTF8
Write-Host ''
Write-Host "Resultado guardado en $out (no contiene tokens ni contraseñas). Puedes pegarlo en el chat." -ForegroundColor Cyan
