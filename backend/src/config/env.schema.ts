import { z } from 'zod';

const booleanish = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

const intString = (fallback?: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int());

export const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: intString(3000),

  // Banco
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: intString(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Evolution API (Baileys)
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_WEBHOOK_TOKEN: z.string().min(1),
  EVOLUTION_WEBHOOK_URL: z.string().url(),

  // Meta Cloud API
  CLOUD_API_GRAPH_VERSION: z.string().default('v20.0'),
  CLOUD_API_APP_SECRET: z.string().optional().default(''),
  CLOUD_API_VERIFY_TOKEN: z.string().optional().default(''),

  // Criptografia AES-256-GCM — chave de 32 bytes em base64 (openssl rand -base64 32)
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(1, 'obrigatório; gerar com `openssl rand -base64 32`')
    .refine(
      (v) => {
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      { message: 'deve decodificar para exatamente 32 bytes em base64' },
    ),

  // Horário comercial
  DEFAULT_TIMEZONE: z.string().default('America/Sao_Paulo'),
  BUSINESS_HOURS_START: intString(8),
  BUSINESS_HOURS_END: intString(18),
  BUSINESS_WEEKDAYS: z.string().default('1,2,3,4,5'),

  // Bull-Board (opcional)
  BULL_BOARD_USER: z.string().optional().default(''),
  BULL_BOARD_PASSWORD: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return result.data;
}
