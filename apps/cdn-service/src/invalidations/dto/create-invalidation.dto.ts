import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateInvalidationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  patterns?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
