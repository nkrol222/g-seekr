import { STATUS_LABEL, type GameRequest } from '../api';

export function Cover({ url, title }: { url: string | null; title: string }) {
  return url ? <img className="cover" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="cover placeholder" aria-hidden="true">{title.slice(0, 1)}</div>;
}

export function StatusBadge({ request }: { request: GameRequest }) {
  return <span className={`badge ${request.status}`}>{STATUS_LABEL[request.status]}</span>;
}

export function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

// RomM's home page; a link to the game itself needs RomM's id for it, which g-seekr doesn't have yet
export function rommLink(rommUrl: string | null, request: GameRequest): string | null {
  if (!rommUrl || request.status !== 'available') return null;
  return rommUrl;
}
