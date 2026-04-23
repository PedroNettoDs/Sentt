// Factory que resolve o `WhatsAppProvider` correto para uma `WhatsAppInstance` —
// §5.4 do prompt-motor.md.
//
// - BAILEYS: devolve um `EvolutionProvider` bound a `instance.name`. O wrapper é
//   barato (apenas aponta para o `EvolutionClient` singleton) mas é cacheado para
//   evitar alocação em hot-path. A divergência vs §5.4 ("singleton") está
//   registrada em `providers/about.md`.
// - CLOUD_API: descifra `instance.credentials` (AES-256-GCM → `CloudApiCredentials`)
//   e instancia `CloudApiProvider`. Cache por `updatedAt` — a entrada é reciclada
//   sempre que a instância é editada (novo accessToken, novo phoneNumberId, etc.).
//
// `invalidate(instanceId)` remove manualmente a entrada — chamado pelo
// `InstancesService` após `update`/`delete` para evitar uso de credenciais antigas.
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WhatsAppInstance } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import { decryptCredentials } from '../../common/utils/credentials-cipher.util';
import {
  CloudApiProvider,
  type CloudApiCredentials,
} from './cloud-api.provider';
import {
  EvolutionClient,
  EvolutionProvider,
} from './evolution.provider';
import { WhatsAppProvider } from './whatsapp-provider.interface';

type InstanceRef = Pick<
  WhatsAppInstance,
  'id' | 'name' | 'driver' | 'credentials' | 'updatedAt'
>;

interface CacheEntry {
  provider: WhatsAppProvider;
  updatedAt: number;
}

@Injectable()
export class WhatsAppProviderFactory {
  private readonly cache = new Map<number, CacheEntry>();

  constructor(
    private readonly evolution: EvolutionClient,
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  for(instance: InstanceRef): WhatsAppProvider {
    const updatedAt = instance.updatedAt.getTime();
    const cached = this.cache.get(instance.id);
    if (cached && cached.updatedAt === updatedAt) return cached.provider;

    const provider = this.build(instance);
    this.cache.set(instance.id, { provider, updatedAt });
    return provider;
  }

  invalidate(instanceId: number): void {
    this.cache.delete(instanceId);
  }

  private build(instance: InstanceRef): WhatsAppProvider {
    if (instance.driver === 'BAILEYS') {
      return new EvolutionProvider(this.evolution, instance.name);
    }
    if (instance.driver === 'CLOUD_API') {
      if (typeof instance.credentials !== 'string' || instance.credentials === '') {
        throw new Error(
          `WhatsAppInstance ${instance.id} (CLOUD_API) sem credentials cifradas`,
        );
      }
      const creds = decryptCredentials<CloudApiCredentials>(
        instance.credentials,
      );
      return new CloudApiProvider(this.http, this.config, creds);
    }
    throw new Error(`Driver não suportado: ${String(instance.driver)}`);
  }
}
