import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListAuditLogsDto {
  /** Return entries with an id below this one (the previous page's `nextCursor`). */
  @IsOptional()
  // At most 18 digits, so any accepted value fits in Postgres bigint.
  @Matches(/^\d{1,18}$/, { message: 'cursor must be a numeric id' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
