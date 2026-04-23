// Nomes das filas BullMQ — §10.2 do prompt-motor.md.
// Usar essas constantes em `@InjectQueue`, `@Processor` e no registro do BullModule
// para evitar typos e permitir renomear uma fila num só lugar.

export const QUEUE_WHATSAPP_INBOUND = 'whatsapp-inbound';
export const QUEUE_WHATSAPP_OUTBOUND = 'whatsapp-outbound';
export const QUEUE_CAMPAIGNS_DISPATCH = 'campaigns-dispatch';
export const QUEUE_BOT_ENGINE = 'bot-engine';
