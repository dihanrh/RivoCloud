import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

export class SignObjectDto {
  // Buckets and zones aren't linked in the schema, so the caller names the
  // zone whose hostname and signing secret the URL is issued under.
  @IsUUID()
  zoneId!: string;

  // 1 minute to 7 days, the same ceiling S3 puts on presigned URLs.
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(604800)
  expiresIn?: number;

  @IsOptional()
  @IsBoolean()
  download?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename?: string;
}
