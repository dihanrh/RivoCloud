import { IsUUID } from 'class-validator';

export class SelectOrgDto {
  @IsUUID()
  orgId!: string;
}
