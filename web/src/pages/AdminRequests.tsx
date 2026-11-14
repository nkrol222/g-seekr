import { useCallback, useEffect, useState } from 'react';
import { api, type GameRequest, type Me, type RequestStatus } from '../api';
import { Cover, rommLink, StatusBadge, when } from './shared';

const FILTERS: { id: 'open' | 'all' | RequestStatus; label: string }[] = [
  { id: 'open', label: 'Needs attention' },
  { id: 'all', label: 'All' },
  { id: 'searching', label: 'Searching' },
  { id: 'available', label: 'Ready' },
  { id: 'declined', label: 'Declined' },
];

export function AdminRequests({ me }: { me: Me }) {
  const [requests, setRequests] = useState<GameRequest[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests((await api.requests('all')).requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (r: GameRequest, action: 'approve' | 'decline' | 'retry' | 'remove') => {
    if (action === 'remove' && !window.confirm(`Remove ${r.username}’s request for ${r.title}? RetroArr keeps the game.`)) return;
    setBusy(r.id);
    setError(null);
    try {
      const note = notes[r.id]?.trim() || undefined;
      if (action === 'approve') await api.approve(r.id, note);
      else if (action === 'decline') await api.decline(r.id, note);
      else if (action === 'retry') await api.retry(r.id);
      else await api.remove(r.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shown = (requests ?? []).filter((r) =>
    filter === 'all' ? true : filter === 'open' ? r.status === 'pending' || r.status === 'failed' : filter === r.status,
  );

  return (
    <section>
      <h2>All requests</h2>
      <div className="filters" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'active' : undefined} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {requests && shown.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="requests">
        {shown.map((r) => {
          const play = rommLink(me.rommUrl, r);
          return (
            <li key={r.id} className="card request">
              <Cover url={r.coverUrl} title={r.title} />
              <div className="body">
                <h3>
                  {r.title} {r.year && <span className="muted">({r.year})</span>}
                </h3>
                <p className="muted small">
                  {r.platformName} · {r.username} · {when(r.createdAt)}
                </p>
                <StatusBadge request={r} />
                {r.status === 'downloading' && r.release && <p className="muted small">Downloading {r.release}</p>}
                {r.error && <p className="error small">{r.error}</p>}
                {r.note && <p className="small">Note: {r.note}</p>}
                {r.status === 'pending' && (
                  <input
                    className="note"
                    placeholder="Note for the requester (optional)"
                    value={notes[r.id] ?? ''}
                    maxLength={500}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                )}
                <div className="actions">
                  {r.status === 'pending' && (
                    <>
                      <button type="button" className="primary" disabled={busy === r.id} onClick={() => act(r, 'approve')}>
                        Approve
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => act(r, 'decline')}>
                        Decline
                      </button>
                    </>
                  )}
                  {r.status === 'failed' && (
                    <button type="button" className="primary" disabled={busy === r.id} onClick={() => act(r, 'retry')}>
                      Retry
                    </button>
                  )}
                  {play && (
                    <a className="button" href={play} target="_blank" rel="noreferrer">
                      Open in RomM
                    </a>
                  )}
                  <button type="button" className="danger" disabled={busy === r.id} onClick={() => act(r, 'remove')}>
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
