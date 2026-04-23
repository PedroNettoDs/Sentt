import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookAuthGuard } from './webhook-auth.guard';
import type { Env } from '../../config/env.schema';

const TOKEN = 'evolution-token-super-secreto';

function makeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) => {
      if (key === 'EVOLUTION_WEBHOOK_TOKEN') return TOKEN;
      throw new Error(`unexpected env key: ${key}`);
    },
  } as unknown as ConfigService<Env, true>;
}

function makeCtx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as ExecutionContext;
}

describe('WebhookAuthGuard', () => {
  const guard = new WebhookAuthGuard(makeConfig());

  it('aceita Bearer com token correto', () => {
    expect(guard.canActivate(makeCtx(`Bearer ${TOKEN}`))).toBe(true);
  });

  it('rejeita quando header Authorization está ausente', () => {
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita quando não começa com "Bearer "', () => {
    expect(() => guard.canActivate(makeCtx(`Token ${TOKEN}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita token errado', () => {
    expect(() => guard.canActivate(makeCtx('Bearer nao-e-o-certo'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita token vazio pós "Bearer "', () => {
    expect(() => guard.canActivate(makeCtx('Bearer '))).toThrow(
      UnauthorizedException,
    );
  });
});
