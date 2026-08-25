import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateBucketDto {
  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @IsOptional()
  @IsBoolean()
  versioningEnabled?: boolean;

  @IsOptional()
  lifecycleRules?: unknown;
}
