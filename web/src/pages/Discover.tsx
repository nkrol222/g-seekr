import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, type GameRequest, type Me } from '../api';
import { Alert, Icon, Poster, StatusBadge } from './shared';

// Seerr opens on Discover: a welcome, then rows of posters. Until g-seekr has discovery lists of its own, the
// rows are the requests: what's ready to play, and what was asked for lately.
export function Discover({ me }: { me: Me }) {
  const [requests, setRequests] = useState<GameRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .requests(me.user.isAdmin ? 'all' : 'mine')
      .then((r) => setRequests(r.requests))
      .catch((err: Error) => setError(err.message));
  }, [me.user.isAdmin]);

  const { limit, used, days } = me.limits;
  const ready = (requests ?? []).filter((r) => r.status === 'available');
  const recent = [...(requests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const waiting = me.user.isAdmin ? (requests ?? []).filter((r) => r.status === 'pending') : [];

  return (
    <>
      <section className="hero">
        <h1>Hi {me.user.username}, what do you want to play?</h1>
        <p>Search for any game in the bar above, pick the platform, and request it. You’ll see it here, and in RomM, once it’s ready.</p>
        {limit > 0 && (
          <span className="quota">
            <span className="meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
            </span>
            {used} of {limit} requests used in the last {days} days
          </span>
        )}
      </section>
      {error && <Alert kind="error">{error}</Alert>}
      {waiting.length > 0 && <Row title="Waiting for approval" requests={waiting} showUser link="#/requests?filter=pending" />}
      <Row title={me.user.isAdmin ? 'Recent requests' : 'Your recent requests'} requests={recent} showUser={me.user.isAdmin} link="#/requests" />
      <Row title="Ready to play" requests={ready} link="#/requests?filter=available" />
    </>
  );
}

function Row({ title, requests, link, showUser = false }: { title: string; requests: GameRequest[]; link: string; showUser?: boolean }) {
  return (
    <section className="slider">
      <div className="slider-head">
        <h2>{title}</h2>
        <a href={link}>
          View all <span aria-hidden="true">→</span>
        </a>
      </div>
      {requests.length === 0 ? (
        <p className="muted small">Nothing here yet.</p>
      ) : (
        <div className="slider-track">
          {requests.map((r) => (
            <a key={r.id} className="title-card" href={link} aria-label={`${r.title} for ${r.platformName}, ${STATUS_LABEL[r.status]}`}>
              <Poster url={r.coverUrl} title={r.title} />
              <span className="type">{r.platformName}</span>
              <span className="status">
                <StatusBadge status={r.status} compact />
              </span>
              <span className="caption">
                <strong>{r.title}</strong>
                {showUser && (
                  <>
                    <br />
                    <span className="muted">
                      <Icon name="users" /> {r.username}
                    </span>
                  </>
                )}
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
