import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '@rivocloud/security';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions!: ApiKeyScope[];

  @IsOptional()
  @IsBoolean()
  testMode?: boolean;
}
