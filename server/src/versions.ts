// Which version of a game a request is for: a region, the English fan translation, the latest revision. The default
// (any region, the release itself) is what every request was before. Matches RetroArr's entry keys: Region and Variant.

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

// Whether a library entry (RetroArr's region and variant) is the version asked for. Any region: any entry of the
// variant. A region: an entry of it ("USA, Europe" has both).
export function entryMatches(v: Pick<Version, 'region' | 'variant'>, entry: { region?: string | null; variant?: string | null }): boolean {
  if ((entry.variant ?? '') !== v.variant) return false;
  if (!v.region) return true;
  return (entry.region ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .some((r) => r === v.region.toLowerCase() || (v.region === 'USA' && (r === 'us' || r === 'north america')));
}
