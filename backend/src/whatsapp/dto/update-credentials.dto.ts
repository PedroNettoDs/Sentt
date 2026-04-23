// Merge parcial das credenciais Cloud API — §5.11.
// O service lê o ciphertext atual, decripta, aplica `Object.assign` e re-encripta.
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCredentialsDto {
  @IsOptional() @IsString() @MinLength(10) accessToken?: string;
  @IsOptional() @IsString() @MinLength(3) phoneNumberId?: string;
  @IsOptional() @IsString() wabaId?: string;
}
