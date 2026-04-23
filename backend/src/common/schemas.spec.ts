import { TriageFlowStructureSchema } from './schemas';

describe('TriageFlowStructureSchema', () => {
  const fluxoValido = {
    greeting: 'Olá, bem-vindo ao atendimento!',
    entryStep: 'menu-inicial',
    steps: [
      {
        id: 'menu-inicial',
        type: 'menu',
        prompt: 'Como posso ajudar?',
        options: [
          { key: '1', label: 'Suporte', nextStep: 'coletar-email' },
          { key: '2', label: 'Comercial', nextStep: 'fim-comercial' },
        ],
      },
      {
        id: 'coletar-email',
        type: 'collect',
        prompt: 'Qual seu email?',
        variable: 'email',
        validator: 'email',
        maxRetries: 3,
        nextStep: 'checa-email',
      },
      {
        id: 'checa-email',
        type: 'condition',
        variable: 'email',
        operator: 'exists',
        thenStep: 'fim-comercial',
        elseStep: 'fim-erro',
      },
      {
        id: 'fim-comercial',
        type: 'route',
        queue: 'comercial',
        message: 'Transferindo ao comercial...',
      },
      {
        id: 'fim-erro',
        type: 'message',
        text: 'Não consegui validar seu email. Tente novamente.',
      },
    ],
  };

  it('faz round-trip de um fluxo válido sem perder dados', () => {
    const parsed = TriageFlowStructureSchema.parse(fluxoValido);
    expect(parsed.greeting).toBe(fluxoValido.greeting);
    expect(parsed.entryStep).toBe(fluxoValido.entryStep);
    expect(parsed.steps).toHaveLength(5);
    expect(parsed.steps[0]).toMatchObject({ type: 'menu', id: 'menu-inicial' });
  });

  it('aplica default maxRetries=3 em collect quando ausente', () => {
    const semMax = {
      greeting: 'oi',
      entryStep: 's1',
      steps: [
        {
          id: 's1',
          type: 'collect',
          prompt: 'nome?',
          variable: 'nome',
          validator: 'any',
          nextStep: 'fim',
        },
        { id: 'fim', type: 'message', text: 'ok' },
      ],
    };
    const parsed = TriageFlowStructureSchema.parse(semMax);
    const collect = parsed.steps.find((s) => s.type === 'collect');
    expect(collect && 'maxRetries' in collect && collect.maxRetries).toBe(3);
  });

  it('rejeita menu sem opções', () => {
    const invalido = {
      greeting: 'x',
      entryStep: 'm',
      steps: [{ id: 'm', type: 'menu', prompt: 'p', options: [] }],
    };
    expect(() => TriageFlowStructureSchema.parse(invalido)).toThrow();
  });

  it('rejeita type desconhecido via discriminatedUnion', () => {
    const invalido = {
      greeting: 'x',
      entryStep: 's1',
      steps: [{ id: 's1', type: 'inexistente', foo: 'bar' }],
    };
    expect(() => TriageFlowStructureSchema.parse(invalido)).toThrow();
  });

  it('rejeita key de menu maior que 3 chars', () => {
    const invalido = {
      greeting: 'x',
      entryStep: 'm',
      steps: [
        {
          id: 'm',
          type: 'menu',
          prompt: 'p',
          options: [{ key: 'muito-longo', label: 'x', nextStep: 'y' }],
        },
      ],
    };
    expect(() => TriageFlowStructureSchema.parse(invalido)).toThrow();
  });
});
