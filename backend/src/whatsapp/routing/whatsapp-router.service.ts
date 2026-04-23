// Roteador de saída WhatsApp — §5.10 do prompt-motor.md.
//
// Resolve qual `WhatsAppInstance` usa para uma mensagem de saída, combinando:
//   - intent (SUPPORT_REPLY / BOT_MESSAGE / COLD_OUTREACH / CAMPAIGN_WARM)
//   - janela 24 h desde o último inbound (`lastInboundAt`)
//   - role da instância (ATENDIMENTO / COLD_OUTREACH / BOTH)
//
// As 10 linhas da tabela §5.10 estão em `dispatch()` como `switch (intent)`.
// Tiebreaker entre candidatas: `isPrimary DESC, updatedAt DESC`.
//
// **Nunca lança por falta de rota** — devolve `{ failure, reason }`. Exceções
// indicam bug de infra (DB fora, driver enum inválido no DB).
import { Injectable } from '@nestjs/common';
import type { WhatsAppInstance, WhatsAppInstanceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isWithin24hWindow } from './window-policy';
import type { RoutingParams, RoutingResult, WhatsAppIntent } from './types';

type Candidate = Pick<
  WhatsAppInstance,
  'id' | 'driver' | 'role' | 'isPrimary' | 'updatedAt'
>;

@Injectable()
export class WhatsAppRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(params: RoutingParams): Promise<RoutingResult> {
    return this.dispatch(params);
  }

  async resolveFallback(
    params: RoutingParams & { excludeInstanceId: number },
  ): Promise<RoutingResult> {
    return this.dispatch(params);
  }

  // ------------------------------------------------------------------
  // Core: roteia por intent. Cada branch é uma linha da tabela §5.10.
  // ------------------------------------------------------------------
  private async dispatch(params: RoutingParams): Promise<RoutingResult> {
    const { intent, excludeInstanceId, now = new Date() } = params;

    switch (intent) {
      case 'SUPPORT_REPLY':
        return this.routeSupportReply(params, now);
      case 'BOT_MESSAGE':
        return this.routeBotMessage(excludeInstanceId);
      case 'COLD_OUTREACH':
        return this.routeColdOutreach(excludeInstanceId);
      case 'CAMPAIGN_WARM':
        return this.routeCampaignWarm(params, now);
    }
  }

  // SUPPORT_REPLY -----------------------------------------------------
  private async routeSupportReply(
    params: RoutingParams,
    now: Date,
  ): Promise<RoutingResult> {
    const open = isWithin24hWindow(params.lastInboundAt, now);

    if (open) {
      // 1) Janela aberta → Baileys ATENDIMENTO
      const primary = await this.pickBaileys(
        ['ATENDIMENTO'],
        params.excludeInstanceId,
      );
      if (primary) return success(primary, 'support-primary');

      // 2) Janela aberta + role=BOTH
      const both = await this.pickBaileys(['BOTH'], params.excludeInstanceId);
      if (both) return success(both, 'support-fallback-both');

      return failure(
        'no-baileys-support',
        'sem instância BAILEYS disponível (ATENDIMENTO ou BOTH) com janela aberta',
      );
    }

    // 3) Janela fechada — preferir Cloud API
    const cloud = await this.pickCloudApi(
      ['ATENDIMENTO', 'BOTH', 'COLD_OUTREACH'],
      params.excludeInstanceId,
    );
    if (cloud) return success(cloud, 'out-of-window-fallback');

    // 4) Janela fechada sem Cloud API → Baileys com warning
    const baileys = await this.pickBaileys(
      ['ATENDIMENTO', 'BOTH'],
      params.excludeInstanceId,
    );
    if (baileys) {
      return success(baileys, 'out-of-window-baileys-risky', [
        'fora da janela de 24 h: Meta pode banir envio via BAILEYS sem HSM',
      ]);
    }

    return failure(
      'no-instance-out-of-window',
      'fora da janela sem Cloud API nem BAILEYS disponíveis',
    );
  }

  // BOT_MESSAGE -------------------------------------------------------
  private async routeBotMessage(
    excludeInstanceId?: number,
  ): Promise<RoutingResult> {
    const baileys = await this.pickBaileys(
      ['ATENDIMENTO', 'BOTH'],
      excludeInstanceId,
    );
    if (baileys) return success(baileys, 'bot');
    return failure(
      'no-baileys-bot',
      'sem instância BAILEYS (ATENDIMENTO ou BOTH) para envio do bot',
    );
  }

  // COLD_OUTREACH -----------------------------------------------------
  private async routeColdOutreach(
    excludeInstanceId?: number,
  ): Promise<RoutingResult> {
    const primary = await this.pickCloudApi(
      ['COLD_OUTREACH'],
      excludeInstanceId,
    );
    if (primary) return success(primary, 'cold-primary');

    const both = await this.pickCloudApi(['BOTH'], excludeInstanceId);
    if (both) return success(both, 'cold-both');

    return failure(
      'no-cloud-cold',
      'sem instância Cloud API (COLD_OUTREACH ou BOTH) para cold outreach',
    );
  }

  // CAMPAIGN_WARM -----------------------------------------------------
  private async routeCampaignWarm(
    params: RoutingParams,
    now: Date,
  ): Promise<RoutingResult> {
    const open = isWithin24hWindow(params.lastInboundAt, now);
    if (open) {
      const baileys = await this.pickBaileys(
        ['ATENDIMENTO', 'BOTH'],
        params.excludeInstanceId,
      );
      if (baileys) return success(baileys, 'warm-in-window');
      return failure(
        'no-baileys-warm',
        'CAMPAIGN_WARM com janela aberta sem BAILEYS disponível',
      );
    }
    // Janela fechada → cai para COLD_OUTREACH
    return this.routeColdOutreach(params.excludeInstanceId);
  }

  // ------------------------------------------------------------------
  // Seleção + tiebreaker: isPrimary DESC, updatedAt DESC.
  // Filtra `deletedAt: null` e `isConnected: true` (não adianta roteiar
  // para uma conexão morta).
  // ------------------------------------------------------------------
  private async pickBaileys(
    roles: WhatsAppInstanceRole[],
    excludeInstanceId?: number,
  ): Promise<Candidate | null> {
    return this.pick('BAILEYS', roles, excludeInstanceId);
  }

  private async pickCloudApi(
    roles: WhatsAppInstanceRole[],
    excludeInstanceId?: number,
  ): Promise<Candidate | null> {
    return this.pick('CLOUD_API', roles, excludeInstanceId);
  }

  private async pick(
    driver: 'BAILEYS' | 'CLOUD_API',
    roles: WhatsAppInstanceRole[],
    excludeInstanceId?: number,
  ): Promise<Candidate | null> {
    return this.prisma.whatsAppInstance.findFirst({
      where: {
        driver,
        role: { in: roles },
        isConnected: true,
        deletedAt: null,
        ...(excludeInstanceId ? { NOT: { id: excludeInstanceId } } : {}),
      },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        driver: true,
        role: true,
        isPrimary: true,
        updatedAt: true,
      },
    });
  }
}

// ---------------------------------------------------------------------

function success(
  candidate: Candidate,
  decision: string,
  warnings?: string[],
): Extract<RoutingResult, { instanceId: number }> {
  return {
    instanceId: candidate.id,
    driver: candidate.driver,
    decision,
    ...(warnings?.length ? { warnings } : {}),
  };
}

function failure(
  code: string,
  reason: string,
): Extract<RoutingResult, { failure: string }> {
  return { failure: code, reason };
}

// Export auxiliar (útil para testar `inferIntent` fora do processor se preciso).
export type { WhatsAppIntent };
