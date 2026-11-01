import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** A stable, UUID-shaped id derived from a name, so seeded rows keep their ids across cold starts. */
export function seedId(name: string): string {
  const hex = createHash('sha256').update(`rivo-demo:${name}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const newId = (): string => randomUUID();

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function randomBase58(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += BASE58[bytes[i] % BASE58.length];
  return out;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  return sha256(`rivo-demo-password:${password}`);
}

/** FNV-1a: a fast deterministic hash mapped to [0, 1). Drives the synthetic analytics. */
export function unitHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // One extra avalanche round so neighbouring inputs don't correlate.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
