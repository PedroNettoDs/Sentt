// Webhook do driver Meta Cloud API — §5.7 do prompt-motor.md.
// Duas rotas na mesma path `/webhook/cloud`:
//
// - GET: handshake de verificação. O Meta envia `hub.mode=subscribe`,
//   `hub.verify_token=<string>` e `hub.challenge=<string>`. Se o token bate
//   com `CLOUD_API_VERIFY_TOKEN`, devolvemos **apenas o challenge como texto**
//   (o painel do Meta recusa JSON).
//
// - POST: evento real. Guard já validou HMAC em `rawBody`. Resolve instância
//   por `metaPhoneNumberId` (em `entry[0].changes[0].value.metadata.phone_number_id`),
//   persiste `ReceivedWebhook` e enfileira.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Env } from '../../config/env.schema';
import { QUEUE_WHATSAPP_INBOUND } from '../../common/constants/queues';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudWebhookAuthGuard } from '../guards/cloud-webhook-auth.guard';

type CloudWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        messages?: unknown[];
        statuses?: unknown[];
        [k: string]: unknown;
      };
    }>;
  }>;
};

@Controller('whatsapp/webhook/cloud')
export class WebhookCloudController {
  private readonly verifyToken: string;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WHATSAPP_INBOUND) private readonly inboundQueue: Queue,
    config: ConfigService<Env, true>,
  ) {
    this.verifyToken = config.get('CLOUD_API_VERIFY_TOKEN', { infer: true });
  }

  // Handshake: Meta exige resposta em **text/plain** com o challenge puro.
  @Get()
  @Header('content-type', 'text/plain')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (mode !== 'subscribe' || !challenge) {
      throw new BadRequestException('handshake inválido');
    }
    if (!this.verifyToken || token !== this.verifyToken) {
      throw new UnauthorizedException('verify_token inválido');
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @UseGuards(CloudWebhookAuthGuard)
  async receive(
    @Body() payload: CloudWebhookPayload,
  ): Promise<{ received: true }> {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const phoneNumberId = value?.metadata?.phone_number_id ?? '';
    const instance = phoneNumberId
      ? await this.prisma.whatsAppInstance.findFirst({
          where: { metaPhoneNumberId: phoneNumberId, deletedAt: null },
          select: { id: true },
        })
      : null;

    // `eventType` aqui é o `changes[0].field` (ex.: "messages", "message_template_status_update").
    const eventType = String(payload?.entry?.[0]?.changes?.[0]?.field ?? 'unknown');

    const webhook = await this.prisma.receivedWebhook.create({
      data: {
        instance: phoneNumberId,
        eventType,
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
