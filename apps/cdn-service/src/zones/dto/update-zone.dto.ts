import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Min, MinLength, MaxLength } from 'class-validator';

export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(54) name?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) originUrl?: string;
  @IsOptional() @IsIn(['http', 'https', 'match']) originProtocol?: string;
  @IsOptional() @IsInt() @Min(0) cacheTtl?: number;
  @IsOptional() @IsInt() @Min(0) browserTtl?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() signedUrlsRequired?: boolean;
}
