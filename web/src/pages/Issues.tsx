import { useCallback, useEffect, useState } from 'react';
import { api, ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, type Issue, type IssueStatus, type Me } from '../api';
import { ProgressBar, useProgress } from './Live';
import { ago, Alert, Avatar, Icon, Poster, when } from './shared';

type Filter = 'unresolved' | IssueStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'unresolved', label: 'Unresolved' },
  { id: 'open', label: 'Open' },
  { id: 'replacing', label: 'Being replaced' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

// Seerr's Issues page: problems reported with games that are ready to play. An admin replaces the release (RetroArr
// blocklists it and grabs another) or resolves the report with a note.
export function Issues({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const admin = me.user.isAdmin;
  const scope = admin ? 'all' : 'mine';
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<Filter>('unresolved');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIssues((await api.issues(scope)).issues);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const replacing = (issues ?? []).some((i) => i.status === 'replacing');
  const { byGame } = useProgress(scope, replacing);
  useEffect(() => {
    if (!replacing) return;
    const timer = window.setInterval(() => !document.hidden && void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [replacing, load]);

  const act = async (issue: Issue, action: 'replace' | 'resolve') => {
    if (action === 'replace' && !window.confirm(`Blocklist the release of ${issue.title} in RetroArr and grab another? The current one stays until the new one is in.`)) return;
    setBusy(issue.id);
    setError(null);
    try {
      if (action === 'replace') await api.replaceIssue(issue.id);
      else await api.resolveIssue(issue.id, notes[issue.id]?.trim() || undefined);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const shown = (issues ?? []).filter((i) => (filter === 'all' ? true : filter === 'unresolved' ? i.status !== 'resolved' : i.status === filter));

  return (
    <>
      <div className="page-title">
        <h1>{admin ? 'Issues' : 'My reported problems'}</h1>
        <div className="tools">
          <label className="sr-only" htmlFor="issue-filter">
            Filter
          </label>
          <select id="issue-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {issues && shown.length === 0 && (
        <p className="empty">{issues.length === 0 ? 'No problems reported. Report one from a game that’s ready to play, on the Requests page.' : 'Nothing matches this filter.'}</p>
      )}
      <div className="request-list">
        {shown.map((i) => {
          const live = i.status === 'replacing' && i.retroarrGameId !== null ? byGame.get(i.retroarrGameId) : undefined;
          return (
            <article key={i.id} className="request-card" aria-label={`${ISSUE_KIND_LABEL[i.kind]}: ${i.title}`}>
              {i.coverUrl && (
                <div className="bg" aria-hidden="true">
                  <img src={i.coverUrl} alt="" referrerPolicy="no-referrer" />
                </div>
              )}
              <div className="poster">
                <Poster url={i.coverUrl} title={i.title} />
              </div>
              <div className="main-col">
                <span className="meta">
                  {i.year ?? ''} {i.year ? '·' : ''} {i.platformName}
                </span>
                <h3>{i.title}</h3>
                <dl className="facts">
                  <dt>Problem</dt>
                  <dd>
                    <span className={`badge issue-${i.status}`}>{ISSUE_STATUS_LABEL[i.status]}</span> {ISSUE_KIND_LABEL[i.kind]}
                  </dd>
                  {i.message && (
                    <>
                      <dt>Details</dt>
                      <dd className="release" title={i.message}>
                        {i.message}
                      </dd>
                    </>
                  )}
                  {i.release && (
                    <>
                      <dt>Release</dt>
                      <dd className="release" title={i.release}>
                        {i.release}
                      </dd>
                    </>
                  )}
                  {i.status === 'replacing' && (
                    <>
                      <dt>Replacement</dt>
                      <dd className={live ? 'live' : 'release'} title={i.replacementRelease ?? undefined}>
                        {live ? <ProgressBar p={live} /> : (i.replacementRelease ?? 'Waiting for the download client')}
                      </dd>
                    </>
                  )}
                  <dt>Reported</dt>
                  <dd title={when(i.createdAt)}>
                    {ago(i.createdAt)}
                    {admin && (
                      <>
                        {' '}
                        by <Avatar name={i.username} small /> {i.username}
                      </>
                    )}
                  </dd>
                </dl>
                {i.resolution && <p className={i.status === 'resolved' ? 'note' : 'err'}>{i.resolution}</p>}
              </div>
              {admin && i.status !== 'resolved' && (
                <div className="side">
                  {i.status === 'open' && (
                    <button type="button" className="btn primary" disabled={busy === i.id} onClick={() => act(i, 'replace')}>
                      <Icon name="refresh" /> {busy === i.id ? 'Searching…' : 'Replace release'}
                    </button>
                  )}
                  <input
                    className="input"
                    placeholder="Note for the reporter"
                    aria-label={`Note for ${i.username}`}
                    value={notes[i.id] ?? ''}
                    maxLength={500}
                    onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                  />
                  <button type="button" className="btn success" disabled={busy === i.id} onClick={() => act(i, 'resolve')}>
                    <Icon name="check" /> Resolve
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
