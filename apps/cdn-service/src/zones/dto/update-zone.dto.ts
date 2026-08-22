export class UpdateZoneDto {
  name?: string;
  originUrl?: string;
  originProtocol?: string;
  cacheTtl?: number;
  browserTtl?: number;
  enabled?: boolean;
}
