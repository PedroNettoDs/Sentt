// Guard do webhook Meta Cloud API — §5.6 do prompt-motor.md.
// Espera `x-hub-signature-256: sha256=<hex>` e verifica via
// `HMAC-SHA256(rawBody, CLOUD_API_APP_SECRET)` com `timingSafeEqual`.
//
// Exige que `main.ts` tenha sido criado com `NestFactory.create({ rawBody: true })`
// — do contrário `req.rawBody` vem `undefined` e o HMAC falha.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

@Injectable()
export class CloudWebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(CloudWebhookAuthGuard.name);
  private readonly appSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.appSecret = config.get('CLOUD_API_APP_SECRET', { infer: true });
    if (!this.appSecret) {
      // Aviso: sem secret o guard vira decorativo. Deixamos passar? Não —
      // obriga configuração em QA/prod. Em dev local sem credenciais, setar
      // uma string qualquer no .env.
      this.logger.warn(
        'CLOUD_API_APP_SECRET vazio — o guard rejeitará todo webhook Meta',
      );
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = req.headers[SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature || !signature.startsWith(SIGNATURE_PREFIX)) {
      throw new UnauthorizedException(
        'Cloud webhook: assinatura ausente ou malformada',
      );
    }
    if (!req.rawBody) {
      // Sem rawBody não dá para validar HMAC — bug de configuração.
      throw new UnauthorizedException(
        'Cloud webhook: rawBody ausente (verificar NestFactory.create({ rawBody: true }))',
      );
    }
    const providedHex = signature.slice(SIGNATURE_PREFIX.length).trim();
    const provided = safeFromHex(providedHex);
    if (!provided) {
      throw new UnauthorizedException(
        'Cloud webhook: assinatura com hex inválido',
      );
    }
    const expected = createHmac('sha256', this.appSecret)
      .update(req.rawBody)
      .digest();
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException('Cloud webhook: assinatura inválida');
    }
    return true;
  }
}

function safeFromHex(hex: string): Buffer | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, 'hex');
}
