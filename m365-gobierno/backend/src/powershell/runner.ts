import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, powershellConfigured } from '../config.js';

export type PsKind = 'exo' | 'ipps';

export class PowerShellUnavailableError extends Error {}

let available: boolean | undefined;

export async function pwshAvailable(): Promise<boolean> {
  if (available !== undefined) return available;
  available = await new Promise<boolean>((resolve) => {
    const p = spawn(config.pwshPath, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
    setTimeout(() => resolve(false), 15000).unref();
  });
  return available;
}

const MODULE = 'ExchangeOnlineManagement';

/** Cómo se conecta el script: a mano, con certificado de la app, o con el token del administrador. */
export type PsAuth =
  | { type: 'interactive' }
  | { type: 'cert'; organization: string }
  | { type: 'token'; organization: string; upn: string; token: string };

/** Script completo. Los secretos nunca van en el texto: se pasan por variables de entorno. */
export function buildScript(kind: PsKind, body: string, auth: PsAuth['type']): string {
  const cmd = kind === 'exo' ? 'Connect-ExchangeOnline' : 'Connect-IPPSSession';
  const banner = kind === 'exo' ? ' -ShowBanner:$false' : '';
  const connect =
    auth === 'interactive'
      ? `${cmd} -UserPrincipalName (Read-Host 'Cuenta de administrador')${banner}`
      : auth === 'cert'
        ? `$certPwd = ConvertTo-SecureString $env:GOB_CERT_PASSWORD -AsPlainText -Force
${cmd} -AppId $env:GOB_CLIENT_ID -CertificateFilePath $env:GOB_CERT_PFX -CertificatePassword $certPwd -Organization $env:GOB_ORG${banner}`
        : `${cmd} -AccessToken $env:GOB_ACCESS_TOKEN -UserPrincipalName $env:GOB_UPN -Organization $env:GOB_ORG${banner}`;
  return `# Generado por Gobierno M365 (${kind === 'exo' ? 'Exchange Online' : 'Microsoft Purview'}) — idempotente, se puede re-ejecutar.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not (Get-Module -ListAvailable -Name ${MODULE})) { Install-Module ${MODULE} -Scope CurrentUser -Force }
Import-Module ${MODULE}
${connect}
try {
${body
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}
} finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
}
`;
}

export async function runPowerShell(kind: PsKind, body: string, auth: Exclude<PsAuth, { type: 'interactive' }>, log: (m: string) => void): Promise<string[]> {
  if (auth.type === 'cert' && !powershellConfigured()) {
    throw new PowerShellUnavailableError('Falta CERT_PFX_PATH: Exchange Online y Purview solo admiten autenticación de aplicación con certificado.');
  }
  if (!auth.organization) throw new PowerShellUnavailableError('No se conoce el dominio inicial del tenant (indícalo en el ambiente).');
  if (!(await pwshAvailable())) {
    throw new PowerShellUnavailableError(`PowerShell 7 (${config.pwshPath}) no está instalado en el servidor.`);
  }
  const dir = path.join(config.dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gob-${crypto.randomUUID()}.ps1`);
  fs.writeFileSync(file, buildScript(kind, body, auth.type), { mode: 0o600 });
  const secrets =
    auth.type === 'cert'
      ? { GOB_CLIENT_ID: config.clientId, GOB_CERT_PFX: config.certPfxPath, GOB_CERT_PASSWORD: config.certPfxPassword ?? '' }
      : { GOB_ACCESS_TOKEN: auth.token, GOB_UPN: auth.upn };
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const out: string[] = [];
      const err: string[] = [];
      const child = spawn(config.pwshPath, ['-NoProfile', '-NonInteractive', '-File', file], {
        env: { ...process.env, ...secrets, GOB_ORG: auth.organization },
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
      const onLine = (target: string[], prefix: string) => (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
          target.push(line);
          log(`${prefix}${line}`);
        }
      };
      child.stdout.on('data', onLine(out, ''));
      child.stderr.on('data', onLine(err, '⚠ '));
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(err.slice(-5).join('\n') || `PowerShell terminó con código ${code}`));
      });
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}
