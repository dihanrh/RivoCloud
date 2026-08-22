import { IsIn, IsInt, IsOptional, IsUrl, Min, MinLength, IsString } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  originUrl!: string;

  @IsOptional()
  @IsIn(['http', 'https', 'match'])
  originProtocol?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cacheTtl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  browserTtl?: number;
}
