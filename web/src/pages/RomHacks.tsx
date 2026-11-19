import { useEffect, useState } from 'react';
import { api, HACK_KIND_LABEL, STATUS_LABEL, type Platform, type RomHack } from '../api';
import { Alert, Icon, StatusBadge } from './shared';
import { reasonOf } from './ForYou';

// ROM hacks as a list: what each is, the game it patches, and a Request button (or where it's at)
export function HackList({ hacks, onRequested, showGame = true }: { hacks: RomHack[]; onRequested?: () => void; showGame?: boolean }) {
  const [list, setList] = useState(hacks);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setList(hacks), [hacks]);

  const request = async (h: RomHack) => {
    setPending(h.id);
    setError(null);
    setNotice(null);
    try {
      const { request } = await api.requestHack(h.id);
      setList((l) => l.map((x) => (x.id === h.id ? { ...x, status: request.status, requestId: request.id } : x)));
      setNotice(
        `Requested ${h.title}: ${STATUS_LABEL[request.status]}.` +
          (h.baseStatus === 'Downloaded' ? '' : ` ${h.baseTitle} is fetched first, then patched.`),
      );
      onRequested?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <ul className="hack-list">
        {list.map((h) => (
          <li key={h.id} className="hack">
            <div className="hack-head">
              <strong>{h.title}</strong>
              {h.version && <span className="muted"> v{h.version.replace(/^v/i, '')}</span>}
              <span className="badge kind">{HACK_KIND_LABEL[h.kind] ?? h.kind}</span>
            </div>
            <p className="muted small">
              {showGame && h.baseIgdbId ? (
                <a href={`#/game/${h.baseIgdbId}`}>{h.baseTitle}</a>
              ) : showGame ? (
                h.baseTitle
              ) : null}
              {showGame && ' · '}
              {h.platformName}
              {h.year ? ` · ${h.year}` : ''}
              {h.authors.length > 0 ? ` · by ${h.authors.join(', ')}` : ''}
              {h.reasons?.[0] ? ` · ${reasonOf(h.reasons[0])}` : ''}
            </p>
            {h.summary && <p>{h.summary}</p>}
            {h.error && <p className="small error-text">Patching failed: {h.error}</p>}
            <div className="hack-actions">
              {h.status ? (
                <StatusBadge status={h.status} />
              ) : (
                <button type="button" className="btn primary sm" onClick={() => request(h)} disabled={pending !== null}>
                  <Icon name="download" /> {pending === h.id ? 'Requesting…' : 'Request'}
                </button>
              )}
              {h.romhackingId && (
                <a className="btn ghost sm" href={`https://www.romhacking.net/hacks/${h.romhackingId}/`} target="_blank" rel="noreferrer">
                  About it
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// Every ROM hack in the catalogue, by platform and kind
export function RomHacks({ platformParam, kindParam }: { platformParam: number | null; kindParam: string | null }) {
  const [hacks, setHacks] = useState<RomHack[] | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHacks(null);
    api
      .romHacks({ platform: platformParam ?? undefined, kind: kindParam ?? undefined })
      .then((r) => {
        if (cancelled) return;
        setHacks(r.hacks);
        setKinds(r.kinds);
        setError(r.error ?? null);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [platformParam, kindParam]);
  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => setPlatforms([]));
  }, []);

  const go = (platform: number | null, kind: string | null) => {
    const p = new URLSearchParams();
    if (platform) p.set('platform', String(platform));
    if (kind) p.set('kind', kind);
    window.location.hash = `#/romhacks${p.size ? `?${p}` : ''}`;
  };

  return (
    <section className="page">
      <h1>ROM hacks</h1>
      <p className="muted">Fan-made versions of games: improvements, harder modes, new stories. Each is patched from the game itself, so the game comes too if the library doesn’t have it.</p>
      <div className="filters-row">
        <select value={platformParam ?? ''} onChange={(e) => go(Number(e.target.value) || null, kindParam)} aria-label="Platform">
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={kindParam ?? ''} onChange={(e) => go(platformParam, e.target.value || null)} aria-label="Kind">
          <option value="">Every kind</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {HACK_KIND_LABEL[k] ?? k}
            </option>
          ))}
        </select>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {hacks === null ? <p className="muted">Loading…</p> : hacks.length === 0 ? <p className="muted">No ROM hacks here yet.</p> : <HackList hacks={hacks} />}
    </section>
  );
}
