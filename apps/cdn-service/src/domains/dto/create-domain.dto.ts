import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// RFC 1123 hostname: two or more dot-separated labels, each 1-63
// alphanumerics/hyphens with no leading/trailing hyphen — matches what a
// customer's DNS provider would accept as a CNAME source, and rejects
// protocol prefixes, paths, ports, or wildcards a customer might paste in
// by mistake.
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export class CreateDomainDto {
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  @Matches(HOSTNAME_PATTERN, { message: 'domain must be a valid hostname, e.g. cdn.your-company.com' })
  domain!: string;
}
