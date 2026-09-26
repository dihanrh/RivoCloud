import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Zone signing secrets are stored AES-256-GCM-encrypted in
// pull_zones.signing_secret (EDD Section 5.5: "encrypted at rest"). The
// schema's "(bcrypt)" comment predates the scheme being worked out: HMAC
// verification needs the raw secret back, which a one-way hash can't give.
// The "v1:" prefix leaves room to rotate the encryption key later without
// guessing which key a stored value was written under.
const VERSION = 'v1';
const IV_BYTES = 12;

export function generateSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string, keyHex: string): string {
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== VERSION || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('Unrecognized signing secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyHex), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function keyFrom(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('ZONE_SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }
  return key;
}
