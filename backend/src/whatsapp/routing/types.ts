// Tipos públicos do roteador de WhatsApp — §5.10 do prompt-motor.md.
// Isolados em arquivo próprio para que o `WhatsAppOutboundProcessor` (§5.9)
// possa importar só as interfaces sem puxar a implementação.
import type { WhatsAppDriver } from '@prisma/client';

export type WhatsAppIntent =
  | 'SUPPORT_REPLY'
  | 'BOT_MESSAGE'
  | 'COLD_OUTREACH'
  | 'CAMPAIGN_WARM';

export interface RoutingParams {
  intent: WhatsAppIntent;
  conversationId?: number;
  lastInboundAt?: Date | null;
  now?: Date;
  excludeInstanceId?: number;
}

export type RoutingResult =
  | {
      instanceId: number;
      driver: WhatsAppDriver;
      decision: string;
      warnings?: string[];
    }
  | { failure: string; reason: string };

export function isRoutingFailure(
  r: RoutingResult,
): r is { failure: string; reason: string } {
  return 'failure' in r;
}
