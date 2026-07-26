import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';

export function generateApiKey(testMode: boolean): { raw: string; prefix: string } {
  const body = bs58.encode(randomBytes(32));
  const raw = `${testMode ? 'rc_test_' : 'rc_live_'}${body}`;
  return { raw, prefix: raw.slice(0, 12) };
}
