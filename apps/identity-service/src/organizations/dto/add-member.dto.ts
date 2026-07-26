import { IsEmail, IsIn } from 'class-validator';
import { ORG_ROLES, type OrgRole } from '../roles.js';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ORG_ROLES)
  role!: OrgRole;
}
