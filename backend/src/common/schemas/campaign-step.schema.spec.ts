import {
  CampaignStep,
  CampaignSteps,
  TargetAudience,
  Trigger,
} from './campaign-step.schema';

describe('CampaignStep', () => {
  it('faz round-trip aplicando defaults (templateLanguage, delayMinutes, variables)', () => {
    const minimo = {
      stepNumber: 1,
      type: 'TEXT' as const,
      content: 'Olá {{nome}}!',
    };
    const parsed = CampaignStep.parse(minimo);
    expect(parsed.templateLanguage).toBe('pt_BR');
    expect(parsed.delayMinutes).toBe(0);
    expect(parsed.variables).toEqual([]);
    expect(parsed.content).toBe('Olá {{nome}}!');
  });

  it('preserva condition.no_reply_since_previous no round-trip', () => {
    const comCondicao = {
      stepNumber: 2,
      type: 'TEXT' as const,
      content: 'Você ainda está aí?',
      delayMinutes: 10,
      condition: { type: 'no_reply_since_previous' as const, required: true },
    };
    const parsed = CampaignStep.parse(comCondicao);
    expect(parsed.condition).toEqual({
      type: 'no_reply_since_previous',
      required: true,
    });
  });

  it('rejeita stepNumber < 1', () => {
    expect(() =>
      CampaignStep.parse({ stepNumber: 0, type: 'TEXT', content: 'x' }),
    ).toThrow();
  });

  it('rejeita type fora do enum', () => {
    expect(() =>
      CampaignStep.parse({ stepNumber: 1, type: 'AUDIO', content: 'x' }),
    ).toThrow();
  });

  it('rejeita content vazio', () => {
    expect(() =>
      CampaignStep.parse({ stepNumber: 1, type: 'TEXT', content: '' }),
    ).toThrow();
  });

  it('rejeita mediaUrl sem formato de URL', () => {
    expect(() =>
      CampaignStep.parse({
        stepNumber: 1,
        type: 'MEDIA',
        content: 'x',
        mediaUrl: 'nao-url',
      }),
    ).toThrow();
  });
});

describe('CampaignSteps (array)', () => {
  it('aceita array com 1+ steps', () => {
    const parsed = CampaignSteps.parse([
      { stepNumber: 1, type: 'TEXT', content: 'a' },
      { stepNumber: 2, type: 'TEXT', content: 'b', delayMinutes: 5 },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it('rejeita array vazio', () => {
    expect(() => CampaignSteps.parse([])).toThrow();
  });
});

describe('TargetAudience', () => {
  it('faz round-trip de phoneList válida', () => {
    const parsed = TargetAudience.parse({
      type: 'manual_list',
      phoneList: ['5511999998888', '5521988887777'],
    });
    expect(parsed.phoneList).toHaveLength(2);
    expect(parsed.type).toBe('manual_list');
  });

  it('rejeita phoneList vazia', () => {
    expect(() =>
      TargetAudience.parse({ type: 'manual_list', phoneList: [] }),
    ).toThrow();
  });

  it('rejeita número com formato inválido (letras, menos de 8 dígitos)', () => {
    expect(() =>
      TargetAudience.parse({
        type: 'manual_list',
        phoneList: ['55-abc-11999'],
      }),
    ).toThrow();
    expect(() =>
      TargetAudience.parse({ type: 'manual_list', phoneList: ['1234567'] }),
    ).toThrow();
  });
});

describe('Trigger', () => {
  it('faz round-trip de trigger manual sem scheduledAt', () => {
    const parsed = Trigger.parse({ type: 'manual' });
    expect(parsed.type).toBe('manual');
  });

  it('faz round-trip de trigger manual com scheduledAt como string ISO', () => {
    const parsed = Trigger.parse({
      type: 'manual',
      scheduledAt: '2026-05-01T12:00:00.000Z',
    });
    expect(parsed.type).toBe('manual');
    if (parsed.type === 'manual') {
      expect(parsed.scheduledAt).toBeInstanceOf(Date);
      expect(parsed.scheduledAt?.toISOString()).toBe(
        '2026-05-01T12:00:00.000Z',
      );
    }
  });

  it('faz round-trip de trigger event aplicando default delayMinutes=0', () => {
    const parsed = Trigger.parse({
      type: 'event',
      event: 'pedido.criado',
    });
    if (parsed.type === 'event') {
      expect(parsed.delayMinutes).toBe(0);
      expect(parsed.event).toBe('pedido.criado');
    }
  });

  it('rejeita type inválido via discriminatedUnion', () => {
    expect(() => Trigger.parse({ type: 'cron', cron: '* * * * *' })).toThrow();
  });

  it('rejeita event.delayMinutes negativo', () => {
    expect(() =>
      Trigger.parse({ type: 'event', event: 'x', delayMinutes: -1 }),
    ).toThrow();
  });
});
