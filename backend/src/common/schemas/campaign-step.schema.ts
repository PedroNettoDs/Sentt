// Schemas Zod da campanha — §7.1-7.3 do prompt-motor.md.
// `Campaign.steps`, `Campaign.targetAudience` e `Campaign.trigger` (Prisma Json)
// são validados por estes schemas no service antes de persistir/materializar.
import { z } from 'zod';

export const CampaignStep = z.object({
  stepNumber: z.number().int().min(1),
  type: z.enum(['TEXT', 'MEDIA', 'TEMPLATE']),
  content: z.string().min(1), // pode ter placeholders {{var}}
  mediaUrl: z.string().url().optional(), // só para MEDIA
  templateName: z.string().optional(), // só para TEMPLATE (Cloud API HSM)
  templateLanguage: z.string().default('pt_BR'),
  delayMinutes: z.number().int().min(0).default(0),
  condition: z
    .object({
      type: z.literal('no_reply_since_previous'),
      required: z.boolean().default(true),
    })
    .optional(),
  variables: z.array(z.string()).default([]),
});
export type CampaignStep = z.infer<typeof CampaignStep>;

export const CampaignSteps = z.array(CampaignStep).min(1);
export type CampaignSteps = z.infer<typeof CampaignSteps>;

export const TargetAudience = z.object({
  type: z.literal('manual_list'),
  phoneList: z.array(z.string().regex(/^\d{8,15}$/)).min(1),
});
export type TargetAudience = z.infer<typeof TargetAudience>;

export const Trigger = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual'),
    scheduledAt: z.coerce.date().optional(),
  }),
  z.object({
    type: z.literal('event'),
    event: z.string().max(100),
    delayMinutes: z.number().int().min(0).default(0),
  }),
]);
export type Trigger = z.infer<typeof Trigger>;
