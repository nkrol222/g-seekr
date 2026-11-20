import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, REASON_VERB, type Reason, type Recommendations, type Recommended, type RommStatus } from '../api';
import { FilterButton, FilterPanel, useFilters } from './Filters';
import { Alert, Icon } from './shared';
import { TitleCard } from './Titles';
import { HackList } from './RomHacks';

// "Because you played Super Metroid"
export const reasonOf = (r: Reason) => `because you ${REASON_VERB[r.kind]} ${r.title}`;

// "Because you played Chrono Trigger" (and liked, and requested), the first one or two reasons
export function reasonText(r: Recommended): string {
  const [first, second] = r.reasons;
  if (!first) return '';
  return `Because you ${REASON_VERB[first.kind]} ${first.title}${second ? ` and ${second.title}` : ''}`;
}

// The user's recommendations, shared by the For you page and Discover; "Not interested" takes a game out at once
export function useRecommendations() {
  const [recs, setRecs] = useState<Recommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .recommendations()
      .then(setRecs)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);
  const dismiss = async (igdbId: number) => {
    // Its title, so Settings → Recommendations can list it
    const title = recs?.games.find((g) => g.igdbId === igdbId)?.title ?? recs?.because.flatMap((b) => b.games).find((g) => g.igdbId === igdbId)?.title ?? '';
    setRecs((r) =>
      r ? { ...r, games: r.games.filter((g) => g.igdbId !== igdbId), because: r.because.map((b) => ({ ...b, games: b.games.filter((g) => g.igdbId !== igdbId) })) } : r,
    );
    await api.dismiss(igdbId, true, title).catch(() => undefined);
  };
  return { recs, error, reload: load, dismiss };
}

export function ForYou() {
  const { recs, error, reload, dismiss } = useRecommendations();
  const { filters, apply } = useFilters();
  const [platforms, setPlatforms] = useState<Awaited<ReturnType<typeof api.platforms>>>([]);
  const [panel, setPanel] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => undefined);
  }, []);

  return (
    <>
      <div className="page-title">
        <h1>Recommended for you</h1>
        <div className="tools">
          <FilterButton filters={filters} onClick={() => setPanel(true)} />
        </div>
      </div>
      <p className="muted lead">
        Picked from the games you requested, liked{recs?.romm.linked ? ' and played in RomM' : ''}, and IGDB’s similar games and series. Mark a game “not interested” to never see it here again.
      </p>
      {recs?.romm.available && !recs.romm.linked && (
        <Alert kind="info">
          <span>
            Link your RomM account to get picks based on what you actually play.{' '}
            <button type="button" className="btn primary sm" onClick={() => setLinking(true)}>
              Link RomM
            </button>
          </span>
        </Alert>
      )}
      {recs?.romm.error && <Alert kind="error">Couldn’t read your RomM history: {recs.romm.error}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!recs && !error && (
        <div className="grid" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="title-card skeleton" aria-hidden="true" />
          ))}
        </div>
      )}
      {recs && recs.games.length === 0 && (
        <p className="empty">
          {recs.basedOn === 0
            ? 'Nothing to go on yet. Request or like a few games (the ♥ on a game’s page) and recommendations appear here.'
            : 'Nothing new to recommend with these filters.'}
        </p>
      )}
      {recs && recs.games.length > 0 && (
        <div className="grid rec-grid">
          {recs.games.map((g) => (
            <TitleCard key={g.igdbId} game={g} reason={reasonText(g)} onDismiss={() => void dismiss(g.igdbId)} />
          ))}
        </div>
      )}
      {recs?.hacks && recs.hacks.length > 0 && (
        <section>
          <h2>ROM hacks of games you played</h2>
          <HackList hacks={recs.hacks} />
          <p className="muted small">
            <a href="#/romhacks">Every ROM hack</a>
          </p>
        </section>
      )}
      {panel && filters && (
        <FilterPanel
          filters={filters}
          platforms={platforms}
          onApply={(f) => {
            void apply(f).then(reload);
          }}
          onClose={() => setPanel(false)}
        />
      )}
      {linking && <RommLinkDialog onClose={() => setLinking(false)} onChanged={reload} />}
    </>
  );
}

// Linking RomM: the user makes a client token in RomM and pastes it here. It only reads.
export function RommLinkDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<RommStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .romm()
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.linkRomm(token));
      setToken('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      setStatus(await api.unlinkRomm());
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal dialog" role="dialog" aria-modal="true" aria-labelledby="romm-title" onSubmit={submit}>
        <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="dialog-body">
          <h2 id="romm-title">Link RomM</h2>
          {status && !status.available && <p className="muted">Linking RomM isn’t set up on this server.</p>}
          {status?.linked ? (
            <>
              <p className="muted">
                Linked to RomM user <strong>{status.rommUsername}</strong>. Your play history and ratings shape your recommendations.
              </p>
              {status.error && <Alert kind="error">{status.error}</Alert>}
              <div className="dialog-actions">
                <button type="button" className="btn danger" onClick={unlink} disabled={busy}>
                  Unlink
                </button>
              </div>
            </>
          ) : (
            status?.available && (
              <>
                <ol className="steps">
                  <li>
                    Open{' '}
                    {status.rommUrl ? (
                      <a href={status.rommUrl} target="_blank" rel="noreferrer">
                        RomM
                      </a>
                    ) : (
                      'RomM'
                    )}{' '}
                    → your avatar → <strong>Settings → Client API Tokens</strong>.
                  </li>
                  <li>
                    Create a token named <code>g-seekr</code> with only <strong>View your profile</strong> and <strong>View ROMs</strong> (and <strong>View user-rom properties</strong> if listed).
                  </li>
                  <li>Copy it and paste it below. g-seekr only reads what you played and how you rated it.</li>
                </ol>
                <label className="field">
                  Client token
                  <input className="input" type="password" autoComplete="off" placeholder="rmm_…" value={token} onChange={(e) => setToken(e.target.value)} required />
                </label>
                {error && <Alert kind="error">{error}</Alert>}
                <div className="dialog-actions">
                  <button type="button" className="btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={busy || !token.trim()}>
                    {busy ? 'Checking…' : 'Link'}
                  </button>
                </div>
              </>
            )
          )}
          {error && status?.linked && <Alert kind="error">{error}</Alert>}
        </div>
      </form>
    </div>
  );
}
