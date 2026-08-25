import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBucketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  name!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsBoolean()
  public?: boolean;
}
