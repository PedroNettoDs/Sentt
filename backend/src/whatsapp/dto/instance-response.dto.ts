// Serializer de `WhatsAppInstance` — §5.11. **Nunca** expõe o ciphertext de
// `credentials` na API. O consumidor recebe só `hasCredentials: boolean`.
//
// Usado por todas as rotas que retornam instância — crie(), findOne(), list(),
// updateRole(), setPrimary(), etc.
import type { WhatsAppInstance } from '@prisma/client';

export interface InstanceResponse {
  id: number;
  name: string;
  number: string | null;
  driver: WhatsAppInstance['driver'];
  role: WhatsAppInstance['role'];
  isPrimary: boolean;
  isConnected: boolean;
  hasCredentials: boolean;
  metaPhoneNumberId: string | null;
  lastConnectionAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toInstanceResponse(
  instance: WhatsAppInstance,
): InstanceResponse {
  return {
    id: instance.id,
    name: instance.name,
    number: instance.number,
    driver: instance.driver,
    role: instance.role,
    isPrimary: instance.isPrimary,
    isConnected: instance.isConnected,
    hasCredentials:
      typeof instance.credentials === 'string' && instance.credentials !== '',
    metaPhoneNumberId: instance.metaPhoneNumberId,
    lastConnectionAt: instance.lastConnectionAt?.toISOString() ?? null,
    deletedAt: instance.deletedAt?.toISOString() ?? null,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString(),
  };
}
