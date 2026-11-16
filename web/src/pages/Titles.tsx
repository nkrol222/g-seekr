import { useEffect, useRef, useState, type ReactNode } from 'react';
import { STATUS_LABEL, type GameCard, type RequestStatus, type SearchResult } from '../api';
import { Icon, Poster, StatusBadge } from './shared';

// The furthest along of a game's requests, for the badge on its card
const RANK: RequestStatus[] = ['declined', 'failed', 'pending', 'approved', 'searching', 'downloading', 'available'];

export function cardStatus(game: SearchResult): RequestStatus | null {
  if (game.owned) return 'available';
  return game.requests.map((r) => r.status).sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0] ?? null;
}

// A poster like Seerr's: status badge top right, details on hover, the game's page on click. A recommendation also
// says why, and can be dismissed ("Not interested").
export function TitleCard({ game, reason, onDismiss }: { game: SearchResult | GameCard; reason?: string; onDismiss?: () => void }) {
  const status = cardStatus(game);
  const rating = 'rating' in game && game.rating != null ? Math.round(game.rating) : null;
  const card = (
    <a
      className="title-card"
      href={`#/game/${game.igdbId}`}
      aria-label={`${game.title}${game.year ? ` (${game.year})` : ''}${status ? `, ${STATUS_LABEL[status]}` : ''}`}
    >
      <Poster url={game.coverUrl} title={game.title} />
      {rating !== null && <span className="type">★ {rating}</span>}
      {status && (
        <span className="status">
          <StatusBadge status={status} compact />
        </span>
      )}
      <span className="info">
        {game.year && <span className="year">{game.year}</span>}
        <h3>{game.title}</h3>
        {game.overview && <p>{game.overview}</p>}
        <span className="cta">{status === 'available' ? 'In the library' : status ? 'View request' : 'Request'}</span>
      </span>
    </a>
  );
  if (!reason && !onDismiss) return card;
  return (
    <div className="rec-card">
      {card}
      {onDismiss && (
        <button type="button" className="dismiss" title="Not interested" aria-label={`Not interested in ${game.title}`} onClick={onDismiss}>
          <Icon name="x" />
        </button>
      )}
      {reason && <p className="reason">{reason}</p>}
    </div>
  );
}

// A Discover row: loads when it scrolls into view, so a long page of rows doesn't ask for everything at once
export function GameRow({ title, load, link, empty = 'Nothing here yet.' }: { title: ReactNode; load: () => Promise<GameCard[]>; link?: string; empty?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [games, setGames] = useState<GameCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadRef
      .current()
      .then((g) => !cancelled && setGames(g))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <section className="slider" ref={ref}>
      <div className="slider-head">
        <h2>{title}</h2>
        {link && (
          <a href={link}>
            View all <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
      {error ? (
        <p className="muted small">{error}</p>
      ) : games === null ? (
        <div className="slider-track" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="title-card skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="slider-track">
          {games.map((g) => (
            <TitleCard key={g.igdbId} game={g} />
          ))}
        </div>
      )}
    </section>
  );
}
