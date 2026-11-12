import { createHash } from 'node:crypto';

export interface JellyfinUser {
  id: string;
  name: string;
  isAdmin: boolean;
}

export class JellyfinAuthError extends Error {}

// Checks a username and password against Jellyfin, the way Seerr does, and returns who it was.
// The Jellyfin session the check opens is closed again: g-seekr keeps its own session.
export class JellyfinClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly version = '0.1.0',
  ) {}

  private header(deviceId: string, token?: string): string {
    const parts = [`Client="g-seekr"`, `Device="g-seekr"`, `DeviceId="${deviceId}"`, `Version="${this.version}"`];
    if (token) parts.push(`Token="${token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  // null for a wrong username or password, or a disabled account; throws when Jellyfin can't be reached
  async authenticate(username: string, password: string): Promise<JellyfinUser | null> {
    const deviceId = 'g-seekr-' + createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 16);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.header(deviceId) },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new JellyfinAuthError(`Jellyfin is not reachable: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new JellyfinAuthError(`Jellyfin answered ${res.status}`);

    const body = (await res.json()) as {
      AccessToken?: string;
      User?: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean } };
    };
    const user = body.User;
    if (!user?.Id || !user.Name) throw new JellyfinAuthError('Jellyfin returned no user');

    if (body.AccessToken) {
      // Best effort; the session expires on Jellyfin's side anyway
      await this.fetchImpl(`${this.baseUrl}/Sessions/Logout`, {
        method: 'POST',
        headers: { Authorization: this.header(deviceId, body.AccessToken) },
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
    if (user.Policy?.IsDisabled) return null;
    return { id: user.Id, name: user.Name, isAdmin: user.Policy?.IsAdministrator === true };
  }
}
