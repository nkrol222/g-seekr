import { useCallback, useEffect, useState } from 'react';
import { api, type AdminTask } from '../api';
import { Alert, Icon, when } from './shared';

// Intervals are entered in minutes, which is what they're all measured in except the request check
const UNITS = [
  { id: 's', label: 'seconds', seconds: 1 },
  { id: 'm', label: 'minutes', seconds: 60 },
  { id: 'h', label: 'hours', seconds: 3600 },
] as const;
type Unit = (typeof UNITS)[number]['id'];

const bestUnit = (s: number): Unit => (s % 3600 === 0 && s >= 3600 ? 'h' : s % 60 === 0 && s >= 60 ? 'm' : 's');

function every(seconds: number): string {
  if (seconds === 0) return 'Off';
  const u = UNITS.find((x) => x.id === bestUnit(seconds))!;
  const n = seconds / u.seconds;
  return `Every ${n === 1 ? u.label.replace(/s$/, '') : `${n} ${u.label}`}`;
}

function relative(iso: string | null, now: number): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff >= 0 ? 'in a few seconds' : 'just now';
  const text = abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 172800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

const duration = (ms: number | null) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);

const OUTCOME: Record<NonNullable<AdminTask['lastOutcome']>, { badge: string; label: string }> = {
  succeeded: { badge: 'available', label: 'Done' },
  failed: { badge: 'failed', label: 'Failed' },
  skipped: { badge: 'neutral', label: 'Skipped' },
};

// Admin → Tasks: what g-seekr does on its own, one task at a time so RetroArr isn't asked for everything at once
export function AdminTasks() {
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; value: string; unit: Unit; error?: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setTasks((await api.tasks()).tasks);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    setNow(Date.now());
  }, []);

  const busy = tasks?.some((t) => t.running || t.queued) ?? false;
  useEffect(() => {
    void load();
    const iv = window.setInterval(load, busy ? 2000 : 20000);
    return () => window.clearInterval(iv);
  }, [load, busy]);

  const run = async (t: AdminTask) => {
    setError(null);
    try {
      await api.runTask(t.key);
    } catch (err) {
      setError((err as Error).message);
    }
    await load();
  };

  const save = async (t: AdminTask) => {
    if (!editing) return;
    const seconds = Math.round(Number(editing.value) * UNITS.find((u) => u.id === editing.unit)!.seconds);
    try {
      await api.setTaskInterval(t.key, seconds);
      setEditing(null);
      await load();
    } catch (err) {
      setEditing({ ...editing, error: (err as Error).message });
    }
  };

  return (
    <>
      <div className="page-title">
        <h1>Tasks</h1>
        <div className="tools">
          <button type="button" className="btn" onClick={() => void load()}>
            <Icon name="refresh" /> Refresh
          </button>
        </div>
      </div>
      <p className="lead muted">
        What g-seekr does on its own. Tasks run one at a time, so RetroArr and IGDB are never asked for everything at once. After a restart each one waits a
        little while first.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {!tasks && !error && <p className="muted">Loading…</p>}
      {tasks && (
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.key} className={t.running ? 'task-card running' : 'task-card'}>
              <div className="task-main">
                <h2>{t.name}</h2>
                <p className="muted small">{t.description}</p>
                {editing?.key === t.key ? (
                  <form
                    className="task-interval"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(t);
                    }}
                  >
                    <label className="sr-only" htmlFor={`int-${t.key}`}>
                      How often
                    </label>
                    <input
                      id={`int-${t.key}`}
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={editing.value}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, value: e.target.value, error: undefined })}
                    />
                    <select className="select" aria-label="Unit" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value as Unit, error: undefined })}>
                      {UNITS.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn primary">
                      Save
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    {editing.error && (
                      <span className="task-error" role="alert">
                        {editing.error}
                      </span>
                    )}
                  </form>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    title="Change how often"
                    onClick={() => {
                      const unit = bestUnit(t.intervalSeconds || t.minSeconds);
                      setEditing({ key: t.key, unit, value: String(t.intervalSeconds / UNITS.find((u) => u.id === unit)!.seconds) });
                    }}
                  >
                    <Icon name="clock" /> {every(t.intervalSeconds)}
                  </button>
                )}
              </div>
              <dl className="task-facts">
                <div>
                  <dt>Last run</dt>
                  <dd>
                    {t.running ? (
                      <span className="badge downloading">Running</span>
                    ) : t.lastOutcome ? (
                      <>
                        <span className={`badge ${OUTCOME[t.lastOutcome].badge}`}>{OUTCOME[t.lastOutcome].label}</span>{' '}
                        <span title={when(t.lastFinished)}>{relative(t.lastFinished, now)}</span>
                        <span className="muted"> · {duration(t.lastDurationMs)}</span>
                        {t.lastMessage && <span className="task-message">{t.lastMessage}</span>}
                      </>
                    ) : (
                      <span className="muted">Not run yet</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd title={when(t.nextRun)}>{t.queued ? 'Waiting its turn' : t.running ? '—' : t.nextRun ? relative(t.nextRun, now) : 'Off'}</dd>
                </div>
              </dl>
              <button type="button" className="btn" disabled={t.running || t.queued} onClick={() => void run(t)} aria-label={`Run ${t.name} now`}>
                <Icon name="play" /> {t.running ? 'Running…' : t.queued ? 'Queued' : 'Run now'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
