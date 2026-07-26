import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '../../organizations/roles.js';

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions?: ApiKeyScope[];
}
