import { randomBytes } from 'crypto';
import {
  encryptCredentials,
  decryptCredentials,
} from './credentials-cipher.util';

describe('credentials-cipher', () => {
  const ORIGINAL_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;

  beforeAll(() => {
    // 32 bytes base64 — não persistido; só vive dentro do jest.
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('faz round-trip de um objeto (estrutura e valores preservados)', () => {
    const plain = {
      accessToken: 'EAAxxxxxxxxxxxxxxxxxxx',
      phoneNumberId: '1234567890',
      wabaId: '98765',
      extras: { nested: true, count: 3 },
    };
    const encoded = encryptCredentials(plain);
    const decoded = decryptCredentials<typeof plain>(encoded);
    expect(decoded).toEqual(plain);
  });

  it('produz ciphertexts diferentes a cada chamada (IV aleatório)', () => {
    const plain = { token: 'abc' };
    const a = encryptCredentials(plain);
    const b = encryptCredentials(plain);
    expect(a).not.toBe(b);
  });

  it('produz output com no mínimo IV(12) + TAG(16) bytes', () => {
    const encoded = encryptCredentials({ x: 1 });
    const buf = Buffer.from(encoded, 'base64');
    expect(buf.length).toBeGreaterThanOrEqual(12 + 16);
  });

  it('decryptCredentials falha em payload adulterado (tag inválida)', () => {
    const encoded = encryptCredentials({ token: 'segredo' });
    const buf = Buffer.from(encoded, 'base64');
    buf[buf.length - 1] ^= 0xff; // corrompe último byte (parte do ciphertext)
    const tampered = buf.toString('base64');
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it('decryptCredentials falha quando a chave muda', () => {
    const encoded = encryptCredentials({ a: 1 });
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptCredentials(encoded)).toThrow();
  });

  it('encryptCredentials aborta se a chave não tem 32 bytes', () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from('curta').toString(
      'base64',
    );
    expect(() => encryptCredentials({ x: 1 })).toThrow(/32 bytes/);
    process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
  });

  it('encryptCredentials aborta se a chave não está definida', () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptCredentials({ x: 1 })).toThrow(/não definida/);
    process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
  });
});
