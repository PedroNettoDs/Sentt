// Wrapper de `PrismaClient` como provider global do Nest — §10.2 do prompt-motor.md.
// Conecta no `onModuleInit` para falhar cedo se o banco estiver fora, e desconecta
// no `onModuleDestroy` para liberar pool em testes e shutdowns.
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
