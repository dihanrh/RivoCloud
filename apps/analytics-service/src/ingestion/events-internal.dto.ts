import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsInt, IsString, Length, Matches, ValidateNested } from 'class-validator';

export class IngestEventDto {
  @IsISO8601() timestamp!: string;
  @IsString() zone_id!: string;
  @IsString() org_id!: string;
  @IsString() datacenter!: string;
  @IsString() method!: string;
  @IsString() path!: string;
  @IsInt() status_code!: number;
  @IsString() cache_status!: string;
  @IsInt() bytes_sent!: number;
  @IsInt() duration_ms!: number;
  // request_logs.country is ClickHouse FixedString(2): one out-of-shape value
  // would make ClickHouse reject the whole batch insert, so reject the request
  // with a 400 here instead (this endpoint's batch is one atomic call).
  @IsString() @Length(2, 2) @Matches(/^[A-Za-z]{2}$/) country!: string;
  @IsString() client_ip_hash!: string;
}

export class IngestBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events!: IngestEventDto[];
}
