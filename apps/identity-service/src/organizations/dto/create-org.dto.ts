import { IsString, MinLength } from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
