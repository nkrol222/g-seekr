import { useState, type ReactNode } from 'react';
import { STATUS_LABEL, type GameRequest, type RequestStatus } from '../api';

// Outline icons, 24x24, drawn with currentColor
const paths = {
  sparkles: 'M9.8 15.9 9 18.75l-.8-2.85a4.5 4.5 0 0 0-3.1-3.1L2.25 12l2.85-.8a4.5 4.5 0 0 0 3.1-3.1L9 5.25l.8 2.85a4.5 4.5 0 0 0 3.1 3.1l2.85.8-2.85.8a4.5 4.5 0 0 0-3.1 3.1ZM18.26 8.72 18 9.75l-.26-1.03a3.38 3.38 0 0 0-2.46-2.46L14.25 6l1.03-.26a3.38 3.38 0 0 0 2.46-2.46L18 2.25l.26 1.03a3.38 3.38 0 0 0 2.46 2.46l1.03.26-1.03.26a3.38 3.38 0 0 0-2.46 2.46Z',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  users: 'M15 19.13a9.38 9.38 0 0 0 2.63.37 9.34 9.34 0 0 0 4.12-.95 4.13 4.13 0 0 0-7.53-2.49M15 19.13v-.01c0-1.11-.29-2.16-.78-3.07M15 19.13v.1A12.32 12.32 0 0 1 8.62 21c-2.33 0-4.51-.65-6.37-1.77v-.1a6.38 6.38 0 0 1 11.96-3.08M12 6.38a3.38 3.38 0 1 1-6.75 0 3.38 3.38 0 0 1 6.75 0Zm8.25 2.25a2.63 2.63 0 1 1-5.25 0 2.63 2.63 0 0 1 5.25 0Z',
  search: 'm21 21-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  close: 'M6 18 18 6M6 6l12 12',
  check: 'm4.5 12.75 6 6 9-13.5',
  download: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  x: 'M6 18 18 6M6 6l12 12',
  play: 'M5.25 5.65c0-.86.92-1.4 1.67-.98l11.54 6.35a1.13 1.13 0 0 1 0 1.97L6.92 19.33c-.75.42-1.67-.13-1.67-.98V5.65Z',
  trash: 'm14.74 9-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17L18.16 19.67a2.25 2.25 0 0 1-2.24 2.08H8.08a2.25 2.25 0 0 1-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 0 0-3.48-.4m-12 .56c.34-.06.68-.11 1.02-.17m0 0a48.1 48.1 0 0 1 3.48-.4m7.5 0v-.92c0-1.18-.91-2.16-2.09-2.2a51.96 51.96 0 0 0-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.92m7.5 0a48.67 48.67 0 0 0-7.5 0',
  refresh: 'M16.02 9.35h4.99v0M2.99 19.64v-4.99m0 0h4.99m-4.99 0 3.18 3.18a8.25 8.25 0 0 0 13.8-3.7M4.03 9.87a8.25 8.25 0 0 1 13.8-3.7l3.18 3.18m0-4.99v4.99',
  flag: 'M3 3v1.5M3 21v-6m0 0 2.77-.69a9 9 0 0 1 6.21.72l.11.05a9 9 0 0 0 6.08.7l3.11-.73a48.5 48.5 0 0 1-.01-10.5l-3.1.73a9 9 0 0 1-6.08-.7l-.11-.05a9 9 0 0 0-6.21-.72L3 4.5M3 15V4.5',
  wrench: 'M21.75 6.75a4.5 4.5 0 0 1-4.88 4.48c-1.08-.09-2.27.07-2.96.9l-7.15 8.68a2.55 2.55 0 1 1-3.59-3.59l8.68-7.15c.83-.69.99-1.88.9-2.96a4.5 4.5 0 0 1 6.13-4.57l-3.28 3.28a3 3 0 0 0 2.25 2.25l3.28-3.28c.26.6.41 1.27.41 1.97Z',
  funnel: 'M12 3c2.75 0 5.45.23 8.08.68.53.09.92.56.92 1.1v1.04a2.25 2.25 0 0 1-.66 1.6l-5.45 5.44a2.25 2.25 0 0 0-.66 1.6v2.92a2.25 2.25 0 0 1-1.24 2.01L9.75 21v-6.57a2.25 2.25 0 0 0-.66-1.6L3.66 7.4A2.25 2.25 0 0 1 3 5.81V4.77c0-.54.39-1.01.92-1.1A48.3 48.3 0 0 1 12 3Z',
  squares: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, title }: { name: IconName; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  );
}

// The app's mark: a gamepad in a gradient tile
export function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.5 7h9a5 5 0 0 1 4.9 6l-.6 3.1a2.8 2.8 0 0 1-4.8 1.4L14.4 16H9.6L8 17.5a2.8 2.8 0 0 1-4.8-1.4L2.6 13A5 5 0 0 1 7.5 7Zm-.25 2.75v1.5h-1.5v1.5h1.5v1.5h1.5v-1.5h1.5v-1.5h-1.5v-1.5h-1.5Zm8.5.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </svg>
  );
}

// The cover, or the title on a gradient when there is none or it doesn't load
export function Poster({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
  ) : (
    <div className="ph" aria-hidden="true">
      {title}
    </div>
  );
}

const STATUS_ICON: Record<RequestStatus, IconName> = {
  pending: 'clock',
  approved: 'check',
  searching: 'search',
  downloading: 'download',
  available: 'check',
  declined: 'x',
  failed: 'x',
};

export function StatusBadge({ status, compact = false }: { status: RequestStatus; compact?: boolean }) {
  if (compact) {
    return (
      <span className={`badge ${status}`} title={STATUS_LABEL[status]}>
        <Icon name={STATUS_ICON[status]} />
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </span>
    );
  }
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={small ? 'avatar sm' : 'avatar'} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

export function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

export function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  let unit: [number, string] = units[0]!;
  for (const u of units) if (s >= u[0]) unit = u;
  if (s >= 2592000) return new Date(iso).toLocaleDateString();
  const n = Math.floor(s / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? '' : 's'} ago`;
}

// RomM's home page; a link to the game itself needs RomM's id for it, which g-seekr doesn't have yet
export function rommLink(rommUrl: string | null, request: GameRequest): string | null {
  if (!rommUrl || request.status !== 'available') return null;
  return rommUrl;
}

// A request card's status line: what RetroArr is doing about it
export function statusDetail(r: GameRequest): string | null {
  if (r.status === 'downloading' && r.release) return r.release;
  return null;
}
