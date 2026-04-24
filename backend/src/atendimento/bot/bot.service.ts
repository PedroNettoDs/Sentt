// BotService — state machine manual de triagem (§6.3 do prompt-motor.md).
//
// Escuta `message.created` emitido pelo `MessagesUpsertHandler` (§10.4) e:
//   1. Filtra: só mensagens IN, conversa em EM_TRIAGEM, botState não-completed.
//   2. Primeira mensagem: envia greeting, cria `ConversationBotState` no
//      `entryStep` e executa `runUntilWait` até atingir um step bloqueante
//      (menu/collect) ou terminal (route).
//   3. Mensagens subsequentes: delega para `processStepInput`, que valida o
//      input conforme o tipo do step atual (menu → match por `key`, collect
//      → validator + retries + failStep).
//
// **Guard rail**: `MAX_STEP_DEPTH=20` — protege contra loops no grafo do fluxo
// (ex.: condition sempre caindo no mesmo branch). Lançamos e deixamos o
// `try/catch` do OnEvent logar; o fluxo fica parado até intervenção humana.
//
// **`sendBot`**: cria `Message direction=BOT` com `deliveryStatus=PENDENTE`
// e enfileira na `whatsapp-outbound`. O OutboundProcessor (§5.9) resolve
// routing e envia via provider.
//
// **`handoff`**: muda `Conversation.status` para EM_ATENDIMENTO, seta
// `assignedAt`, e emite `conversation.assigned` (para consumidores externos
// direcionarem para a fila humana certa).
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ConversationStatus,
  DeliveryStatus,
  MessageDirection,
  MessageType,
  Prisma,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { QUEUE_WHATSAPP_OUTBOUND } from '../../common/constants/queues';
import type { TriageFlowStructure, TriageStep } from '../../common/schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { TriageFlowService } from './triage-flow.service';

// Estado do bot compatível com o schema Prisma (`ConversationBotState`).
// Tipado aqui para evitar `any` em todas as assinaturas.
interface BotState {
  id: number;
  conversationId: number;
  currentStep: string;
  menuPath: Prisma.JsonValue;
  attempts: number;
  collectedVariables: Prisma.JsonValue | null;
  completed: boolean;
}

interface ConversationLite {
  id: number;
  phone: string;
  status: ConversationStatus;
}

type CollectedVars = Record<string, string>;

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private readonly MAX_STEP_DEPTH = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    private readonly triageFlow: TriageFlowService,
    @InjectQueue(QUEUE_WHATSAPP_OUTBOUND) private readonly outbound: Queue,
  ) {}

  // ── Entry point ─────────────────────────────────────────────────────────

  @OnEvent('message.created')
  async onMessageCreated(payload: {
    messageId: number;
    conversationId: number;
  }): Promise<void> {
    try {
      await this.dispatch(payload.messageId);
    } catch (err) {
      const e = err as Error;
      this.logger.error(
        `Bot falhou para messageId=${payload.messageId}: ${e.message}`,
        e.stack,
      );
    }
  }

  private async dispatch(messageId: number): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        direction: true,
        tipo: true,
        content: true,
        conversationId: true,
      },
    });
    if (!message) return;
    if (message.direction !== MessageDirection.IN) return;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: {
        id: true,
        phone: true,
        status: true,
        botState: {
          select: {
            id: true,
            conversationId: true,
            currentStep: true,
            menuPath: true,
            attempts: true,
            collectedVariables: true,
            completed: true,
          },
        },
      },
    });
    if (!conversation) return;
    if (conversation.status !== ConversationStatus.EM_TRIAGEM) return;
    if (conversation.botState?.completed) return;

    const text = extractText(message.content);
    const flow = await this.triageFlow.getActive();
    const convLite: ConversationLite = {
      id: conversation.id,
      phone: conversation.phone,
      status: conversation.status,
    };

    if (!conversation.botState) {
      await this.sendBot(convLite, flow.greeting);
      const state = await this.prisma.conversationBotState.create({
        data: {
          conversationId: conversation.id,
          currentStep: flow.entryStep,
          collectedVariables: {},
          attempts: 0,
        },
      });
      await this.runUntilWait(convLite, state, flow, 0);
      return;
    }

    await this.processStepInput(convLite, conversation.botState, flow, text);
  }

  // ── Loop principal ──────────────────────────────────────────────────────

  private async runUntilWait(
    conversation: ConversationLite,
    state: BotState,
    flow: TriageFlowStructure,
    depth: number,
  ): Promise<void> {
    if (depth > this.MAX_STEP_DEPTH) {
      throw new Error(
        `Loop detectado no fluxo (conversationId=${conversation.id}, step=${state.currentStep})`,
      );
    }

    const step = this.findStep(flow, state.currentStep);

    switch (step.type) {
      case 'message': {
        await this.sendBot(conversation, step.text);
        if (!step.nextStep) {
          await this.markCompleted(state);
          return;
        }
        const next = await this.advance(state, step.nextStep);
        await this.runUntilWait(conversation, next, flow, depth + 1);
        return;
      }

      case 'menu':
        await this.sendBot(conversation, this.renderMenu(step));
        return; // bloqueante

      case 'collect':
        await this.sendBot(conversation, step.prompt);
        return; // bloqueante

      case 'condition': {
        const vars = readVars(state.collectedVariables);
        const passes = this.evaluate(step, vars);
        const next = await this.advance(
          state,
          passes ? step.thenStep : step.elseStep,
        );
        await this.runUntilWait(conversation, next, flow, depth + 1);
        return;
      }

      case 'route': {
        if (step.message) {
          await this.sendBot(conversation, step.message);
        }
        await this.handoff(conversation, step.queue);
        await this.markCompleted(state);
        return;
      }
    }
  }

  // ── Input do usuário em step bloqueante ─────────────────────────────────

  private async processStepInput(
    conversation: ConversationLite,
    state: BotState,
    flow: TriageFlowStructure,
    rawInput: string,
  ): Promise<void> {
    const step = this.findStep(flow, state.currentStep);

    if (step.type === 'menu') {
      const input = rawInput.trim();
      const option = step.options.find((o) => o.key === input);
      if (!option) {
        const hint =
          step.invalidInputMessage ??
          `Opção inválida.\n\n${this.renderMenu(step)}`;
        await this.sendBot(conversation, hint);
        return;
      }
      const next = await this.advance(state, option.nextStep);
      await this.runUntilWait(conversation, next, flow, 0);
      return;
    }

    if (step.type === 'collect') {
      const valid = this.validateCollect(step, rawInput);
      if (!valid) {
        const attempts = state.attempts + 1;
        if (attempts >= step.maxRetries && step.failStep) {
          const next = await this.prisma.conversationBotState.update({
            where: { id: state.id },
            data: { currentStep: step.failStep, attempts: 0 },
          });
          await this.runUntilWait(conversation, next, flow, 0);
          return;
        }
        await this.prisma.conversationBotState.update({
          where: { id: state.id },
          data: { attempts },
        });
        await this.sendBot(
          conversation,
          `Entrada inválida (tentativa ${attempts}/${step.maxRetries}).\n\n${step.prompt}`,
        );
        return;
      }
      const vars = readVars(state.collectedVariables);
      vars[step.variable] = rawInput.trim();
      const next = await this.prisma.conversationBotState.update({
        where: { id: state.id },
        data: {
          currentStep: step.nextStep,
          collectedVariables: vars,
          attempts: 0,
        },
      });
      await this.runUntilWait(conversation, next, flow, 0);
      return;
    }

    // Mensagem em step não-bloqueante: idle, o próximo `runUntilWait` já
    // terá avançado. Ignoramos silenciosamente.
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private findStep(flow: TriageFlowStructure, id: string): TriageStep {
    const step = flow.steps.find((s) => s.id === id);
    if (!step) {
      throw new Error(`Step '${id}' não encontrado no fluxo ativo`);
    }
    return step;
  }

  private evaluate(
    step: Extract<TriageStep, { type: 'condition' }>,
    vars: CollectedVars,
  ): boolean {
    const val = String(vars[step.variable] ?? '');
    switch (step.operator) {
      case 'eq':
        return val === step.value;
      case 'neq':
        return val !== step.value;
      case 'contains':
        return val.includes(step.value ?? '');
      case 'exists':
        return step.variable in vars;
    }
  }

  private validateCollect(
    step: Extract<TriageStep, { type: 'collect' }>,
    input: string,
  ): boolean {
    const trimmed = input.trim();
    switch (step.validator) {
      case 'any':
        return trimmed.length > 0;
      case 'phone':
        return /^\+?[1-9]\d{7,14}$/.test(trimmed);
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      case 'regex':
        return step.regex ? new RegExp(step.regex).test(trimmed) : false;
    }
  }

  private renderMenu(step: Extract<TriageStep, { type: 'menu' }>): string {
    const lines = step.options.map((o) => `${o.key} - ${o.label}`).join('\n');
    return `${step.prompt}\n\n${lines}`;
  }

  private async handoff(
    conversation: ConversationLite,
    queue: string,
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: ConversationStatus.EM_ATENDIMENTO,
        assignedAt: new Date(),
      },
    });
    this.emitter.emit('conversation.assigned', {
      conversationId: conversation.id,
      queue,
    });
    this.logger.log(
      `Handoff: conversationId=${conversation.id} queue=${queue}`,
    );
  }

  private async sendBot(
    conversation: ConversationLite,
    text: string,
  ): Promise<void> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.BOT,
        tipo: MessageType.TEXTO,
        content: { text } as Prisma.InputJsonValue,
        deliveryStatus: DeliveryStatus.PENDENTE,
      },
      select: { id: true },
    });
    await this.outbound.add(
      'send-message',
      { messageId: message.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
    );
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  private async advance(state: BotState, nextStepId: string): Promise<BotState> {
    return this.prisma.conversationBotState.update({
      where: { id: state.id },
      data: { currentStep: nextStepId, attempts: 0 },
    });
  }

  private async markCompleted(state: BotState): Promise<void> {
    await this.prisma.conversationBotState.update({
      where: { id: state.id },
      data: { completed: true },
    });
  }
}

// ── Helpers fora da classe ────────────────────────────────────────────────

function extractText(content: Prisma.JsonValue): string {
  if (
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    'text' in content
  ) {
    const val = (content as Record<string, unknown>).text;
    return typeof val === 'string' ? val : '';
  }
  return '';
}

function readVars(json: Prisma.JsonValue | null): CollectedVars {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const out: CollectedVars = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
