/**
 * AES-256-GCM envelope for Facebook tokens stored by the Page Scheduler
 * (ps_fb_profiles.token_enc, ps_pages.page_token_enc). Server-side only.
 * AAD binds ciphertext to the row's user_id — a copied ciphertext fails to decrypt under
 * another user's id, even with the same key.
 * Envelope: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 *
 * Key: derived (HKDF-SHA256) from SUPABASE_SERVICE_ROLE_KEY, which every deployment already
 * has — so users add Facebook tokens purely in the tool, with no extra secret to configure.
 * Trade-off: rotating the service-role key makes stored tokens undecryptable; users then simply
 * re-add their tokens in Page Scheduler → Settings (decryptToken's error message says so).
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
const HKDF_SALT = 'fb-token-encryption';
const HKDF_INFO = 'page-scheduler-v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server');
  cachedKey = Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32));
  return cachedKey;
}

/** Encrypts `plain`, binding it to `userId` via AAD. Returns the packed envelope string. */
export function encryptToken(plain: string, userId: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypts a packed envelope, verifying it was bound to `userId`. Throws on tamper/wrong-user/malformed input. */
export function decryptToken(packed: string, userId: string): string {
  const parts = packed.split(':');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Unsupported token envelope');
  }
  const [, ivB64, tagB64, ctB64] = parts;

  try {
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    throw new Error('Stored token could not be decrypted — re-enter it in Settings');
  }
}
