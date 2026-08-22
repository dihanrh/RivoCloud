import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';

export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) originUrl?: string;
  @IsOptional() @IsIn(['http', 'https', 'match']) originProtocol?: string;
  @IsOptional() @IsInt() @Min(0) cacheTtl?: number;
  @IsOptional() @IsInt() @Min(0) browserTtl?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
