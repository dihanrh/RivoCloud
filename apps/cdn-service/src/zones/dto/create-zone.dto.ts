export class CreateZoneDto {
  name!: string;
  originUrl!: string;
  originProtocol?: string;
  cacheTtl?: number;
  browserTtl?: number;
}
