// All settings come from the environment (see .env.example). loadConfig fails fast, naming
// every missing or malformed variable at once.

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  jellyfinUrl: string;
  retroarrUrl: string;
  retroarrToken: string;
  // Where people play; "available" requests link here. Optional.
  rommUrl: string | null;
  discordWebhookUrl: string | null;
  // The app's own public origin (https://games.example.com). When set, state-changing requests
  // from any other Origin are refused.
  publicUrl: string | null;
  secureCookies: boolean;
  // Fastify's trustProxy: true, false, a hop count or a comma-separated list of addresses/CIDRs
  trustProxy: boolean | number | string;
  jellyfinAdminsAreAdmins: boolean;
  // Requests per user per window; 0 = unlimited. Admins are never limited.
  requestLimit: number;
  requestLimitDays: number;
  // RetroArr platform slugs people may request for; null = every platform RetroArr has enabled
  allowedPlatforms: string[] | null;
  pollSeconds: number;
  sessionDays: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const str = (name: string, fallback?: string): string => {
    const v = env[name]?.trim();
    if (v) return v;
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is required`);
    return '';
  };
  const optional = (name: string): string | null => env[name]?.trim() || null;
  const url = (name: string, required: boolean): string | null => {
    const v = required ? str(name) : optional(name);
    if (!v) return null;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
      return v.replace(/\/+$/, '');
    } catch {
      problems.push(`${name} must be an http(s) URL`);
      return null;
    }
  };
  const int = (name: string, fallback: number, min: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
      problems.push(`${name} must be an integer >= ${min}`);
      return fallback;
    }
    return n;
  };
  const bool = (name: string, fallback: boolean): boolean => {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    problems.push(`${name} must be true or false`);
    return fallback;
  };
  const trustProxy = (): boolean | number | string => {
    const raw = env.TRUST_PROXY?.trim();
    if (!raw) return 'loopback';
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
  };

  const allowed = optional('ALLOWED_PLATFORMS');
  const config: Config = {
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 5056, 1),
    dataDir: str('DATA_DIR', '/data'),
    jellyfinUrl: url('JELLYFIN_URL', true) ?? '',
    retroarrUrl: url('RETROARR_URL', true) ?? '',
    retroarrToken: str('RETROARR_TOKEN'),
    rommUrl: url('ROMM_URL', false),
    discordWebhookUrl: url('DISCORD_WEBHOOK_URL', false),
    publicUrl: url('PUBLIC_URL', false),
    secureCookies: bool('SECURE_COOKIES', true),
    trustProxy: trustProxy(),
    jellyfinAdminsAreAdmins: bool('JELLYFIN_ADMINS_ARE_ADMINS', true),
    requestLimit: int('REQUEST_LIMIT', 10, 0),
    requestLimitDays: int('REQUEST_LIMIT_DAYS', 7, 1),
    allowedPlatforms: allowed ? allowed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null,
    pollSeconds: int('POLL_SECONDS', 300, 15),
    sessionDays: int('SESSION_DAYS', 30, 1),
  };

  if (config.retroarrToken && !config.retroarrToken.startsWith('rat_')) {
    problems.push('RETROARR_TOKEN must be a RetroArr API token (rat_…) with the requests scope, not the instance API key');
  }
  if (problems.length > 0) throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  return config;
}
