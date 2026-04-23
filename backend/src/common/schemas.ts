// Schemas Zod dos steps do bot de triagem — §6.2 do prompt-motor.md.
// `TriageFlow.structure` (Prisma Json) é validado por TriageFlowStructureSchema
// antes de ser persistido.
import { z } from 'zod';

const MessageStep = z.object({
  id: z.string(),
  type: z.literal('message'),
  label: z.string().optional(),
  text: z.string(),
  nextStep: z.string().optional(), // se ausente, termina ramo (inválido em produção)
});

const MenuStep = z.object({
  id: z.string(),
  type: z.literal('menu'),
  label: z.string().optional(),
  prompt: z.string(),
  options: z
    .array(
      z.object({
        key: z.string().min(1).max(3), // '1', '2', 'a', etc.
        label: z.string(),
        nextStep: z.string(),
      }),
    )
    .min(1)
    .max(15),
  invalidInputMessage: z.string().optional(),
});

const CollectStep = z.object({
  id: z.string(),
  type: z.literal('collect'),
  label: z.string().optional(),
  prompt: z.string(),
  variable: z.string(), // nome onde salvar em collectedVariables
  validator: z.enum(['any', 'phone', 'email', 'regex']), // sem CNPJ
  regex: z.string().optional(), // usado se validator='regex'
  maxRetries: z.number().int().min(1).max(5).default(3),
  failStep: z.string().optional(), // para onde ir se atingir maxRetries
  nextStep: z.string(), // caminho feliz
});

const ConditionStep = z.object({
  id: z.string(),
  type: z.literal('condition'),
  label: z.string().optional(),
  variable: z.string(), // valor a testar em collectedVariables
  operator: z.enum(['eq', 'neq', 'contains', 'exists']),
  value: z.string().optional(), // não usado com 'exists'
  thenStep: z.string(),
  elseStep: z.string(),
});

const RouteStep = z.object({
  id: z.string(),
  type: z.literal('route'),
  label: z.string().optional(),
  queue: z.string(), // identificador lógico de fila (string livre)
  message: z.string().optional(), // mensagem antes do handoff
});

export const TriageStep = z.discriminatedUnion('type', [
  MessageStep,
  MenuStep,
  CollectStep,
  ConditionStep,
  RouteStep,
]);
export type TriageStep = z.infer<typeof TriageStep>;

export const TriageFlowStructureSchema = z.object({
  greeting: z.string(),
  entryStep: z.string(),
  steps: z.array(TriageStep).min(1),
});
export type TriageFlowStructure = z.infer<typeof TriageFlowStructureSchema>;
