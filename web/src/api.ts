export type RequestStatus = 'pending' | 'approved' | 'searching' | 'downloading' | 'available' | 'declined' | 'failed';

export interface Me {
  user: { id: number; username: string; isAdmin: boolean; autoApprove: boolean };
  limits: { limit: number; days: number; used: number };
  rommUrl: string | null;
}

export interface Platform {
  id: number;
  name: string;
  slug: string;
  category: string | null;
}

export interface SearchResult {
  igdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  coverUrl: string | null;
  owned: boolean;
  platformIds: number[];
  requests: { id: number; platformId: number; status: RequestStatus }[];
}

export interface GameRequest {
  id: number;
  userId: number;
  username: string;
  igdbId: number;
  platformId: number;
  platformName: string;
  title: string;
  year: number | null;
  coverUrl: string | null;
  status: RequestStatus;
  // What RetroArr grabbed for it
  release: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  availableAt: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  jellyfinAdmin: boolean;
  effectiveAdmin: boolean;
  autoApprove: boolean;
  requestLimit: number | null;
  lastLoginAt: string | null;
  limits: { limit: number; days: number; used: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'x-gseekr': '1' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  me: () => call<Me>('GET', '/me'),
  login: (username: string, password: string) => call<Me>('POST', '/auth/login', { username, password }),
  logout: () => call<void>('POST', '/auth/logout', {}),
  platforms: () => call<Platform[]>('GET', '/platforms'),
  search: (q: string) => call<{ results: SearchResult[] }>('GET', `/search?q=${encodeURIComponent(q)}`),
  requests: (scope: 'mine' | 'all') => call<{ requests: GameRequest[] }>('GET', `/requests?scope=${scope}`),
  request: (igdbId: number, platformId: number) => call<{ request: GameRequest }>('POST', '/requests', { igdbId, platformId }),
  approve: (id: number, note?: string) => call<{ request: GameRequest }>('POST', `/requests/${id}/approve`, { note }),
  decline: (id: number, note?: string) => call<{ request: GameRequest }>('POST', `/requests/${id}/decline`, { note }),
  retry: (id: number) => call<{ request: GameRequest }>('POST', `/requests/${id}/retry`, {}),
  remove: (id: number) => call<void>('DELETE', `/requests/${id}`),
  users: () => call<{ users: AdminUser[] }>('GET', '/admin/users'),
  updateUser: (id: number, patch: Partial<{ isAdmin: boolean; autoApprove: boolean; requestLimit: number | null }>) =>
    call<{ user: AdminUser }>('PATCH', `/admin/users/${id}`, patch),
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  available: 'Ready to play',
  declined: 'Declined',
  failed: 'Failed',
};
