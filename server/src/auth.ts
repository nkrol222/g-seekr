import { createHash, randomBytes } from 'node:crypto';
import type { Store, User } from './store.js';

export const SESSION_COOKIE = 'gseekr_session';
// Required on every state-changing request. A custom header can't be sent cross-site without a
// CORS preflight, which this server never grants, so it blocks CSRF together with SameSite=Lax.
export const CSRF_HEADER = 'x-gseekr';

export const hashSessionId = (id: string): string => createHash('sha256').update(id).digest('hex');

export function newSession(store: Store, user: User, days: number, now = new Date()): { id: string; expires: Date } {
  const id = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + days * 86_400_000);
  store.createSession(hashSessionId(id), user.id, expires);
  return { id, expires };
}

// Failed sign-ins per client address and per username, so neither a single client nor a spread
// of clients can guess one account's password at speed. Successful sign-ins don't count.
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxPerAddress = 10,
    private readonly maxPerUser = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  blocked(address: string, username: string): boolean {
    return this.recent(`a:${address}`).length >= this.maxPerAddress || this.recent(`u:${username.toLowerCase()}`).length >= this.maxPerUser;
  }

  fail(address: string, username: string): void {
    const t = this.now();
    for (const key of [`a:${address}`, `u:${username.toLowerCase()}`]) this.failures.set(key, [...this.recent(key), t]);
  }
}
