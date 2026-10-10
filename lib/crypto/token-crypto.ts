/**
 * AES-256-GCM envelope for the AFS ads-launching token (afs_launch_tokens.token_enc).
 * Server-side only. AAD binds ciphertext to the row's user_id — a copied ciphertext
 * fails to decrypt under another user's id, even with the same key.
 * Envelope: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGO = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';

function getKey(): Buffer {
  const raw = process.env.AFS_TOKEN_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('AFS_TOKEN_ENCRYPTION_KEY missing or not 32 bytes (base64)');
  }
  return key;
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
