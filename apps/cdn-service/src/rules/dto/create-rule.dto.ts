import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Min, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateCacheRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  pattern!: string;

  @IsOptional()
  @IsIn(['glob', 'regex', 'exact'])
  patternType?: string;

  @IsOptional()
  @IsIn(['cache', 'bypass', 'no-store'])
  action?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  edgeTtl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  browserTtl?: number;

  @IsOptional()
  @IsIn(['strip_all', 'whitelist', 'include_all'])
  queryString?: string;

  @ValidateIf((o) => o.queryString === 'whitelist')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  queryWhitelist?: string[];

  @IsOptional()
  @IsInt()
  priority?: number;
}
