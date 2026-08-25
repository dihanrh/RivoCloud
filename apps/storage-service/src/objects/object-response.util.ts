import type { StorageObject } from '@rivocloud/db';

// StorageObject.size is a Prisma BigInt (nullable — null while the upload is
// still pending, set once MinIO's webhook confirms it). NestJS serializes
// HTTP responses via JSON.stringify under the hood, which cannot serialize a
// BigInt at all ("Do not know how to serialize a BigInt") — so any raw
// Prisma row with a real size 500s the moment it's returned from a
// controller. Stringify it instead of leaving it a number: BigInt can
// legitimately exceed Number.MAX_SAFE_INTEGER for large files, so a plain
// JSON number would silently lose precision. This is the same convention
// many S3-compatible/REST APIs use for 64-bit sizes.
export type ObjectResponse = Omit<StorageObject, 'size'> & { size: string | null };

export function toObjectResponse(object: StorageObject): ObjectResponse {
  return { ...object, size: object.size === null ? null : object.size.toString() };
}
