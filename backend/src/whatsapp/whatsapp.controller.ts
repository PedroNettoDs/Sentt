// Webhook do driver Evolution (Baileys) — §5.7 do prompt-motor.md.
// **Budget < 200 ms**: resolve a instância pelo nome, persiste `ReceivedWebhook`
// e enfileira `QUEUE_WHATSAPP_INBOUND`. Nada de lógica de domínio aqui —
// toda interpretação do payload vive no `WhatsAppInboundProcessor` (§5.8).
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_WHATSAPP_INBOUND } from '../common/constants/queues';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAuthGuard } from './guards/webhook-auth.guard';

type EvolutionWebhookPayload = {
  instance?: string;
  event?: string;
  [k: string]: unknown;
};

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WHATSAPP_INBOUND) private readonly inboundQueue: Queue,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @UseGuards(WebhookAuthGuard)
  async receive(
    @Body() payload: EvolutionWebhookPayload,
  ): Promise<{ received: true }> {
    const instanceName = String(payload?.instance ?? '');
    const instance = instanceName
      ? await this.prisma.whatsAppInstance.findFirst({
          where: { name: instanceName, deletedAt: null },
          select: { id: true },
        })
      : null;

    const webhook = await this.prisma.receivedWebhook.create({
      data: {
        instance: instanceName,
        eventType: String(payload?.event ?? 'unknown'),
        payload: payload as object,
        whatsAppInstanceId: instance?.id ?? null,
      },
      select: { id: true },
    });

    await this.inboundQueue.add(
      'process-webhook',
      { webhookId: webhook.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    return { received: true };
  }
}
