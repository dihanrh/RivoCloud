import { IsEmail, IsIn } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from './assignable-roles.js';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
