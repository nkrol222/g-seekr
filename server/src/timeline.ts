import type { RetroArrGameHunt } from './retroarr.js';
import type { GameRequest, RequestEvent } from './store.js';

// A request's timeline, in plain words. Everyone sees the steps and where it's at; admins also see the detail behind
// it (the release, why one wasn't grabbed, the error).

export type StepKey = 'requested' | 'approved' | 'looking' | 'downloading' | 'library' | 'romm';
export type StepState = 'done' | 'current' | 'waiting' | 'failed';

export interface TimelineStep {
  key: StepKey;
  label: string;
  state: StepState;
  at: string | null;
  // What's happening now, or what happened, in plain words
  detail: string | null;
  // Admins only: the release, the reason, the error
  adminDetail: string | null;
  // When the next try is (a search), for "next look at 6 pm", and when the last one was
  nextAt: string | null;
  lastAt: string | null;
}

export interface TimelineEntry {
  at: string;
  text: string;
  adminDetail: string | null;
}

export interface Timeline {
  steps: TimelineStep[];
  // The step it's at, for a one-line status on the request's card
  current: TimelineStep;
  history: TimelineEntry[];
}

const LABELS: Record<StepKey, string> = {
  requested: 'Requested',
  approved: 'Approved',
  looking: 'Looking for a copy',
  downloading: 'Downloading',
  library: 'Added to the library',
  romm: 'Ready in RomM',
};

const ORDER: StepKey[] = ['requested', 'approved', 'looking', 'downloading', 'library', 'romm'];

function huntText(hunt: RetroArrGameHunt | undefined, monitoring: boolean): { detail: string; admin: string | null; nextAt: string | null; at: string | null } {
  const last = hunt?.lastSearch ?? null;
  const nextAt = hunt?.nextSearchAt ?? null;
  const again = nextAt ? null : monitoring ? 'It’ll be looked for again later.' : null;
  if (!last) {
    return {
      detail: nextAt ? 'Not looked for yet.' : 'Waiting for its first search.',
      admin: monitoring ? null : 'RetroArr’s monitoring is off, so it won’t search on its own.',
      nextAt,
      at: null,
    };
  }
  const text: Record<string, string> = {
    Grabbed: 'Found a copy.',
    NothingFound: 'No copy found yet.',
    NoneGoodEnough: 'Copies were found, but none good enough yet.',
    NotGrabbed: 'Found a copy; it’ll start downloading shortly.',
    Failed: 'Couldn’t look just now.',
  };
  const best = last.release ? `Best: ${last.release}${last.score !== null ? ` (score ${last.score})` : ''}` : null;
  const admin = [
    `${last.found} release(s) found, ${last.rejected} rejected${last.automatic ? '' : ' (searched by hand)'}`,
    last.outcome === 'Grabbed' ? (last.release ? `Grabbed ${last.release}` : null) : best,
    last.reason,
    monitoring ? null : 'RetroArr’s monitoring is off, so it won’t search again on its own.',
  ]
    .filter(Boolean)
    .join('. ');
  return { detail: [text[last.outcome] ?? 'Looked for it.', again].filter(Boolean).join(' '), admin: admin || null, nextAt, at: last.at };
}

export function buildTimeline(r: GameRequest, events: RequestEvent[], hunt: RetroArrGameHunt | undefined, monitoring = true): Timeline {
  const step = (key: StepKey, state: StepState, extra: Partial<TimelineStep> = {}): TimelineStep => ({
    key,
    label: LABELS[key],
    state,
    at: null,
    detail: null,
    adminDetail: null,
    nextAt: null,
    lastAt: null,
    ...extra,
  });
  const last = (kind: RequestEvent['kind']) => [...events].reverse().find((e) => e.kind === kind) ?? null;
  const steps: TimelineStep[] = [step('requested', 'done', { at: r.createdAt, detail: null })];

  // Approval
  const decision = last('approved') ?? last('declined');
  if (r.status === 'pending') steps.push(step('approved', 'current', { label: 'Approval', detail: 'Waiting for an admin to approve it.' }));
  else if (r.status === 'declined')
    steps.push(step('approved', 'failed', { label: 'Declined', at: r.decidedAt, detail: r.note ? `Declined: ${r.note}` : 'Declined by an admin.' }));
  else
    steps.push(
      step('approved', 'done', {
        at: r.decidedAt ?? decision?.at ?? null,
        detail: r.decidedBy === r.userId ? 'Approved automatically.' : r.note,
        adminDetail: decision?.actor ? `By ${decision.actor}` : null,
      }),
    );

  // Looking for a copy
  const grabbed = last('downloading') ?? last('grabbed');
  const lastFailure = [...events].reverse().find((e) => e.kind === 'searching' && e.error);
  const failedAfterGrab = lastFailure && grabbed && lastFailure.at >= grabbed.at;
  if (r.status === 'approved') {
    steps.push(step('looking', 'current', { detail: 'Being handed to the downloader.' }));
  } else if (r.status === 'searching') {
    const h = huntText(hunt, monitoring);
    steps.push(
      step('looking', 'current', {
        at: last('searching')?.at ?? r.decidedAt,
        lastAt: h.at,
        detail: failedAfterGrab ? `The last download didn’t work out, so it’s looking for another copy. ${h.detail}` : h.detail,
        adminDetail: [failedAfterGrab ? `Download failed: ${lastFailure!.error}` : null, h.admin].filter(Boolean).join('. ') || null,
        nextAt: h.nextAt,
      }),
    );
  } else if (r.status === 'failed') {
    steps.push(step('looking', 'failed', { label: 'Something went wrong', detail: 'An admin can retry it.', adminDetail: r.error }));
  } else if (['downloading', 'available'].includes(r.status)) {
    steps.push(step('looking', 'done', { at: grabbed?.at ?? null, detail: 'Found a copy.', adminDetail: r.release }));
  }

  // Downloading
  if (r.status === 'downloading') steps.push(step('downloading', 'current', { at: grabbed?.at ?? null, adminDetail: r.release }));
  else if (r.status === 'available') steps.push(step('downloading', 'done', { at: grabbed?.at ?? null }));

  // In the library, then in RomM
  if (r.status === 'available') {
    steps.push(step('library', 'done', { at: r.availableAt }));
    steps.push(
      r.rommId
        ? step('romm', 'done', { at: last('in_romm')?.at ?? null, detail: 'Ready to play.' })
        : step('romm', 'current', { detail: 'Being added to RomM, usually within the hour.' }),
    );
  }

  // The steps still to come
  const reached = new Set(steps.map((s) => s.key));
  if (r.status !== 'declined' && r.status !== 'failed') {
    for (const key of ORDER) if (!reached.has(key)) steps.push(step(key, 'waiting', key === 'approved' ? { label: 'Approval' } : {}));
  }
  steps.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const current = steps.find((s) => s.state === 'current' || s.state === 'failed') ?? steps[steps.length - 1]!;

  const history: TimelineEntry[] = events.map((e) => ({ at: e.at, ...describe(e) }));
  return { steps, current, history };
}

function describe(e: RequestEvent): { text: string; adminDetail: string | null } {
  switch (e.kind) {
    case 'requested':
      return { text: 'Requested', adminDetail: e.actor ? `By ${e.actor}` : null };
    case 'pending':
      return { text: 'Waiting for approval', adminDetail: null };
    case 'approved':
      return { text: 'Approved', adminDetail: [e.actor ? `By ${e.actor}` : null, e.note].filter(Boolean).join(': ') || null };
    case 'declined':
      return { text: e.note ? `Declined: ${e.note}` : 'Declined', adminDetail: e.actor ? `By ${e.actor}` : null };
    case 'searching':
      return e.error ? { text: 'The download didn’t work out; looking for another copy', adminDetail: e.error } : { text: 'Looking for a copy', adminDetail: null };
    case 'downloading':
    case 'grabbed':
      return { text: 'Found a copy; downloading', adminDetail: e.release };
    case 'available':
      return { text: 'Added to the library', adminDetail: e.release };
    case 'in_romm':
      return { text: 'Ready in RomM', adminDetail: null };
    case 'failed':
      return { text: 'Something went wrong', adminDetail: e.error };
    default:
      return { text: e.kind, adminDetail: null };
  }
}

// What a user who isn't an admin sees: no releases, errors or names
export function forUser(t: Timeline): Timeline {
  const strip = (s: TimelineStep): TimelineStep => ({ ...s, adminDetail: null });
  return {
    steps: t.steps.map(strip),
    current: strip(t.current),
    history: t.history.map((h) => ({ ...h, adminDetail: null })),
  };
}
