import { useCallback, useEffect, useState } from 'react';
import { api, type GameRequest, type Me } from '../api';
import { Cover, rommLink, StatusBadge, when } from './shared';

export function MyRequests({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [requests, setRequests] = useState<GameRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests((await api.requests('mine')).requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async (r: GameRequest) => {
    if (!window.confirm(`Withdraw your request for ${r.title}?`)) return;
    try {
      await api.remove(r.id);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section>
      <h2>My requests</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {requests?.length === 0 && <p className="muted">You haven’t requested anything yet.</p>}
      <ul className="requests">
        {requests?.map((r) => {
          const play = rommLink(me.rommUrl, r);
          return (
            <li key={r.id} className="card request">
              <Cover url={r.coverUrl} title={r.title} />
              <div className="body">
                <h3>
                  {r.title} {r.year && <span className="muted">({r.year})</span>}
                </h3>
                <p className="muted small">
                  {r.platformName} · requested {when(r.createdAt)}
                </p>
                <StatusBadge request={r} />
                {r.note && <p className="small">Note: {r.note}</p>}
                <div className="actions">
                  {play && (
                    <a className="button primary" href={play} target="_blank" rel="noreferrer">
                      Play in RomM
                    </a>
                  )}
                  {r.status === 'pending' && (
                    <button type="button" onClick={() => withdraw(r)}>
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
