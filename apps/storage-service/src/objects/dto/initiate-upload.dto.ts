import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;
}
