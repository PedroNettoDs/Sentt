// TriageFlowService — §6.5 / §6.6 do prompt-motor.md.
//
// **Stub mínimo para a Fase 4.2**: só implementa `getActive()`, que é a
// única dependência do `BotService`. CRUD completo + `simulate()` entram
// na Fase 4.3. Mantê-lo aqui desde já evita ciclo de importação e permite
// testar o BotService isoladamente.
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  TriageFlowStructureSchema,
  type TriageFlowStructure,
} from '../../common/schemas';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TriageFlowService {
  constructor(private readonly prisma: PrismaService) {}

  // Retorna o fluxo ativo parseado. Se não houver `active=true`, lança —
  // conversa nova sem fluxo é bug de configuração, não caso a tolerar.
  async getActive(): Promise<TriageFlowStructure> {
    const flow = await this.prisma.triageFlow.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!flow) {
      throw new NotFoundException('Nenhum TriageFlow ativo');
    }
    return TriageFlowStructureSchema.parse(flow.structure);
  }
}
