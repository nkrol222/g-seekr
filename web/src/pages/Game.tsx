import { useEffect, useState } from 'react';
import { api, REGIONS, STATUS_LABEL, versionLabel, type GamePage as Page, type Platform, type RequestStatus, type Version } from '../api';
import { Alert, Icon, Poster, rommGameUrl, StatusBadge } from './shared';
import { cardStatus, TitleCard } from './Titles';

// Seerr's title page: a backdrop, the poster and facts, the request per platform, then media and similar games
export function GamePage({ igdbId, rommUrl, onRequested }: { igdbId: number; rommUrl: string | null; onRequested: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [platforms, setPlatforms] = useState<Map<number, Platform>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  // The platform whose "Another version" picker is open, and what's picked in it
  const [picking, setPicking] = useState<number | null>(null);
  const [picked, setPicked] = useState<Version>({ region: '', variant: '', latestRevision: false });
  const [showStory, setShowStory] = useState(false);
  const [trailer, setTrailer] = useState<string | null>(null);
  const [mine, setMine] = useState<{ liked: boolean; dismissed: boolean }>({ liked: false, dismissed: false });

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    setNotice(null);
    setTrailer(null);
    window.scrollTo(0, 0);
    api
      .game(igdbId)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setMine(p.mine ?? { liked: false, dismissed: false });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    api
      .platforms()
      .then((list) => !cancelled && setPlatforms(new Map(list.map((p) => [p.id, p]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [igdbId]);

  const request = async (platformId: number, version?: Version) => {
    if (!page) return;
    setPending(platformId);
    setError(null);
    setNotice(null);
    try {
      const { request } = await api.request(igdbId, platformId, version);
      const which = versionLabel(request);
      setNotice(`Requested for ${request.platformName}${which ? ` (${which})` : ''}: ${STATUS_LABEL[request.status]}.`);
      setPage({
        ...page,
        game: { ...page.game, requests: [...page.game.requests, { id: request.id, platformId, status: request.status, region: request.region ?? '', variant: request.variant ?? '' }] },
      });
      setPicking(null);
      onRequested();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const like = async () => {
    if (!page) return;
    const liked = !mine.liked;
    setMine({ liked, dismissed: liked ? false : mine.dismissed });
    await api.like(igdbId, liked, page.game.title).catch(() => setMine(mine));
  };
  const notInterested = async () => {
    const dismissed = !mine.dismissed;
    setMine({ liked: dismissed ? false : mine.liked, dismissed });
    await api.dismiss(igdbId, dismissed).catch(() => setMine(mine));
  };

  if (error && !page) return <Alert kind="error">{error}</Alert>;
  if (!page) return <div className="game-skeleton" aria-busy="true" />;

  const g = page.game;
  const status = cardStatus(g);
  const seriesRefs = page.seriesRefs ?? [];
  const facts: [string, React.ReactNode][] = [
    ['Released', page.releases.find((r) => r.date)?.date ?? (g.year ? String(g.year) : '')],
    ['Developer', page.developers.join(', ')],
    ['Publisher', page.publishers.join(', ')],
    ['Genres', g.genres.join(', ')],
    ['Themes', page.themes.join(', ')],
    ['Modes', page.gameModes.join(', ')],
    [
      'Series',
      seriesRefs.length > 0
        ? seriesRefs.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              <a href={`#/collection/series/${r.id}`}>{r.name}</a>
            </span>
          ))
        : page.franchises.join(', '),
    ],
  ];
  const isDefault = (r: { region?: string; variant?: string }) => !r.region && !r.variant;
  // The default version's request; other versions' requests are listed under it
  const statusFor = (platformId: number): RequestStatus | null => g.requests.find((r) => r.platformId === platformId && isDefault(r))?.status ?? null;
  // Where IGDB says it came out on the platform; every region when it doesn't say
  const regionsFor = (platformId: number) => {
    const known = page.releases.find((r) => r.platformId === platformId)?.regions ?? [];
    return known.length > 0 ? REGIONS.filter((r) => known.includes(r)) : REGIONS;
  };
  const owns = (platformId: number) => (g.versions ?? []).filter((v) => v.platformId === platformId && v.downloaded);

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
          <div className="game-actions">
            <button type="button" className={mine.liked ? 'btn liked' : 'btn'} aria-pressed={mine.liked} onClick={like}>
              <Icon name="heart" /> {mine.liked ? 'Liked' : 'Like'}
            </button>
            <button type="button" className={mine.dismissed ? 'btn dismissed' : 'btn ghost'} aria-pressed={mine.dismissed} onClick={notInterested}>
              <Icon name="eyeSlash" /> {mine.dismissed ? 'Not interested' : 'Not interested?'}
            </button>
          </div>
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
                  const play = rommGameUrl(rommUrl, g.romm?.find((x) => x.platformId === pid)?.rommId);
                  const owned = g.inLibrary?.includes(pid) ?? false;
                  const have = owns(pid);
                  const others = g.requests.filter((r) => r.platformId === pid && !isDefault(r));
                  const regions = regionsFor(pid);
                  return (
                    <div key={pid} className="platform-block">
                      <div className="platform-row">
                        <span className="name">{platform.name}</span>
                        {play ? (
                          <a className="btn primary sm" href={play} target="_blank" rel="noreferrer">
                            <Icon name="play" /> Play in RomM
                          </a>
                        ) : owned ? (
                          <span className="badge available" title="RomM shows it after its next scan, usually within the hour">
                            In the library
                          </span>
                        ) : s ? (
                          <StatusBadge status={s} />
                        ) : (
                          <button type="button" className="btn primary sm" onClick={() => request(pid)} disabled={pending !== null}>
                            <Icon name="download" />
                            {pending === pid ? 'Requesting…' : 'Request'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn ghost sm"
                          aria-expanded={picking === pid}
                          onClick={() => {
                            setPicking(picking === pid ? null : pid);
                            setPicked({ region: '', variant: '', latestRevision: false });
                          }}
                        >
                          {picking === pid ? 'Close' : have.length > 0 || s ? 'Another version…' : 'Choose a version…'}
                        </button>
                      </div>
                      {have.length > 0 && (
                        <p className="versions muted">
                          You have:{' '}
                          {have
                            .map((v) => [v.region || 'any region', v.variant === 'en-translation' ? 'English translation' : '', v.revision ? `rev ${v.revision}` : ''].filter(Boolean).join(', '))
                            .join('; ')}
                        </p>
                      )}
                      {others.map((r) => (
                        <p key={r.id} className="versions">
                          {versionLabel(r)}: <StatusBadge status={r.status} />
                        </p>
                      ))}
                      {picking === pid && (
                        <form
                          className="version-picker"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void request(pid, picked);
                          }}
                        >
                          <label>
                            Region
                            <select value={picked.region} onChange={(e) => setPicked({ ...picked, region: e.target.value })}>
                              <option value="">Any (the preferred region first)</option>
                              {regions.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={picked.variant === 'en-translation'}
                              onChange={(e) => setPicked({ ...picked, variant: e.target.checked ? 'en-translation' : '' })}
                            />
                            English fan translation
                          </label>
                          <label className="check">
                            <input type="checkbox" checked={picked.latestRevision} onChange={(e) => setPicked({ ...picked, latestRevision: e.target.checked })} />
                            Latest revision (and update to newer ones)
                          </label>
                          <p className="muted small">
                            {have.length > 0 ? 'A different version is added beside the one you have.' : 'Leave it all as it is for the usual version.'}
                          </p>
                          <button type="submit" className="btn primary sm" disabled={pending !== null}>
                            {pending === pid ? 'Requesting…' : versionLabel(picked) ? `Request ${versionLabel(picked)}` : 'Request'}
                          </button>
                        </form>
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

      {[
        [
          seriesRefs.length > 0 ? (
            <>
              More from this series{' '}
              <a className="head-link" href={`#/collection/series/${seriesRefs[0]!.id}`}>
                See the collection →
              </a>
            </>
          ) : (
            'More from this series'
          ),
          page.series ?? [],
        ],
        [page.developer ? `More from ${page.developer}` : 'More from the developer', page.fromDeveloper ?? []],
      ].map(([title, games]) =>
        (games as typeof page.similar).length > 0 ? (
          <section key={typeof title === 'string' ? title : 'series'} className="slider">
            <div className="slider-head">
              <h2>{title as React.ReactNode}</h2>
            </div>
            <div className="slider-track">
              {(games as typeof page.similar).map((s) => (
                <TitleCard key={s.igdbId} game={s} />
              ))}
            </div>
          </section>
        ) : null,
      )}
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
