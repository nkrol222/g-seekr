// Turning an imported list (pasted titles, a No-Intro / Redump DAT, an Internet Archive item's files) into game
// titles to find on IGDB. ROM names carry more than the title: "Legend of Zelda, The - A Link to the Past (USA)
// (Rev 1).sfc" is "The Legend of Zelda - A Link to the Past".

export interface ImportTitle {
  // What the list said (the first one, when several regions or discs clean up to the same title)
  raw: string;
  title: string;
}

// Extensions a list's entries end in: ROMs, disc images, archives
const EXTENSION = /\.(zip|7z|rar|gz|sfc|smc|nes|fds|gb|gbc|gba|n64|z64|v64|nds|3ds|cia|cci|nsp|xci|nsz|gcm|iso|cso|chd|rvz|wbfs|wud|wux|bin|cue|gdi|cdi|img|mdf|pbp|md|smd|gen|32x|sms|gg|pce|ngp|ngc|ws|wsc|a26|a52|a78|lnx|j64|vb|vpk|adf|d64|t64|tzx|dsk|xex|pkg)$/i;

// Files in an Internet Archive item that are never games
const NOT_A_GAME = /(_meta\.(xml|sqlite)|_files\.xml|_reviews\.xml|\.torrent|\.(xml|sqlite|txt|nfo|md|pdf|jpg|jpeg|png|gif|webp|json|sfv|md5|sha1|dat|log|htm|html)|__ia_thumb\.jpg)$/i;

export function cleanTitle(raw: string): string {
  let t = raw.replace(/^.*[\\/]/, '').replace(/_/g, ' ').trim();
  // "name.sfc.zip": both extensions go
  for (let i = 0; i < 3 && EXTENSION.test(t); i++) t = t.replace(EXTENSION, '');
  // Tags in parentheses and brackets: regions, languages, revisions, discs, dump flags
  t = t.replace(/\s*[[(][^\])]*[\])]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // "Legend of Zelda, The - A Link to the Past" and "Super Mario Bros., The"
  t = t.replace(/^(.+?), (The|A|An)(\s+-\s+.+|:.+)?$/i, (_m, head: string, article: string, rest = '') => `${article} ${head}${rest}`);
  return t.replace(/[\s.-]+$/, '').trim();
}

function unique(raws: string[]): ImportTitle[] {
  const seen = new Set<string>();
  const out: ImportTitle[] = [];
  for (const raw of raws) {
    const title = cleanTitle(raw);
    const key = title.toLowerCase();
    if (title.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: raw.trim(), title });
  }
  return out;
}

// One title per line; blank lines and # comments are skipped
export function parseTitles(text: string): ImportTitle[] {
  return unique(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// A No-Intro or Redump DAT (Logiqx XML): every <game name="…"> (or MAME's <machine name="…">)
export function parseDat(xml: string): ImportTitle[] {
  const names: string[] = [];
  for (const m of xml.matchAll(/<(?:game|machine)\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    names.push(decode(m[1] ?? m[2] ?? ''));
  }
  // BIOS and system entries aren't games
  return unique(names.filter((n) => !/^\[BIOS\]|\(BIOS\)|\bBIOS\b/i.test(n)));
}

// An Internet Archive item id, from the id itself or any archive.org URL of it
export function archiveItemId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/archive\.org\/(?:details|download|metadata)\/([^/?#\s]+)/i);
  const id = m ? decodeURIComponent(m[1]!) : s;
  return /^[A-Za-z0-9._-]{1,100}$/.test(id) ? id : null;
}

// The games in an Internet Archive item: its files (from archive.org's metadata), minus metadata and images
export function parseArchiveFiles(files: { name?: unknown; source?: unknown }[]): ImportTitle[] {
  return unique(
    files
      .filter((f) => typeof f.name === 'string' && f.source !== 'metadata')
      .map((f) => f.name as string)
      .filter((n) => !NOT_A_GAME.test(n)),
  );
}
