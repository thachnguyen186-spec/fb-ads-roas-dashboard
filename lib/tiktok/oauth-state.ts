/** Shared CSRF state-cookie name for the TikTok OAuth connect flow (start ↔ callback). */
export const TIKTOK_OAUTH_STATE_COOKIE = 'tiktok_oauth_state';

/** Cookie value binds the nonce to the app user who started the flow. */
export function buildOauthStateCookie(userId: string, nonce: string): string {
  return `${userId}:${nonce}`;
}

/** True only if the cookie exists and equals `${userId}:${state}` (rejects a different user's flow). */
export function matchesOauthState(cookie: string | undefined, userId: string, state: string | null): boolean {
  if (!cookie || !state) return false;
  return cookie === buildOauthStateCookie(userId, state);
}
