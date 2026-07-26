import { IsIn } from 'class-validator';
import { ORG_ROLES, type OrgRole } from '../roles.js';

export class UpdateMemberDto {
  @IsIn(ORG_ROLES)
  role!: OrgRole;
}
