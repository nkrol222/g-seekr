import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, type GamePage as Page, type Platform, type RequestStatus } from '../api';
import { Alert, Icon, Poster, StatusBadge } from './shared';
import { cardStatus, TitleCard } from './Titles';

// Seerr's title page: a backdrop, the poster and facts, the request per platform, then media and similar games
export function GamePage({ igdbId, onRequested }: { igdbId: number; onRequested: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [platforms, setPlatforms] = useState<Map<number, Platform>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [showStory, setShowStory] = useState(false);
  const [trailer, setTrailer] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    setNotice(null);
    setTrailer(null);
    window.scrollTo(0, 0);
    api
      .game(igdbId)
      .then((p) => !cancelled && setPage(p))
      .catch((err: Error) => !cancelled && setError(err.message));
    api
      .platforms()
      .then((list) => !cancelled && setPlatforms(new Map(list.map((p) => [p.id, p]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [igdbId]);

  const request = async (platformId: number) => {
    if (!page) return;
    setPending(platformId);
    setError(null);
    setNotice(null);
    try {
      const { request } = await api.request(igdbId, platformId);
      setNotice(`Requested for ${request.platformName}: ${STATUS_LABEL[request.status]}.`);
      setPage({ ...page, game: { ...page.game, requests: [...page.game.requests, { id: request.id, platformId, status: request.status }] } });
      onRequested();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  if (error && !page) return <Alert kind="error">{error}</Alert>;
  if (!page) return <div className="game-skeleton" aria-busy="true" />;

  const g = page.game;
  const status = cardStatus(g);
  const facts: [string, string][] = [
    ['Released', page.releases.find((r) => r.date)?.date ?? (g.year ? String(g.year) : '')],
    ['Developer', page.developers.join(', ')],
    ['Publisher', page.publishers.join(', ')],
    ['Genres', g.genres.join(', ')],
    ['Themes', page.themes.join(', ')],
    ['Modes', page.gameModes.join(', ')],
    ['Series', page.franchises.join(', ')],
  ];
  const statusFor = (platformId: number): RequestStatus | null => g.requests.find((r) => r.platformId === platformId)?.status ?? null;

  return (
    <article className="game-page">
      <div className="game-backdrop" aria-hidden="true">
        {(page.backgroundUrl ?? g.coverUrl) && <img src={page.backgroundUrl ?? g.coverUrl!} alt="" referrerPolicy="no-referrer" className={page.backgroundUrl ? undefined : 'blur'} />}
      </div>

      <header className="game-head">
        <div className="game-poster">
          <Poster url={g.coverUrl} title={g.title} />
        </div>
        <div className="game-title">
          <div className="badges">
            {status && <StatusBadge status={status} />}
            {g.owned && status !== 'available' && <span className="badge available">In the library</span>}
          </div>
          <h1>
            {g.title} {g.year && <span>({g.year})</span>}
          </h1>
          <p className="game-sub">
            {g.genres.slice(0, 3).join(', ')}
            {g.rating != null && (
              <span className="rating" title={g.ratingCount ? `${g.ratingCount} ratings` : undefined}>
                ★ {Math.round(g.rating)}
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="game-body">
        <div className="game-main">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          <section>
            <h2>Overview</h2>
            <p>{g.overview || 'No overview available.'}</p>
            {page.storyline && (
              <>
                {showStory && <p>{page.storyline}</p>}
                <button type="button" className="btn ghost sm" onClick={() => setShowStory((s) => !s)}>
                  {showStory ? 'Hide the story' : 'Read the story'}
                </button>
              </>
            )}
          </section>

          <section>
            <h2>Request</h2>
            {g.platformIds.length === 0 ? (
              <p className="muted">It isn’t out on any platform you can request.</p>
            ) : (
              <div className="platform-list">
                {g.platformIds.map((pid) => {
                  const platform = platforms.get(pid);
                  if (!platform) return null;
                  const s = statusFor(pid);
                  return (
                    <div key={pid} className="platform-row">
                      <span className="name">{platform.name}</span>
                      {s ? (
                        <StatusBadge status={s} />
                      ) : (
                        <button type="button" className="btn primary sm" onClick={() => request(pid)} disabled={pending !== null}>
                          <Icon name="download" />
                          {pending === pid ? 'Requesting…' : 'Request'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {page.videos.length > 0 && (
            <section>
              <h2>Trailers</h2>
              {trailer ? (
                <div className="video">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer)}?autoplay=1`}
                    title="Trailer"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              ) : (
                <div className="video-list">
                  {page.videos.map((v) => (
                    <button key={v.youtubeId} type="button" className="video-thumb" onClick={() => setTrailer(v.youtubeId)} aria-label={`Play ${v.name}`}>
                      <img src={`https://i.ytimg.com/vi/${encodeURIComponent(v.youtubeId)}/hqdefault.jpg`} alt="" referrerPolicy="no-referrer" loading="lazy" />
                      <span className="play" aria-hidden="true">
                        <Icon name="play" />
                      </span>
                      <span className="video-name">{v.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {page.screenshots.length > 0 && (
            <section>
              <h2>Screenshots</h2>
              <div className="shots">
                {page.screenshots.map((s) => (
                  <a key={s} href={s.replace('/t_screenshot_big/', '/t_1080p/')} target="_blank" rel="noreferrer">
                    <img src={s} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="game-facts">
          <dl>
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {page.releases.length > 0 && (
            <>
              <h3>Releases</h3>
              <ul className="releases">
                {page.releases.map((r) => (
                  <li key={r.platform} className={r.requestable ? undefined : 'muted'}>
                    <span>{r.platform}</span>
                    <span>{r.date ?? 'TBA'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      {page.similar.length > 0 && (
        <section className="slider">
          <div className="slider-head">
            <h2>Similar games</h2>
          </div>
          <div className="slider-track">
            {page.similar.map((s) => (
              <TitleCard key={s.igdbId} game={s} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
