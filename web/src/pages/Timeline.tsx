import { useEffect, useState } from 'react';
import { api, type Progress, type Timeline, type TimelineStep } from '../api';
import { ProgressBar } from './Live';
import { ago, Alert, Icon, when } from './shared';

// "today 6:00 pm", "tomorrow 9:00 am", "Mon 3:00 pm"
export function nextTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
  if (d.getTime() <= now.getTime()) return 'any minute now';
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// The one line a request's card shows: where it's at, and when the next try is
export function StepLine({ step, admin }: { step: TimelineStep; admin: boolean }) {
  return (
    <span className={`step-line step-${step.state}`}>
      <strong>{step.label}</strong>
      {step.detail && <> · {step.detail}</>}
      {step.nextAt && <> Next look {nextTime(step.nextAt)}.</>}
      {admin && step.adminDetail && <span className="step-admin">{step.adminDetail}</span>}
    </span>
  );
}

const ICON: Record<TimelineStep['state'], 'check' | 'clock' | 'x' | null> = { done: 'check', current: 'clock', failed: 'x', waiting: null };

// A request's steps, as a delivery tracker shows a parcel's: done, where it's at now, what's still to come
export function RequestTimeline({ requestId, admin, live }: { requestId: number; admin: boolean; live?: Progress }) {
  const [t, setT] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .timeline(requestId)
      .then((x) => !cancelled && setT(x))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!t) return <p className="muted small">Loading…</p>;

  return (
    <div className="timeline">
      <ol className="steps-track">
        {t.steps.map((s) => {
          const icon = ICON[s.state];
          return (
            <li key={s.key} className={`tl-step tl-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="tl-dot" aria-hidden="true">
                {icon && <Icon name={icon} />}
              </span>
              <div className="tl-body">
                <div className="tl-head">
                  <strong>{s.label}</strong>
                  {s.at && (
                    <span className="muted small" title={when(s.at)}>
                      {new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
                {s.key === 'downloading' && s.state === 'current' && live && <ProgressBar p={live} />}
                {s.detail && <p>{s.detail}</p>}
                {(s.lastAt || s.nextAt) && (
                  <p className="muted small">
                    {s.lastAt && <span title={when(s.lastAt)}>Last looked {ago(s.lastAt)}. </span>}
                    {s.nextAt && <>Next look {nextTime(s.nextAt)}.</>}
                  </p>
                )}
                {admin && s.adminDetail && <p className="tl-admin">{s.adminDetail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {t.history.length > 0 && (
        <div className="tl-history">
          <button type="button" className="link-button" aria-expanded={history} onClick={() => setHistory((h) => !h)}>
            <Icon name="clock" /> {history ? 'Hide history' : `History (${t.history.length})`}
          </button>
          {history && (
            <ul>
              {t.history.map((h, i) => (
                <li key={i}>
                  <span className="muted small">{new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span> {h.text}
                  {admin && h.adminDetail && <span className="tl-admin"> · {h.adminDetail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
