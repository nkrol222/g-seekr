import { useCallback, useEffect, useState } from 'react';
import { api, type GameRequest, type Me, type RequestStatus } from '../api';
import { ago, Alert, Avatar, Icon, Poster, rommLink, StatusBadge, statusDetail, when } from './shared';

export type Filter = 'all' | 'open' | 'pending' | 'processing' | 'available' | 'failed' | 'declined';

const FILTERS: { id: Filter; label: string; match: (s: RequestStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'open', label: 'Needs attention', match: (s) => s === 'pending' || s === 'failed' },
  { id: 'pending', label: 'Pending', match: (s) => s === 'pending' },
  { id: 'processing', label: 'Processing', match: (s) => s === 'approved' || s === 'searching' || s === 'downloading' },
  { id: 'available', label: 'Available', match: (s) => s === 'available' },
  { id: 'failed', label: 'Failed', match: (s) => s === 'failed' },
  { id: 'declined', label: 'Declined', match: (s) => s === 'declined' },
];

export const isFilter = (v: string | null): v is Filter => FILTERS.some((f) => f.id === v);

// Seerr's Requests page: one card per request, newest first, with a filter and a sort. Admins see everyone's
// and can act on them; everyone else sees their own.
export function Requests({ me, filter, onChanged }: { me: Me; filter: Filter; onChanged: () => void }) {
  const admin = me.user.isAdmin;
  const [requests, setRequests] = useState<GameRequest[] | null>(null);
  const [sort, setSort] = useState<'added' | 'modified'>('added');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests((await api.requests(admin ? 'all' : 'mine')).requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (r: GameRequest, action: 'approve' | 'decline' | 'retry' | 'remove') => {
    const question =
      action === 'remove'
        ? admin && r.userId !== me.user.id
          ? `Remove ${r.username}’s request for ${r.title}? RetroArr keeps the game.`
          : `Withdraw your request for ${r.title}?`
        : null;
    if (question && !window.confirm(question)) return;
    setBusy(r.id);
    setError(null);
    try {
      const note = notes[r.id]?.trim() || undefined;
      if (action === 'approve') await api.approve(r.id, note);
      else if (action === 'decline') await api.decline(r.id, note);
      else if (action === 'retry') await api.retry(r.id);
      else await api.remove(r.id);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const match = FILTERS.find((f) => f.id === filter)!.match;
  const shown = (requests ?? [])
    .filter((r) => match(r.status))
    .sort((a, b) => (sort === 'added' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));

  return (
    <>
      <div className="page-title">
        <h1>{admin ? 'Requests' : 'My requests'}</h1>
        <div className="tools">
          <label className="sr-only" htmlFor="req-filter">
            Filter
          </label>
          <select
            id="req-filter"
            className="select"
            value={filter}
            onChange={(e) => {
              window.location.hash = `#/requests?filter=${e.target.value}`;
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="req-sort">
            Sort
          </label>
          <select id="req-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as 'added' | 'modified')}>
            <option value="added">Request date</option>
            <option value="modified">Last modified</option>
          </select>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {requests && shown.length === 0 && <p className="empty">{requests.length === 0 ? 'No requests yet. Find a game with the search above.' : 'No requests match this filter.'}</p>}
      <div className="request-list">
        {shown.map((r) => {
          const play = rommLink(me.rommUrl, r);
          const detail = statusDetail(r);
          const mine = r.userId === me.user.id;
          return (
            <article key={r.id} className="request-card" aria-label={`${r.title} for ${r.platformName}`}>
              {r.coverUrl && (
                <div className="bg" aria-hidden="true">
                  <img src={r.coverUrl} alt="" referrerPolicy="no-referrer" />
                </div>
              )}
              <div className="poster">
                <Poster url={r.coverUrl} title={r.title} />
              </div>
              <div className="main-col">
                <span className="meta">
                  {r.year ?? ''} {r.year ? '·' : ''} {r.platformName}
                </span>
                <h3>{r.title}</h3>
                <dl className="facts">
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={r.status} />
                  </dd>
                  {detail && (
                    <>
                      <dt>Release</dt>
                      <dd className="release" title={detail}>
                        {detail}
                      </dd>
                    </>
                  )}
                  <dt>Requested</dt>
                  <dd title={when(r.createdAt)}>
                    {ago(r.createdAt)}
                    {admin && (
                      <>
                        {' '}
                        by <Avatar name={r.username} small /> {r.username}
                      </>
                    )}
                  </dd>
                  {r.updatedAt !== r.createdAt && (
                    <>
                      <dt>Modified</dt>
                      <dd title={when(r.updatedAt)}>{ago(r.updatedAt)}</dd>
                    </>
                  )}
                </dl>
                {r.error && <p className="err">{r.error}</p>}
                {r.note && <p className="note">Note: {r.note}</p>}
              </div>
              <div className="side">
                {admin && r.status === 'pending' && (
                  <>
                    <input
                      className="input"
                      placeholder="Note for the requester"
                      aria-label={`Note for ${r.username}`}
                      value={notes[r.id] ?? ''}
                      maxLength={500}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    />
                    <button type="button" className="btn success" disabled={busy === r.id} onClick={() => act(r, 'approve')}>
                      <Icon name="check" /> Approve
                    </button>
                    <button type="button" className="btn danger" disabled={busy === r.id} onClick={() => act(r, 'decline')}>
                      <Icon name="x" /> Decline
                    </button>
                  </>
                )}
                {admin && r.status === 'failed' && (
                  <button type="button" className="btn primary" disabled={busy === r.id} onClick={() => act(r, 'retry')}>
                    <Icon name="refresh" /> Retry
                  </button>
                )}
                {play && (
                  <a className="btn primary" href={play} target="_blank" rel="noreferrer">
                    <Icon name="play" /> Play in RomM
                  </a>
                )}
                {(admin || (mine && r.status === 'pending')) && (
                  <button type="button" className="btn" disabled={busy === r.id} onClick={() => act(r, 'remove')}>
                    <Icon name="trash" /> {admin && !mine ? 'Remove' : 'Withdraw'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
