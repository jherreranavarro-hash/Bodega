import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/.env (funciona tanto desde src/ con tsx como desde dist/ compilado)
dotenv.config({ path: path.resolve(here, '..', '.env') });

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export const config = {
  port: Number(env('PORT') ?? 4100),
  host: env('HOST') ?? '127.0.0.1',
  dataDir: path.resolve(here, '..', env('DATA_DIR') ?? 'data'),
  frontendDist: path.resolve(here, '..', '..', 'frontend', 'dist'),

  // Registro de aplicación en Entra ID (permisos de aplicación, consentidos por un admin)
  tenantId: env('TENANT_ID'),
  clientId: env('CLIENT_ID'),
  clientSecret: env('CLIENT_SECRET'),
  // PEM con certificado + clave privada (alternativa al secreto para Microsoft Graph)
  certPemPath: env('CERT_PEM_PATH'),
  // PFX para Exchange Online / Security & Compliance PowerShell (solo admiten certificado)
  certPfxPath: env('CERT_PFX_PATH'),
  certPfxPassword: env('CERT_PFX_PASSWORD'),
  // Dominio inicial del tenant (contoso.onmicrosoft.com); si falta se detecta vía Graph
  orgDomain: env('ORG_DOMAIN'),
  pwshPath: env('PWSH_PATH') ?? 'pwsh',

  forceSimulation: (env('MODO') ?? '').toLowerCase() === 'simulacion',

  appPassword: env('APP_PASSWORD') ?? '',
  sessionSecret: env('SESSION_SECRET') ?? crypto.randomBytes(32).toString('hex'),
};

export function graphConfigured(): boolean {
  return Boolean(config.tenantId && config.clientId && (config.clientSecret || config.certPemPath));
}

export function powershellConfigured(): boolean {
  return Boolean(config.tenantId && config.clientId && config.certPfxPath);
}

export type Mode = 'simulacion' | 'real';

export function currentMode(): Mode {
  return !config.forceSimulation && graphConfigured() ? 'real' : 'simulacion';
}
