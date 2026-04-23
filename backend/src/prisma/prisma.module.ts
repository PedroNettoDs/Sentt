// Módulo global do Prisma — qualquer feature pode injetar `PrismaService`
// sem precisar importar este módulo explicitamente. Referenciado no §10.6.
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
