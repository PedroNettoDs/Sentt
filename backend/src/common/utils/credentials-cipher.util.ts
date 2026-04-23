// Cifra AES-256-GCM para credenciais da Cloud API — §5.5 do prompt-motor.md.
// Layout base64: [IV(12)][TAG(16)][CT]. Chave carregada de
// CREDENTIALS_ENCRYPTION_KEY (base64 → 32 bytes). Gerar com `openssl rand -base64 32`.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY não definida');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em base64');
  }
  return key;
}

export function encryptCredentials(plain: unknown): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plain), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptCredentials<T>(encoded: string): T {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const dc = createDecipheriv(ALGORITHM, loadKey(), iv);
  dc.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([dc.update(ct), dc.final()]).toString('utf8'),
  ) as T;
}
