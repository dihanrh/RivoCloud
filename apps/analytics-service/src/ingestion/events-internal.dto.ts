import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsString, ValidateNested } from 'class-validator';

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
  @IsString() country!: string;
  @IsString() client_ip_hash!: string;
}

export class IngestBatchDto {
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events!: IngestEventDto[];
}
