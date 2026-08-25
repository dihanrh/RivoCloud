// MinIO/S3 bucket names must be globally unique across the whole
// deployment, but buckets.name is only unique per-org (@@unique([orgId,
// name])) — the same shape of bug Stage 4's final review caught with CDN
// zone hostnames. Deriving the physical name from the row's own UUID
// sidesteps it entirely: two orgs can each name their bucket "photos" and
// never collide in MinIO, since the byte-level storage is addressed by ID,
// never by the user-chosen name.
export const PHYSICAL_BUCKET_PREFIX = 'rc-';

export function physicalBucketName(bucketId: string): string {
  return `${PHYSICAL_BUCKET_PREFIX}${bucketId}`;
}
