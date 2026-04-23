import { isWithin24hWindow, WINDOW_24H_MS } from './window-policy';

describe('isWithin24hWindow', () => {
  const NOW = new Date('2026-04-23T12:00:00Z');

  it('retorna false se lastInboundAt é null/undefined', () => {
    expect(isWithin24hWindow(null, NOW)).toBe(false);
    expect(isWithin24hWindow(undefined, NOW)).toBe(false);
  });

  it('aceita agora mesmo (diff 0)', () => {
    expect(isWithin24hWindow(NOW, NOW)).toBe(true);
  });

  it('aceita 23h59min atrás', () => {
    const past = new Date(NOW.getTime() - (WINDOW_24H_MS - 60_000));
    expect(isWithin24hWindow(past, NOW)).toBe(true);
  });

  it('aceita exatamente 24h atrás (limite inclusivo)', () => {
    const past = new Date(NOW.getTime() - WINDOW_24H_MS);
    expect(isWithin24hWindow(past, NOW)).toBe(true);
  });

  it('rejeita 24h01min atrás', () => {
    const past = new Date(NOW.getTime() - WINDOW_24H_MS - 60_000);
    expect(isWithin24hWindow(past, NOW)).toBe(false);
  });

  it('rejeita futuro (diff negativo — clock skew)', () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(isWithin24hWindow(future, NOW)).toBe(false);
  });
});
