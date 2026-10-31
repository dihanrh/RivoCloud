import { assertValid, conflict, notFound, withStatus } from '../http';
import { iso, isBool, isInt, isString, optional, recordAudit, requireScope } from '../context';
import { newId, sha256, UUID_PATTERN } from '../ids';
import type { ObjectRec, World } from '../world';
import type { Route } from '../router';
import type { Bucket } from '../../types';
import { findOwnedZone } from './cdn';
import { zoneHostname } from '../../zone-hostname';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const toObjectResponse = (o: ObjectRec) => ({ ...o, size: o.size === null ? null : String(o.size) });

function findOwnedBucket(world: World, orgId: string, bucketId: string): Bucket {
  const bucket = world.buckets.find((b) => b.id === bucketId);
  if (!bucket || bucket.orgId !== orgId) throw notFound('Bucket not found');
  return bucket;
}

function findLatest(world: World, bucketId: string, key: string): ObjectRec {
  const object = world.objects
    .filter((o) => o.bucketId === bucketId && o.key === key && o.isLatest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!object || object.status === 'deleted') throw notFound('Object not found');
  return object;
}

// ---------- same-origin upload URLs ----------

interface UploadTicket {
  o: string; // object id
  b: string; // bucket id
  g: string; // org id
  k: string; // key
  c: string; // content type
}

export function encodeUploadTicket(ticket: UploadTicket): string {
  return Buffer.from(JSON.stringify(ticket)).toString('base64url');
}

export function decodeUploadTicket(token: string): UploadTicket | null {
  try {
    const t = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if ([t.o, t.b, t.g, t.k, t.c].every(isString)) return t as UploadTicket;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Stands in for the object store's PUT + upload notification: marks the
 * pending object ready. The ticket carries enough to recreate the pending row
 * if this serverless instance never saw the initiate call.
 */
export function completeUpload(world: World, token: string, size: number, nowMs = Date.now()): ObjectRec | null {
  const ticket = decodeUploadTicket(token);
  if (!ticket) return null;
  const bucket = world.buckets.find((b) => b.id === ticket.b && b.orgId === ticket.g);
  if (!bucket) return null;
  const now = new Date(nowMs).toISOString();
  let object = world.objects.find((o) => o.id === ticket.o);
  if (object?.status === 'deleted') return null;
  if (!object) {
    for (const o of world.objects) if (o.bucketId === bucket.id && o.key === ticket.k) o.isLatest = false;
    const versionId = newId();
    object = {
      id: ticket.o,
      bucketId: bucket.id,
      key: ticket.k,
      versionId,
      isLatest: true,
      size: null,
      contentType: ticket.c,
      etag: null,
      storagePath: `rc-${bucket.id}/${ticket.k}/${versionId}`,
      metadata: null,
      status: 'pending',
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    world.objects.push(object);
  }
  object.status = 'ready';
  object.size = size;
  object.etag = sha256(`${object.id}:${size}`).slice(0, 32);
  object.updatedAt = now;
  return object;
}

export const storageRoutes: Route[] = [
  // ---------- buckets ----------
  {
    method: 'POST',
    pattern: '/api/v1/buckets',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:write');
      const { name, region, public: isPublic } = ctx.body;
      assertValid([
        !(isString(name) && name.length >= 1) && 'name must be longer than or equal to 1 characters',
        isString(name) && name.length > 63 && 'name must be shorter than or equal to 63 characters',
        !optional(region, isString) && 'region must be a string',
        !optional(isPublic, isBool) && 'public must be a boolean value',
      ]);
      if (ctx.world.buckets.some((b) => b.orgId === caller.orgId && b.name === name)) {
        throw conflict(`A bucket named "${name}" already exists in this organization`);
      }
      const bucket: Bucket = {
        id: newId(),
        orgId: caller.orgId,
        projectId: null,
        name: name as string,
        region: (region as string | undefined) ?? 'eu-central',
        versioningEnabled: false,
        public: isPublic === true,
        lifecycleRules: null,
        createdAt: iso(ctx),
      };
      ctx.world.buckets.push(bucket);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'bucket.created', resourceType: 'bucket', resourceId: bucket.id });
      return withStatus(201, bucket);
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/buckets',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:read');
      const skip = Math.max(0, Number(ctx.query.get('skip')) || 0);
      const take = Math.min(100, Math.max(1, Number(ctx.query.get('take')) || 50));
      const all = ctx.world.buckets.filter((b) => b.orgId === caller.orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { buckets: all.slice(skip, skip + take), total: all.length };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/buckets/:bucketId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:read');
      return findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/buckets/:bucketId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:write');
      const { public: isPublic, versioningEnabled, lifecycleRules } = ctx.body;
      assertValid([
        !optional(isPublic, isBool) && 'public must be a boolean value',
        !optional(versioningEnabled, isBool) && 'versioningEnabled must be a boolean value',
      ]);
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      if (isBool(isPublic)) bucket.public = isPublic;
      if (isBool(versioningEnabled)) bucket.versioningEnabled = versioningEnabled;
      if (lifecycleRules !== undefined) bucket.lifecycleRules = lifecycleRules;
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'bucket.updated', resourceType: 'bucket', resourceId: bucket.id });
      return bucket;
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/buckets/:bucketId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:delete');
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      if (ctx.world.objects.some((o) => o.bucketId === bucket.id && o.status !== 'deleted')) {
        throw conflict('Bucket is not empty — delete its objects first');
      }
      ctx.world.buckets = ctx.world.buckets.filter((b) => b !== bucket);
      ctx.world.objects = ctx.world.objects.filter((o) => o.bucketId !== bucket.id);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'bucket.deleted', resourceType: 'bucket', resourceId: bucket.id });
      return { success: true };
    },
  },

  // ---------- objects ----------
  {
    method: 'POST',
    pattern: '/api/v1/buckets/:bucketId/objects/upload',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:write');
      const { key, contentType, size } = ctx.body;
      assertValid([
        !(isString(key) && key.length >= 1) && 'key must be longer than or equal to 1 characters',
        !optional(contentType, isString) && 'contentType must be a string',
        size !== undefined && !(isInt(size) && size >= 0) && 'size must not be less than 0',
      ]);
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      for (const o of ctx.world.objects) if (o.bucketId === bucket.id && o.key === key && o.isLatest) o.isLatest = false;
      const versionId = newId();
      const now = iso(ctx);
      const object: ObjectRec = {
        id: newId(),
        bucketId: bucket.id,
        key: key as string,
        versionId,
        isLatest: true,
        size: isInt(size) ? size : null,
        contentType: (contentType as string | undefined) ?? 'application/octet-stream',
        etag: null,
        storagePath: `rc-${bucket.id}/${key}/${versionId}`,
        metadata: null,
        status: 'pending',
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      };
      ctx.world.objects.push(object);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'object.upload_initiated', resourceType: 'bucket', resourceId: bucket.id, bodyFields: ['key', 'contentType'] });
      // Same-origin stand-in for the object store's presigned PUT URL.
      const ticket = encodeUploadTicket({ o: object.id, b: bucket.id, g: caller.orgId, k: object.key, c: object.contentType });
      return withStatus(201, { objectId: object.id, uploadUrl: `/api/demo/upload/${ticket}` });
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/buckets/:bucketId/objects',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:read');
      const prefix = ctx.query.get('prefix');
      const skip = Number(ctx.query.get('skip') ?? 0);
      const take = Number(ctx.query.get('take') ?? 50);
      assertValid([
        !(Number.isInteger(skip) && skip >= 0) && 'skip must not be less than 0',
        !(Number.isInteger(take) && take >= 1 && take <= 100) && 'take must not be greater than 100',
      ]);
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      const all = ctx.world.objects
        .filter((o) => o.bucketId === bucket.id && o.isLatest && o.status !== 'deleted' && (!prefix || o.key.startsWith(prefix)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { objects: all.slice(skip, skip + take).map(toObjectResponse), total: all.length };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/buckets/:bucketId/objects/:key',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:read');
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      return toObjectResponse(findLatest(ctx.world, bucket.id, ctx.params.key));
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/buckets/:bucketId/objects/:key/sign',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:read');
      const { zoneId, expiresIn, download, filename } = ctx.body;
      assertValid([
        !(isString(zoneId) && UUID_PATTERN.test(zoneId)) && 'zoneId must be a UUID',
        expiresIn !== undefined && !(isInt(expiresIn) && expiresIn >= 60) && 'expiresIn must not be less than 60',
        isInt(expiresIn) && expiresIn > 604800 && 'expiresIn must not be greater than 604800',
        !optional(download, isBool) && 'download must be a boolean value',
        filename !== undefined && !(isString(filename) && filename.length >= 1 && filename.length <= 255) && 'filename must be longer than or equal to 1 characters',
      ]);
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      const object = findLatest(ctx.world, bucket.id, ctx.params.key);
      if (object.status !== 'ready') throw conflict('Object upload has not completed yet');
      const zone = findOwnedZone(ctx, caller.orgId, zoneId as string);
      if (!zone.signedUrlsRequired || !zone.signingSecret) throw conflict('Signed URLs are not enabled on this zone');
      const expires = Math.floor(ctx.now / 1000) + ((expiresIn as number | undefined) ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
      // A harmless same-origin page that explains the link instead of serving bytes.
      const url = new URL('/api/demo/signed', ctx.origin);
      url.searchParams.set('host', zoneHostname(zone));
      url.searchParams.set('path', `/${object.key}`);
      url.searchParams.set('expires', String(expires));
      url.searchParams.set('sig', sha256(`${zone.signingSecret}:/${object.key}:${expires}`).slice(0, 43));
      if (download) url.searchParams.set('download', '1');
      if (filename) url.searchParams.set('filename', filename as string);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'object.signed_url_created', resourceType: 'object', resourceId: object.key, bodyFields: ['zoneId', 'expiresIn'] });
      return withStatus(200, { url: url.toString(), expiresAt: new Date(expires * 1000).toISOString() });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/buckets/:bucketId/objects/:key',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'storage:delete');
      const bucket = findOwnedBucket(ctx.world, caller.orgId, ctx.params.bucketId);
      const object = findLatest(ctx.world, bucket.id, ctx.params.key);
      object.status = 'deleted';
      object.updatedAt = iso(ctx);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'object.deleted', resourceType: 'object', resourceId: object.key });
      return { success: true };
    },
  },
];

