import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, type Platform, type RequestStatus, type SearchResult } from '../api';
import { Alert, Icon, Poster, StatusBadge } from './shared';

// The furthest along of a game's requests, for the badge on its card
const RANK: RequestStatus[] = ['declined', 'failed', 'pending', 'approved', 'searching', 'downloading', 'available'];

export function cardStatus(game: SearchResult): RequestStatus | null {
  if (game.owned) return 'available';
  return game.requests.map((r) => r.status).sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0] ?? null;
}

// A poster like Seerr's: status badge top right, details and the request button on hover
export function TitleCard({ game, onOpen }: { game: SearchResult; onOpen: () => void }) {
  const status = cardStatus(game);
  return (
    <button type="button" className="title-card" onClick={onOpen} aria-label={`${game.title}${game.year ? ` (${game.year})` : ''}${status ? `, ${STATUS_LABEL[status]}` : ''}`}>
      <Poster url={game.coverUrl} title={game.title} />
      <span className="type">Game</span>
      {status && (
        <span className="status">
          <StatusBadge status={status} compact />
        </span>
      )}
      <span className="info">
        {game.year && <span className="year">{game.year}</span>}
        <h3>{game.title}</h3>
        {game.overview && <p>{game.overview}</p>}
        <span className="cta">{status === 'available' ? 'View' : status ? 'View request' : 'Request'}</span>
      </span>
    </button>
  );
}

// Seerr's title view, as a modal: the cover as a blurred backdrop, the poster and title, the overview, and a
// request button per platform the game is out on
export function GameModal({
  game,
  platforms,
  onClose,
  onRequested,
}: {
  game: SearchResult;
  platforms: Map<number, Platform>;
  onClose: () => void;
  onRequested: (game: SearchResult, request: { id: number; platformId: number; status: RequestStatus }) => void;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const request = async (platformId: number) => {
    setPending(platformId);
    setError(null);
    setNotice(null);
    try {
      const { request } = await api.request(game.igdbId, platformId);
      setNotice(`Requested for ${request.platformName}: ${STATUS_LABEL[request.status]}.`);
      onRequested(game, { id: request.id, platformId, status: request.status });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const status = cardStatus(game);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="game-title">
        {game.coverUrl && (
          <div className="backdrop" aria-hidden="true">
            <img src={game.coverUrl} alt="" referrerPolicy="no-referrer" />
          </div>
        )}
        <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="head">
          <div className="poster">
            <Poster url={game.coverUrl} title={game.title} />
          </div>
          <div>
            <div className="badges">
              {status && <StatusBadge status={status} />}
              {game.owned && status !== 'available' && <span className="badge available">In the library</span>}
            </div>
            <h2 id="game-title">
              {game.title} {game.year && <span>({game.year})</span>}
            </h2>
          </div>
        </div>
        <div className="body">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          <h3>Overview</h3>
          <p>{game.overview || 'No overview available.'}</p>
          <h3>Request</h3>
          {game.platformIds.length === 0 ? (
            <p className="muted">It isn’t out on any platform you can request.</p>
          ) : (
            <div className="platform-list">
              {game.platformIds.map((pid) => {
                const platform = platforms.get(pid);
                if (!platform) return null;
                const open = game.requests.find((r) => r.platformId === pid);
                return (
                  <div key={pid} className="platform-row">
                    <span className="name">{platform.name}</span>
                    {open ? (
                      <StatusBadge status={open.status} />
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
        </div>
      </div>
    </div>
  );
}
