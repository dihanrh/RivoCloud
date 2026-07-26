import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
