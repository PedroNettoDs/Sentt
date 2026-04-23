import type { WhatsAppInstance, WhatsAppInstanceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppRouterService } from './whatsapp-router.service';
import { isRoutingFailure } from './types';

type Fixture = Pick<
  WhatsAppInstance,
  'id' | 'driver' | 'role' | 'isPrimary' | 'updatedAt' | 'isConnected' | 'deletedAt'
>;

// Mock mínimo que simula `prisma.whatsAppInstance.findFirst` respeitando
// where (driver, role in, isConnected, deletedAt, NOT id) + orderBy
// (isPrimary desc, updatedAt desc).
function makePrisma(fixtures: Fixture[]): PrismaService {
  return {
    whatsAppInstance: {
      findFirst: jest.fn((args: {
        where?: {
          driver?: string;
          role?: { in?: WhatsAppInstanceRole[] };
          isConnected?: boolean;
          deletedAt?: null;
          NOT?: { id?: number };
        };
      }) => {
        const w = args?.where ?? {};
        const filtered = fixtures.filter((f) => {
          if (w.driver && f.driver !== w.driver) return false;
          if (w.role?.in && !w.role.in.includes(f.role)) return false;
          if (w.isConnected !== undefined && f.isConnected !== w.isConnected)
            return false;
          if (w.deletedAt === null && f.deletedAt !== null) return false;
          if (w.NOT?.id !== undefined && f.id === w.NOT.id) return false;
          return true;
        });
        filtered.sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
        return Promise.resolve(filtered[0] ?? null);
      }),
    },
  } as unknown as PrismaService;
}

const NOW = new Date('2026-04-23T12:00:00Z');
const IN_WINDOW = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h atrás
const OUT_WINDOW = new Date(NOW.getTime() - 25 * 60 * 60 * 1000); // 25h atrás

function fix(
  partial: Partial<Fixture> & {
    id: number;
    driver: 'BAILEYS' | 'CLOUD_API';
    role: WhatsAppInstanceRole;
  },
): Fixture {
  return {
    isPrimary: false,
    isConnected: true,
    deletedAt: null,
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    ...partial,
  };
}

describe('WhatsAppRouterService', () => {
  // ----------------------------------------------------------------
  // SUPPORT_REPLY
  // ----------------------------------------------------------------
  describe('SUPPORT_REPLY (4 casos)', () => {
    it('janela aberta + ATENDIMENTO Baileys → support-primary', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO', isPrimary: true }),
          fix({ id: 2, driver: 'BAILEYS', role: 'BOTH' }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      expect(isRoutingFailure(r)).toBe(false);
      if (isRoutingFailure(r)) return;
      expect(r.instanceId).toBe(1);
      expect(r.decision).toBe('support-primary');
      expect(r.driver).toBe('BAILEYS');
    });

    it('janela aberta + só BOTH Baileys → support-fallback-both', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([fix({ id: 2, driver: 'BAILEYS', role: 'BOTH' })]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(2);
      expect(r.decision).toBe('support-fallback-both');
    });

    it('janela fechada + Cloud API → out-of-window-fallback', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO' }),
          fix({ id: 3, driver: 'CLOUD_API', role: 'BOTH' }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: OUT_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(3);
      expect(r.decision).toBe('out-of-window-fallback');
      expect(r.driver).toBe('CLOUD_API');
    });

    it('janela fechada + só Baileys → out-of-window-baileys-risky com warning', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO', isPrimary: true }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: null,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.decision).toBe('out-of-window-baileys-risky');
      expect(r.warnings?.length).toBeGreaterThan(0);
    });

    it('sem instâncias retorna failure', async () => {
      const router = new WhatsAppRouterService(makePrisma([]));
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      expect(isRoutingFailure(r)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // BOT_MESSAGE
  // ----------------------------------------------------------------
  describe('BOT_MESSAGE', () => {
    it('ATENDIMENTO ou BOTH Baileys → bot', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([fix({ id: 9, driver: 'BAILEYS', role: 'ATENDIMENTO' })]),
      );
      const r = await router.resolve({ intent: 'BOT_MESSAGE', now: NOW });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.decision).toBe('bot');
      expect(r.driver).toBe('BAILEYS');
    });

    it('sem Baileys → failure', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([fix({ id: 3, driver: 'CLOUD_API', role: 'BOTH' })]),
      );
      const r = await router.resolve({ intent: 'BOT_MESSAGE', now: NOW });
      expect(isRoutingFailure(r)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // COLD_OUTREACH
  // ----------------------------------------------------------------
  describe('COLD_OUTREACH', () => {
    it('prefere role=COLD_OUTREACH → cold-primary', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 5, driver: 'CLOUD_API', role: 'COLD_OUTREACH' }),
          fix({ id: 6, driver: 'CLOUD_API', role: 'BOTH', isPrimary: true }),
        ]),
      );
      const r = await router.resolve({ intent: 'COLD_OUTREACH', now: NOW });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(5);
      expect(r.decision).toBe('cold-primary');
    });

    it('fallback para BOTH → cold-both', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([fix({ id: 6, driver: 'CLOUD_API', role: 'BOTH' })]),
      );
      const r = await router.resolve({ intent: 'COLD_OUTREACH', now: NOW });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(6);
      expect(r.decision).toBe('cold-both');
    });

    it('sem Cloud API → failure', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO' })]),
      );
      const r = await router.resolve({ intent: 'COLD_OUTREACH', now: NOW });
      expect(isRoutingFailure(r)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // CAMPAIGN_WARM
  // ----------------------------------------------------------------
  describe('CAMPAIGN_WARM', () => {
    it('janela aberta → warm-in-window via Baileys', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO', isPrimary: true }),
          fix({ id: 5, driver: 'CLOUD_API', role: 'COLD_OUTREACH' }),
        ]),
      );
      const r = await router.resolve({
        intent: 'CAMPAIGN_WARM',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.decision).toBe('warm-in-window');
      expect(r.driver).toBe('BAILEYS');
    });

    it('janela fechada cai para COLD_OUTREACH (cold-primary)', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 1, driver: 'BAILEYS', role: 'ATENDIMENTO' }),
          fix({ id: 5, driver: 'CLOUD_API', role: 'COLD_OUTREACH' }),
        ]),
      );
      const r = await router.resolve({
        intent: 'CAMPAIGN_WARM',
        lastInboundAt: OUT_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.decision).toBe('cold-primary');
    });
  });

  // ----------------------------------------------------------------
  // Tiebreaker e filtros
  // ----------------------------------------------------------------
  describe('tiebreaker + filtros', () => {
    it('isPrimary vence updatedAt mais recente', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({
            id: 10,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            isPrimary: true,
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          }),
          fix({
            id: 11,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            isPrimary: false,
            updatedAt: new Date('2026-04-20T00:00:00Z'),
          }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(10);
    });

    it('entre não-primárias, updatedAt mais recente vence', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({
            id: 20,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          }),
          fix({
            id: 21,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            updatedAt: new Date('2026-04-20T00:00:00Z'),
          }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(21);
    });

    it('filtra isConnected=false e deletedAt', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({
            id: 30,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            isConnected: false,
          }),
          fix({
            id: 31,
            driver: 'BAILEYS',
            role: 'ATENDIMENTO',
            deletedAt: new Date(),
          }),
          fix({ id: 32, driver: 'BAILEYS', role: 'ATENDIMENTO' }),
        ]),
      );
      const r = await router.resolve({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(32);
    });

    it('resolveFallback exclui a instância falha', async () => {
      const router = new WhatsAppRouterService(
        makePrisma([
          fix({ id: 40, driver: 'BAILEYS', role: 'ATENDIMENTO', isPrimary: true }),
          fix({ id: 41, driver: 'BAILEYS', role: 'ATENDIMENTO' }),
        ]),
      );
      const r = await router.resolveFallback({
        intent: 'SUPPORT_REPLY',
        lastInboundAt: IN_WINDOW,
        now: NOW,
        excludeInstanceId: 40,
      });
      if (isRoutingFailure(r)) throw new Error('esperava sucesso');
      expect(r.instanceId).toBe(41);
    });
  });
});
