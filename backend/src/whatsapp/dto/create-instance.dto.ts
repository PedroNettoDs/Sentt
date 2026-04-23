// DTOs de entrada do CRUD de instâncias — §5.11 do prompt-motor.md.
//
// Aqui **podem** entrar credenciais em texto claro (Cloud API). Depois de
// persistidas, o service cifra com `encryptCredentials()` e nunca mais reexpõe.
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WhatsAppDriver, WhatsAppInstanceRole } from '@prisma/client';

export class CloudApiCredentialsDto {
  @IsString() @MinLength(10) accessToken!: string;
  @IsString() @MinLength(3) phoneNumberId!: string;
  @IsOptional() @IsString() wabaId?: string;
}

export class CreateInstanceDto {
  @IsString() @MinLength(2) @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'name deve conter apenas letras, números, "_" ou "-"',
  })
  name!: string;

  @IsEnum(WhatsAppDriver) driver!: WhatsAppDriver;

  @IsOptional() @IsEnum(WhatsAppInstanceRole) role?: WhatsAppInstanceRole;

  @IsOptional() @IsBoolean() setAsPrimary?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => CloudApiCredentialsDto)
  credentials?: CloudApiCredentialsDto;
}
