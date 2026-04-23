// Janela de 24 h da Meta — mensagens fora dela exigem HSM template (Cloud API).
// §5.10 do prompt-motor.md.
//
// Implementação ponto: referência [prompt-motor.md#L637-L641]. A função é pura
// e determinística (`now` injetável para teste).

export const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

export function isWithin24hWindow(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const diff = now.getTime() - lastInboundAt.getTime();
  return diff >= 0 && diff <= WINDOW_24H_MS;
}
