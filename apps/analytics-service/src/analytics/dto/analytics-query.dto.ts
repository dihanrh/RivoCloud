import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(['hour', 'day', 'week']) granularity?: 'hour' | 'day' | 'week';
}
