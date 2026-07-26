import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
