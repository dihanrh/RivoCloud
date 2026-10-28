import { IsIn } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from './assignable-roles.js';

export class UpdateMemberDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
