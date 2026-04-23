// Guard do webhook Evolution — §5.6 do prompt-motor.md.
// Aceita `Authorization: Bearer <EVOLUTION_WEBHOOK_TOKEN>`; compara via hash
// SHA-256 + `timingSafeEqual` para não vazar o token por timing.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema';

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const token = config.get('EVOLUTION_WEBHOOK_TOKEN', { infer: true });
    this.expected = sha256(token);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Webhook: Authorization ausente');
    }
    const provided = sha256(header.slice('Bearer '.length).trim());
    if (provided.length !== this.expected.length) {
      throw new UnauthorizedException('Webhook: token inválido');
    }
    if (!timingSafeEqual(provided, this.expected)) {
      throw new UnauthorizedException('Webhook: token inválido');
    }
    return true;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
