import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const TTL_MS = 12 * 60 * 60 * 1000;

let password = config.appPassword;
export function ensurePassword(): string | undefined {
  if (password) return undefined;
  password = crypto.randomBytes(9).toString('base64url');
  return password;
}

const sign = (payload: string) => crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function login(candidate: unknown): string | undefined {
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(password);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return undefined;
  const payload = String(Date.now() + TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verify(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization?.replace(/^Bearer /, '');
  // EventSource no permite cabeceras: el stream de eventos acepta el token por query
  const token = header ?? (typeof req.query.token === 'string' ? req.query.token : undefined);
  if (verify(token)) return next();
  res.status(401).json({ error: 'Sesión inválida o expirada' });
}
