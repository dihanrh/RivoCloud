import { IsInt, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class SignUrlInternalDto {
  @IsUUID()
  orgId!: string;

  // The DECODED path the edge will see as r.URL.Path, e.g. "/reports/q3 2026.pdf".
  @IsString()
  @Matches(/^\//, { message: 'path must start with "/"' })
  @MaxLength(2048)
  path!: string;

  // Unix seconds.
  @IsInt()
  @Min(1)
  expires!: number;
}
