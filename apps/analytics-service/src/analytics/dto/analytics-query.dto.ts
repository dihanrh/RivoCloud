import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class AnalyticsQueryDto {
  // PullZone.id is a Postgres UUID column: a non-UUID value would make Prisma
  // throw P2023 (an unhandled 500) rather than a clean 400.
  @IsOptional() @IsUUID() zoneId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(['hour', 'day', 'week']) granularity?: 'hour' | 'day' | 'week';
}
