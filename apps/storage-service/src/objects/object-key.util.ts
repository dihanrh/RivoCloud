import { PHYSICAL_BUCKET_PREFIX } from '../buckets/bucket-name.util.js';

// The MinIO object key for an upload is "{key}/{versionId}" (objects.service.ts's
// initiateUpload). versionId is always the last path segment and is always a
// UUID with no slashes in it, but key itself can legitimately contain slashes
// (e.g. "assets/hero.jpg") — so split on the LAST "/", not the first.
export function splitKeyAndVersion(rawMinioKey: string): [key: string, versionId: string] {
  const lastSlash = rawMinioKey.lastIndexOf('/');
  if (lastSlash === -1) {
    return [rawMinioKey, ''];
  }
  return [rawMinioKey.slice(0, lastSlash), rawMinioKey.slice(lastSlash + 1)];
}

// MinIO's webhook reports the object key URL-encoded (spaces as "+", other
// reserved characters percent-encoded) — decode it before use.
export function decodeMinioObjectKey(rawKey: string): string {
  return decodeURIComponent(rawKey.replace(/\+/g, ' '));
}

// The webhook reports the physical bucket name (PHYSICAL_BUCKET_PREFIX +
// bucketId) — strip the prefix to recover the row's own id. Imports the
// same constant physicalBucketName() uses to build it, so the two can never
// drift out of sync.
export function bucketIdFromPhysicalName(physicalName: string): string {
  return physicalName.startsWith(PHYSICAL_BUCKET_PREFIX) ? physicalName.slice(PHYSICAL_BUCKET_PREFIX.length) : physicalName;
}
