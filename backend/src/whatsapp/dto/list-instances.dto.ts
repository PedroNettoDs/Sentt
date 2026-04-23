// Filtros do `GET /whatsapp/instances` — §5.11.
// `includeDeleted=true` é o único jeito de ver softDeleted — por padrão
// `deletedAt: null`.
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { WhatsAppInstanceRole } from '@prisma/client';

// Query strings chegam como string — aceita "true"/"false"/"1"/"0".
function parseBoolQuery({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

export class ListInstancesDto {
  @IsOptional() @IsEnum(WhatsAppInstanceRole) role?: WhatsAppInstanceRole;

  @IsOptional()
  @Transform(parseBoolQuery)
  @IsBoolean()
  primary?: boolean;

  @IsOptional()
  @Transform(parseBoolQuery)
  @IsBoolean()
  includeDeleted?: boolean;
}
