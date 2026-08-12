import { createHash, randomBytes } from 'crypto';

// Tokens de un solo uso (refresh, verificación de email, reset de password):
// se genera un secreto aleatorio de alta entropía, se entrega al usuario tal
// cual, y solo se guarda su hash SHA-256 en base de datos. Un hash rápido
// (no Argon2) es apropiado acá porque el "password" es aleatorio de 256
// bits, no elegido por un humano — no hay ataque de diccionario posible.
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
