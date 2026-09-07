import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production-please";

export interface TokenPayload {
  usuarioId: string;
  empresaId: string;
  rolCodigo: string;
  email: string;
}

export function firmarToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verificarToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function compararPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
