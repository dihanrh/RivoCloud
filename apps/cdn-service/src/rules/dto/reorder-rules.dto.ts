import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderRulesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  order!: string[];
}
