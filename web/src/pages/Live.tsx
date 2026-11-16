import { useEffect, useState, type FormEvent } from 'react';
import { api, ISSUE_KIND_LABEL, type GameRequest, type Issue, type IssueKind, type Progress } from '../api';
import { Alert, Icon } from './shared';

const PROGRESS_EVERY_MS = 10_000;

// What RetroArr's download client is doing, by RetroArr game id. Asked every 10 s while `active` (something is
// downloading or being replaced) and the tab is visible.
export function useProgress(scope: 'mine' | 'all', active: boolean): { byGame: Map<number, Progress>; error: string | null } {
  const [byGame, setByGame] = useState<Map<number, Progress>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setByGame(new Map());
      return;
    }
    let cancelled = false;
    const pull = async () => {
      if (document.hidden) return;
      try {
        const res = await api.progress(scope);
        if (cancelled) return;
        setByGame(new Map(res.progress.map((p) => [p.gameId, p])));
        setError(res.error ?? null);
      } catch {
        /* the next pull tries again */
      }
    };
    void pull();
    const timer = window.setInterval(pull, PROGRESS_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [scope, active]);

  return { byGame, error };
}

const STATE_LABEL: Record<string, string> = {
  Downloading: 'Downloading',
  Paused: 'Paused',
  Queued: 'Queued',
  Checking: 'Checking',
  Completed: 'Downloaded',
  Importing: 'Importing',
  Error: 'Error',
};

export function ProgressBar({ p }: { p: Progress }) {
  const label = p.trackedState === 'ImportPending' || p.state === 'Importing' ? 'Importing' : (STATE_LABEL[p.state] ?? p.state);
  return (
    <div className="progress" title={p.release}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress)} aria-label={`${label} ${p.release}`}>
        <span style={{ width: `${p.progress}%` }} className={p.state === 'Error' ? 'bad' : p.progress >= 100 ? 'done' : undefined} />
      </div>
      <span className="progress-text">
        {label} · {p.progress.toFixed(p.progress < 10 ? 1 : 0)}%
      </span>
      {p.statusMessages.length > 0 && <span className="progress-msg">{p.statusMessages[0]}</span>}
    </div>
  );
}

const KINDS = Object.keys(ISSUE_KIND_LABEL) as IssueKind[];

// Seerr's "Report an issue": what's wrong, and a few words
export function ReportDialog({ request, onClose, onReported }: { request: GameRequest; onClose: () => void; onReported: (issue: Issue) => void }) {
  const [kind, setKind] = useState<IssueKind>('wont_launch');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onReported((await api.report(request.id, kind, message)).issue);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit}>
        <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="dialog-body">
          <h2 id="report-title">Report a problem</h2>
          <p className="muted">
            {request.title} for {request.platformName}
          </p>
          <fieldset className="kinds">
            <legend>What’s wrong?</legend>
            {KINDS.map((k) => (
              <label key={k} className={kind === k ? 'kind active' : 'kind'}>
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                {ISSUE_KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <label className="field">
            Details {kind === 'other' ? '' : '(optional)'}
            <textarea
              className="input"
              rows={3}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happens? On which device or emulator?"
              required={kind === 'other'}
            />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Sending…' : 'Report'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
