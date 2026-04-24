// Feature module do gateway WhatsApp — §10.3 do prompt-motor.md.
//
// Agrega tudo do §5: providers (interface + Evolution/Cloud API + factory),
// roteador, guards, controllers de webhook, processors BullMQ, CRUD de
// instâncias. Exporta o que outros módulos (Atendimento, Campanhas) precisam
// para envio e decisão de routing.
//
// Dependências externas supostas como globais pelo AppModule:
//   - `ConfigModule.forRoot({ isGlobal: true })` — Env Zod validado
//   - `EventEmitterModule.forRoot()` — para `EventEmitter2` no inbound processor
//   - `BullModule.forRoot({ connection: { host, port, password } })` — conexão Redis
//   - `PrismaModule` (`@Global`) — PrismaService
//
// As filas `whatsapp-inbound` e `whatsapp-outbound` são registradas aqui para
// manter a configuração de fila próxima dos producers/workers que a usam.
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  QUEUE_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_OUTBOUND,
} from '../common/constants/queues';
import { CloudWebhookAuthGuard } from './guards/cloud-webhook-auth.guard';
import { WebhookAuthGuard } from './guards/webhook-auth.guard';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';
import { WhatsAppInboundProcessor } from './processors/whatsapp-inbound.processor';
import { WhatsAppOutboundProcessor } from './processors/whatsapp-outbound.processor';
import { EvolutionClient } from './providers/evolution.provider';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';
import { WhatsAppRouterService } from './routing/whatsapp-router.service';
import { WebhookCloudController } from './webhooks/webhook-cloud.controller';
import { WhatsappController } from './whatsapp.controller';

@Module({
  imports: [
    HttpModule.register({
      // Timeout generoso: Evolution em docker local pode demorar a responder a
      // primeira chamada de `/instance/connect` (QR). Retry está no axios-retry
      // do `EvolutionClient`.
      timeout: 15_000,
      maxRedirects: 3,
    }),
    BullModule.registerQueue(
      { name: QUEUE_WHATSAPP_INBOUND },
      { name: QUEUE_WHATSAPP_OUTBOUND },
    ),
  ],
  controllers: [WhatsappController, WebhookCloudController, InstancesController],
  providers: [
    // Drivers / factory
    EvolutionClient,
    WhatsAppProviderFactory,
    // Routing
    WhatsAppRouterService,
    // CRUD
    InstancesService,
    // Workers
    WhatsAppInboundProcessor,
    WhatsAppOutboundProcessor,
    // Guards (também resolvidos via DI pelos controllers que os usam com @UseGuards)
    WebhookAuthGuard,
    CloudWebhookAuthGuard,
  ],
  exports: [
    WhatsAppProviderFactory,
    WhatsAppRouterService,
    InstancesService,
    // Exporta o registro das filas para quem injeta @InjectQueue fora do módulo
    // (ex.: Campanhas enfileira na `whatsapp-outbound`).
    BullModule,
  ],
})
export class WhatsappModule {}
