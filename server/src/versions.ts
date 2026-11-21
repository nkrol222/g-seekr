import type { AddOns } from './store.js';

// Which version of a game a request is for: a region, the English fan translation, the latest revision. The default
// (any region, the release itself) is what every request was before. Matches RetroArr's entry keys: Region and Variant; RetroArr's request API decides which entry is which version.

export const REGIONS = ['USA', 'Europe', 'Japan', 'World', 'Australia', 'Korea', 'China', 'Brazil', 'Asia'] as const;
export const EN_TRANSLATION = 'en-translation';

export interface Version {
  region: string;
  variant: '' | typeof EN_TRANSLATION;
  latestRevision: boolean;
}

export const DEFAULT_VERSION: Version = { region: '', variant: '', latestRevision: false };

// From a request body; null with what's wrong
export function parseVersion(body: { region?: unknown; variant?: unknown; latestRevision?: unknown } | undefined): Version | string {
  const region = typeof body?.region === 'string' ? body.region.trim() : '';
  const known = REGIONS.find((r) => r.toLowerCase() === region.toLowerCase());
  if (region && !known) return `Unknown region “${region}”.`;
  const variant = body?.variant === EN_TRANSLATION ? EN_TRANSLATION : body?.variant == null || body.variant === '' ? '' : null;
  if (variant === null) return 'Unknown version.';
  return { region: known ?? '', variant, latestRevision: body?.latestRevision === true };
}

// "Europe · English translation · latest revision"; '' for the default
export function versionLabel(v: { region: string; variant: string; latestRevision?: boolean }): string {
  return [v.region, v.variant === EN_TRANSLATION ? 'English translation' : '', v.latestRevision ? 'latest revision' : ''].filter(Boolean).join(' · ');
}

// Updates and DLC from a request body: { latestUpdate, allDlc, dlc: [{ igdbId, title }] }; a string says what's wrong
export function parseAddOns(body: { latestUpdate?: unknown; allDlc?: unknown; dlc?: unknown } | undefined): AddOns | string {
  const dlc: AddOns['dlc'] = [];
  if (body?.dlc !== undefined && body.dlc !== null) {
    if (!Array.isArray(body.dlc) || body.dlc.length > 100) return 'dlc: a list of at most 100.';
    for (const d of body.dlc as unknown[]) {
      const o = (typeof d === 'object' && d !== null ? d : {}) as { igdbId?: unknown; title?: unknown };
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      if (!title || title.length > 300) return 'Each DLC needs a name of at most 300 characters.';
      const igdbId = typeof o.igdbId === 'number' && Number.isInteger(o.igdbId) && o.igdbId > 0 ? o.igdbId : null;
      if (!dlc.some((x) => (igdbId !== null ? x.igdbId === igdbId : x.title.toLowerCase() === title.toLowerCase()))) dlc.push({ igdbId, title });
    }
  }
  return { latestUpdate: body?.latestUpdate === true, allDlc: body?.allDlc === true, dlc };
}
