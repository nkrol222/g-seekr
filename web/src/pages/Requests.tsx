import { useCallback, useEffect, useState } from 'react';
import { api, ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, type GameRequest, type Issue, type Me, type RequestStatus, versionLabel } from '../api';
import { ProgressBar, ReportDialog, useProgress } from './Live';
import { ago, Alert, Avatar, Icon, Poster, rommLink, StatusBadge, statusDetail, when } from './shared';
import { RequestTimeline, StepLine } from './Timeline';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [reporting, setReporting] = useState<GameRequest | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const scope = admin ? 'all' : 'mine';

  const load = useCallback(async () => {
    try {
      const [r, i] = await Promise.all([api.requests(scope, true), api.issues(scope)]);
      setRequests(r.requests);
      setIssues(i.issues);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // The report a request has open, if any
  const unresolved = new Map(issues.filter((i) => i.status !== 'resolved').map((i) => [i.requestId, i]));
  const inFlight = (requests ?? []).some((r) => r.status === 'searching' || r.status === 'downloading') || issues.some((i) => i.status === 'replacing');
  const { byGame, error: progressError } = useProgress(scope, inFlight);

  // While something is in flight, statuses change from RetroArr's webhooks: reload every 30 s
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => !document.hidden && void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

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
      {notice && <Alert kind="success">{notice}</Alert>}
      {progressError && <Alert kind="info">{progressError}</Alert>}
      {requests && shown.length === 0 && <p className="empty">{requests.length === 0 ? 'No requests yet. Find a game with the search above.' : 'No requests match this filter.'}</p>}
      <div className="request-list">
        {shown.map((r) => {
          const play = rommLink(me.rommUrl, r);
          const detail = statusDetail(r);
          const mine = r.userId === me.user.id;
          const issue = unresolved.get(r.id);
          const live = r.retroarrGameId !== null && (r.status === 'searching' || r.status === 'downloading' || issue?.status === 'replacing') ? byGame.get(r.retroarrGameId) : undefined;
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
                  {versionLabel(r) && <span className="version-tag"> · {versionLabel(r)}</span>}
                </span>
                <h3>{r.title}</h3>
                <dl className="facts">
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={r.status} />
                  </dd>
                  {r.now && r.now.key !== 'requested' && !(r.now.key === 'romm' && r.now.state === 'done') && (
                    <>
                      <dt>Now</dt>
                      <dd>
                        <StepLine step={r.now} admin={admin} />
                      </dd>
                    </>
                  )}
                  {live && (
                    <>
                      <dt>{issue?.status === 'replacing' ? 'Replacement' : 'Progress'}</dt>
                      <dd className="live">
                        <ProgressBar p={live} />
                      </dd>
                    </>
                  )}
                  {issue && (
                    <>
                      <dt>Problem</dt>
                      <dd>
                        <a className={`badge issue-${issue.status}`} href="#/issues">
                          {ISSUE_KIND_LABEL[issue.kind]} · {ISSUE_STATUS_LABEL[issue.status]}
                        </a>
                      </dd>
                    </>
                  )}
                  {admin && detail && !live && (
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
                {admin && r.error && <p className="err">{r.error}</p>}
                {r.note && <p className="note">Note: {r.note}</p>}
                <button type="button" className="link-button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <Icon name="clock" /> {open === r.id ? 'Hide details' : 'Details'}
                </button>
                {open === r.id && <RequestTimeline requestId={r.id} admin={admin} live={live} />}
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
                {r.status === 'available' && !issue && (mine || admin) && (
                  <button type="button" className="btn" onClick={() => setReporting(r)}>
                    <Icon name="flag" /> Report a problem
                  </button>
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
      {reporting && (
        <ReportDialog
          request={reporting}
          onClose={() => setReporting(null)}
          onReported={(issue) => {
            setReporting(null);
            setNotice(`Thanks, the problem with ${issue.title} is reported. You’ll see what happens on the Issues page.`);
            void load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
