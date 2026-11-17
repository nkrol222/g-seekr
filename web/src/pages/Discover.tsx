import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, type Filters, type GameRequest, type Me, type Platform } from '../api';
import { useFilters } from './Filters';
import { Alert, Icon, Poster, StatusBadge } from './shared';
import { GameRow, TitleCard } from './Titles';
import { reasonText, useRecommendations } from './ForYou';
import { CollectionRow, useCollectionRows } from './Collections';

// Seerr's Discover: a welcome, then rows of posters. The game rows follow only the user's adult-games switch;
// the Browse page has the full filters.
export function Discover({ me }: { me: Me }) {
  const [requests, setRequests] = useState<GameRequest[] | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { filters } = useFilters();
  const { recs, dismiss } = useRecommendations();
  const { rows: collections } = useCollectionRows();

  useEffect(() => {
    api
      .requests(me.user.isAdmin ? 'all' : 'mine')
      .then((r) => setRequests(r.requests))
      .catch((err: Error) => setError(err.message));
    api.platforms().then(setPlatforms).catch(() => undefined);
  }, [me.user.isAdmin]);

  const { limit, used, days } = me.limits;
  const ready = (requests ?? []).filter((r) => r.status === 'available');
  const recent = [...(requests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const waiting = me.user.isAdmin ? (requests ?? []).filter((r) => r.status === 'pending') : [];
  const adultOnly: Partial<Filters> | undefined = filters ? { includeAdult: filters.includeAdult } : undefined;

  return (
    <>
      <section className="hero">
        <h1>Hi {me.user.username}, what do you want to play?</h1>
        <p>Browse what’s popular, search for any game, pick the platform and request it. You’ll see it here, and in RomM, once it’s ready.</p>
        <div className="hero-actions">
          <a className="btn primary" href="#/browse">
            <Icon name="sparkles" /> Browse games
          </a>
          {limit > 0 && (
            <span className="quota">
              <span className="meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
              </span>
              {used} of {limit} requests used in the last {days} days
            </span>
          )}
        </div>
      </section>
      {error && <Alert kind="error">{error}</Alert>}
      {waiting.length > 0 && <RequestRow title="Waiting for approval" requests={waiting} showUser link="#/requests?filter=pending" />}
      {recs && recs.games.length > 0 && (
        <section className="slider">
          <div className="slider-head">
            <h2>Recommended for you</h2>
            <a href="#/for-you">
              View all <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="slider-track rec-track">
            {recs.games.slice(0, 20).map((g) => (
              <TitleCard key={g.igdbId} game={g} reason={reasonText(g)} onDismiss={() => void dismiss(g.igdbId)} />
            ))}
          </div>
        </section>
      )}
      {collections && (
        <>
          <CollectionRow title="Featured collections" cards={collections.featured} link="#/collections" />
          <CollectionRow title="Your collections in progress" cards={collections.inProgress} link="#/collections" />
        </>
      )}
      {filters && (
        <>
          <GameRow title="Popular right now" link="#/browse?list=popular" load={async () => (await api.discover({ list: 'popular', filters: adultOnly })).games} />
          <GameRow title="Top rated" link="#/browse?list=top" load={async () => (await api.discover({ list: 'top', filters: adultOnly })).games} />
          <GameRow title="Recently added to the library" empty="Nothing imported yet." load={async () => (await api.recentlyAdded()).games} />
        </>
      )}
      {collections && <CollectionRow title="Popular collections" cards={collections.popular} link="#/collections" />}
      <RequestRow title={me.user.isAdmin ? 'Recent requests' : 'Your recent requests'} requests={recent} showUser={me.user.isAdmin} link="#/requests" />
      <RequestRow title="Ready to play" requests={ready} link="#/requests?filter=available" />
      {recs?.because.map((b) => (
        <section key={b.seed.igdbId} className="slider">
          <div className="slider-head">
            <h2>
              Because you {b.seed.kind} <a href={`#/game/${b.seed.igdbId}`}>{b.seed.title}</a>
            </h2>
          </div>
          <div className="slider-track rec-track">
            {b.games.map((g) => (
              <TitleCard key={g.igdbId} game={g} onDismiss={() => void dismiss(g.igdbId)} />
            ))}
          </div>
        </section>
      ))}
      {filters &&
        platforms.map((p) => (
          <GameRow
            key={p.id}
            title={`Popular on ${p.name}`}
            link={`#/browse?list=popular&platform=${p.id}`}
            load={async () => (await api.discover({ list: 'popular', platformId: p.id, filters: adultOnly })).games}
          />
        ))}
    </>
  );
}

function RequestRow({ title, requests, link, showUser = false }: { title: string; requests: GameRequest[]; link: string; showUser?: boolean }) {
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
            <a key={r.id} className="title-card" href={`#/game/${r.igdbId}`} aria-label={`${r.title} for ${r.platformName}, ${STATUS_LABEL[r.status]}`}>
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
