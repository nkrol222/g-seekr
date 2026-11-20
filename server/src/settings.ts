import type { Config } from './config.js';
import type { Store } from './store.js';

// Server settings an admin can change in Settings, saved in the database. The environment (homelab-iac's env file)
// gives each one its first value; once an admin saves one, the saved value wins until it is reset. Secrets and how
// the server is deployed (the RetroArr token, the IGDB credentials, the session secret, ports, proxies) stay in the
// environment only: Settings shows whether they are set and can test the connections.

export type SettingKey =
  | 'publicUrl'
  | 'rommUrl'
  | 'rommApiUrl'
  | 'sessionDays'
  | 'requestLimit'
  | 'requestLimitDays'
  | 'jellyfinAdminsAreAdmins'
  | 'discordWebhookUrl';

type Kind = 'url' | 'int' | 'bool' | 'secret-url';

interface Def {
  key: SettingKey;
  env: string;
  kind: Kind;
  group: 'general' | 'requests' | 'notifications';
  min?: number;
  max?: number;
}

export const SETTINGS: readonly Def[] = [
  { key: 'publicUrl', env: 'PUBLIC_URL', kind: 'url', group: 'general' },
  { key: 'rommUrl', env: 'ROMM_URL', kind: 'url', group: 'general' },
  { key: 'rommApiUrl', env: 'ROMM_API_URL', kind: 'url', group: 'general' },
  { key: 'sessionDays', env: 'SESSION_DAYS', kind: 'int', group: 'general', min: 1, max: 365 },
  { key: 'requestLimit', env: 'REQUEST_LIMIT', kind: 'int', group: 'requests', min: 0, max: 1000 },
  { key: 'requestLimitDays', env: 'REQUEST_LIMIT_DAYS', kind: 'int', group: 'requests', min: 1, max: 365 },
  { key: 'jellyfinAdminsAreAdmins', env: 'JELLYFIN_ADMINS_ARE_ADMINS', kind: 'bool', group: 'requests' },
  { key: 'discordWebhookUrl', env: 'DISCORD_WEBHOOK_URL', kind: 'secret-url', group: 'notifications' },
];

type Value = string | number | boolean | null;

export interface SettingView {
  key: SettingKey;
  group: Def['group'];
  kind: Kind;
  // A secret's value is never sent: `set` says whether it has one
  value: Value;
  set: boolean;
  // saved: changed in Settings; env: from the environment; default: neither
  source: 'saved' | 'env' | 'default';
  min?: number;
  max?: number;
}

export class SettingsError extends Error {}

export class SettingsService {
  // Each setting's value before anything saved was applied: what a reset goes back to
  private readonly base: Record<SettingKey, Value>;
  private readonly saved = new Set<SettingKey>();

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly onChange: (key: SettingKey) => void = () => undefined,
  ) {
    this.base = Object.fromEntries(SETTINGS.map((d) => [d.key, config[d.key] as Value])) as Record<SettingKey, Value>;
    for (const [key, raw] of this.store.savedSettings()) {
      const def = SETTINGS.find((d) => d.key === key);
      if (!def) continue;
      try {
        this.apply(def, JSON.parse(raw) as Value);
        this.saved.add(def.key);
      } catch {
        // A row that no longer parses is ignored; the environment's value stays
      }
    }
  }

  list(): SettingView[] {
    return SETTINGS.map((d) => {
      const value = this.config[d.key] as Value;
      return {
        key: d.key,
        group: d.group,
        kind: d.kind,
        value: d.kind === 'secret-url' ? null : value,
        set: value !== null && value !== '',
        source: this.saved.has(d.key) ? 'saved' : this.env[d.env]?.trim() ? 'env' : 'default',
        ...(d.min !== undefined ? { min: d.min } : {}),
        ...(d.max !== undefined ? { max: d.max } : {}),
      };
    });
  }

  // patch: { key: value } to save, { key: null } to go back to the environment's value. Validates every key first,
  // so a bad one changes nothing.
  update(patch: Record<string, unknown>, by: number | null): SettingView[] {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('Send the settings to change.');
    const changes: { def: Def; value: Value | undefined }[] = [];
    for (const [key, raw] of Object.entries(patch)) {
      const def = SETTINGS.find((d) => d.key === key);
      if (!def) throw new SettingsError(`${key} isn't a setting that can be changed here.`);
      changes.push({ def, value: raw === null ? undefined : this.validate(def, raw) });
    }
    for (const { def, value } of changes) {
      if (value === undefined) {
        this.store.saveSetting(def.key, null, by);
        this.saved.delete(def.key);
        this.apply(def, this.base[def.key]);
      } else {
        this.store.saveSetting(def.key, JSON.stringify(value), by);
        this.saved.add(def.key);
        this.apply(def, value);
      }
      this.onChange(def.key);
    }
    return this.list();
  }

  // An emptied URL turns the feature off (null), even when the environment sets one
  private apply(def: Def, value: Value): void {
    (this.config as unknown as Record<string, Value>)[def.key] = value === '' ? null : value;
  }

  private validate(def: Def, raw: unknown): Value {
    switch (def.kind) {
      case 'bool':
        if (typeof raw !== 'boolean') throw new SettingsError(`${def.key} must be true or false.`);
        return raw;
      case 'int': {
        const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < (def.min ?? 0) || n > (def.max ?? Number.MAX_SAFE_INTEGER))
          throw new SettingsError(`${def.key} must be a whole number from ${def.min ?? 0} to ${def.max}.`);
        return n;
      }
      default: {
        if (typeof raw !== 'string') throw new SettingsError(`${def.key} must be a URL.`);
        const text = raw.trim();
        if (text === '') return '';
        let url: URL;
        try {
          url = new URL(text);
        } catch {
          throw new SettingsError(`${def.key} must be a full URL (https://…).`);
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SettingsError(`${def.key} must be an http(s) URL.`);
        if (def.kind === 'secret-url' && url.protocol !== 'https:') throw new SettingsError('The Discord webhook must be an https URL.');
        if (url.username || url.password) throw new SettingsError(`${def.key} must not carry a username or password.`);
        return text.replace(/\/+$/, '');
      }
    }
  }
}
