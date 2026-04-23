// CRUD de `WhatsAppInstance` — §5.11 do prompt-motor.md.
//
// Regras duras:
//   - `setPrimary`/`create(setAsPrimary)` rodam em `$transaction` que primeiro
//     zera o primary atual do mesmo role e depois marca o novo (§5.11).
//   - `setPrimary` exige `isConnected=true`.
//   - `credentials` é persistido cifrado (AES-256-GCM). A API **nunca** expõe o
//     ciphertext — só `hasCredentials: boolean` via `toInstanceResponse`.
//   - Qualquer mutação em instância Cloud API (create, updateCredentials, delete,
//     disconnect, role change que zera primary, etc.) chama
//     `factory.invalidate(id)` para não servir credenciais antigas cacheadas.
//   - Delete é soft (`deletedAt=now, isPrimary=false, isConnected=false`).
//
// `reconnect` é best-effort: consulta o driver (`provider.getConnectionState`) e
// reflete o estado no DB. `disconnect` força `isConnected=false`.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WhatsAppInstance } from '@prisma/client';
import {
  decryptCredentials,
  encryptCredentials,
} from '../common/utils/credentials-cipher.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CloudApiCredentialsDto,
  CreateInstanceDto,
} from './dto/create-instance.dto';
import { ListInstancesDto } from './dto/list-instances.dto';
import { UpdateCredentialsDto } from './dto/update-credentials.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloudApiProvider, type CloudApiCredentials } from './providers/cloud-api.provider';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';

@Injectable()
export class InstancesService {
  private readonly logger = new Logger(InstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: WhatsAppProviderFactory,
  ) {}

  // -------- list / get -----------------------------------------------

  async list(filters: ListInstancesDto): Promise<WhatsAppInstance[]> {
    const where: Prisma.WhatsAppInstanceWhereInput = {};
    if (filters.role) where.role = filters.role;
    if (filters.primary !== undefined) where.isPrimary = filters.primary;
    if (!filters.includeDeleted) where.deletedAt = null;
    return this.prisma.whatsAppInstance.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async get(id: number): Promise<WhatsAppInstance> {
    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { id },
    });
    if (!instance) throw new NotFoundException(`instância ${id} não encontrada`);
    return instance;
  }

  // -------- create ---------------------------------------------------

  async create(dto: CreateInstanceDto): Promise<WhatsAppInstance> {
    if (dto.driver === 'CLOUD_API' && !dto.credentials) {
      throw new BadRequestException(
        'driver CLOUD_API exige credentials { accessToken, phoneNumberId }',
      );
    }
    if (dto.driver === 'BAILEYS' && dto.credentials) {
      throw new BadRequestException(
        'driver BAILEYS não aceita credentials (usa EVOLUTION_API_KEY global)',
      );
    }

    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`instância com name="${dto.name}" já existe`);
    }

    const role = dto.role ?? 'ATENDIMENTO';
    const data: Prisma.WhatsAppInstanceCreateInput = {
      name: dto.name,
      driver: dto.driver,
      role,
    };
    if (dto.credentials) {
      data.credentials = encryptCredentials(toCreds(dto.credentials));
      data.metaPhoneNumberId = dto.credentials.phoneNumberId;
    }

    const created = await this.prisma.whatsAppInstance.create({ data });

    if (dto.setAsPrimary) {
      return this.setPrimaryInternal(created.id, /* requireConnected */ false);
    }
    return created;
  }

  // -------- role -----------------------------------------------------

  async updateRole(
    id: number,
    dto: UpdateRoleDto,
  ): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    if (instance.role === dto.role) return instance;

    // Se era primary do role antigo, zera isPrimary (§5.11: "se era primary do
    // role antigo, zera isPrimary").
    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: {
        role: dto.role,
        ...(instance.isPrimary ? { isPrimary: false } : {}),
      },
    });
    if (instance.driver === 'CLOUD_API') this.factory.invalidate(id);
    return updated;
  }

  // -------- setPrimary (transação atômica) --------------------------

  async setPrimary(id: number): Promise<WhatsAppInstance> {
    return this.setPrimaryInternal(id, /* requireConnected */ true);
  }

  private async setPrimaryInternal(
    id: number,
    requireConnected: boolean,
  ): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    if (instance.deletedAt) {
      throw new BadRequestException('instância excluída não pode virar primary');
    }
    if (requireConnected && !instance.isConnected) {
      throw new BadRequestException(
        'setPrimary exige isConnected=true — chame /reconnect antes',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Passo 1: zera quem era primary do mesmo role.
      await tx.whatsAppInstance.updateMany({
        where: { role: instance.role, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
      // Passo 2: marca a nova como primary.
      return tx.whatsAppInstance.update({
        where: { id },
        data: { isPrimary: true },
      });
    });
  }

  // -------- credentials ---------------------------------------------

  async updateCredentials(
    id: number,
    dto: UpdateCredentialsDto,
  ): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    if (instance.driver !== 'CLOUD_API') {
      throw new BadRequestException(
        'updateCredentials só se aplica a driver CLOUD_API',
      );
    }
    if (typeof instance.credentials !== 'string' || instance.credentials === '') {
      throw new BadRequestException(
        'instância sem credentials cifradas — use POST para criar uma nova',
      );
    }

    const current = decryptCredentials<CloudApiCredentials>(instance.credentials);
    const merged: CloudApiCredentials = {
      accessToken: dto.accessToken ?? current.accessToken,
      phoneNumberId: dto.phoneNumberId ?? current.phoneNumberId,
      ...(dto.wabaId !== undefined
        ? { wabaId: dto.wabaId }
        : current.wabaId
          ? { wabaId: current.wabaId }
          : {}),
    };

    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: {
        credentials: encryptCredentials(merged),
        metaPhoneNumberId: merged.phoneNumberId,
      },
    });

    this.factory.invalidate(id);
    return updated;
  }

  // -------- reconnect / disconnect ----------------------------------

  async reconnect(id: number): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    if (instance.deletedAt) {
      throw new BadRequestException('instância excluída não pode reconectar');
    }

    let isConnected = false;
    try {
      const provider = this.factory.for(instance);
      // Cloud API não tem "state" — é sempre tratado como aberto se credenciais
      // forem válidas. Para simplificar e ser consistente, consideramos
      // "open" se o provider aceitar a chamada.
      if (provider instanceof CloudApiProvider) {
        isConnected = true;
      } else {
        const state = await provider.getConnectionState(instance.name);
        isConnected = state === 'open';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`reconnect ${id} falhou: ${msg}`);
      isConnected = false;
    }

    return this.prisma.whatsAppInstance.update({
      where: { id },
      data: {
        isConnected,
        ...(isConnected ? { lastConnectionAt: new Date() } : {}),
      },
    });
  }

  async disconnect(id: number): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: {
        isConnected: false,
        ...(instance.isPrimary ? { isPrimary: false } : {}),
      },
    });
    if (instance.driver === 'CLOUD_API') this.factory.invalidate(id);
    return updated;
  }

  // -------- softDelete ----------------------------------------------

  async softDelete(id: number): Promise<WhatsAppInstance> {
    const instance = await this.get(id);
    if (instance.deletedAt) return instance;
    const deleted = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isPrimary: false,
        isConnected: false,
      },
    });
    this.factory.invalidate(id);
    return deleted;
  }
}

// Converte o DTO (com typing forte do class-validator) para o tipo do provider.
function toCreds(dto: CloudApiCredentialsDto): CloudApiCredentials {
  return {
    accessToken: dto.accessToken,
    phoneNumberId: dto.phoneNumberId,
    ...(dto.wabaId ? { wabaId: dto.wabaId } : {}),
  };
}
