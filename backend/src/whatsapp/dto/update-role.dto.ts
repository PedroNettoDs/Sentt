import { IsEnum } from 'class-validator';
import { WhatsAppInstanceRole } from '@prisma/client';

export class UpdateRoleDto {
  @IsEnum(WhatsAppInstanceRole) role!: WhatsAppInstanceRole;
}
