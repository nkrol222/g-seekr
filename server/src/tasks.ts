import type { Db } from './db.js';
import type { Logger } from './requests.js';

export type TaskOutcome = 'succeeded' | 'failed' | 'skipped';

// A timed job, as RetroArr's and Sonarr's System → Tasks list them
export interface TaskDefinition {
  key: string;
  name: string;
  description: string;
  // Default interval in seconds; 0 = off
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  canTurnOff: boolean;
  // How long after start it first runs when it's due, so a restart doesn't start everything at once
  firstRunMs: number;
  // Returns a one-line summary; throw TaskSkipped to say why it didn't run
  run: () => Promise<string | null>;
}

export class TaskSkipped extends Error {}

export interface TaskStatus {
  key: string;
  name: string;
  description: string;
  intervalSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  canTurnOff: boolean;
  running: boolean;
  queued: boolean;
  startedAt: string | null;
  lastStarted: string | null;
  lastFinished: string | null;
  lastDurationMs: number | null;
  lastOutcome: TaskOutcome | null;
  lastMessage: string | null;
  nextRun: string | null;
}

interface Row {
  interval_seconds: number | null;
  last_started: string | null;
  last_finished: string | null;
  last_duration_ms: number | null;
  last_outcome: string | null;
  last_message: string | null;
}

const MAX_SLEEP_MS = 30_000;

// Runs g-seekr's timed jobs one at a time, in the order they come due, so they never pile onto RetroArr together.
// Each runs one interval after its last run finished (kept in the database across restarts); one that's due at
// start waits its own delay first.
export class TaskRunner {
  private readonly tasks = new Map<string, TaskDefinition>();
  private readonly queue: string[] = [];
  private running: { key: string; startedAt: Date } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private bootedAt: Date;
  private drain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    definitions: TaskDefinition[],
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const d of definitions) this.tasks.set(d.key, d);
    this.bootedAt = now();
  }

  start(): void {
    this.stopped = false;
    this.bootedAt = this.now();
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // For tests and shutdown: wait for what's queued and running
  idle(): Promise<void> {
    return this.drain;
  }

  statuses(): TaskStatus[] {
    return [...this.tasks.values()].map((t) => this.statusOf(t));
  }

  status(key: string): TaskStatus | null {
    const t = this.tasks.get(key);
    return t ? this.statusOf(t) : null;
  }

  setInterval(key: string, seconds: number): TaskStatus {
    const t = this.mustGet(key);
    if (!Number.isInteger(seconds)) throw new RangeError('The interval is a whole number of seconds.');
    if (seconds === 0 && !t.canTurnOff) throw new RangeError(`${t.name} can’t be turned off.`);
    if (seconds !== 0 && (seconds < t.minSeconds || seconds > t.maxSeconds)) {
      throw new RangeError(`${t.name} runs every ${describe(t.minSeconds)} to ${describe(t.maxSeconds)}${t.canTurnOff ? ', or 0 for off' : ''}.`);
    }
    this.ensureRow(key);
    this.db.prepare('UPDATE tasks SET interval_seconds = ? WHERE key = ?').run(seconds, key);
    this.log.info(`task ${t.name}: every ${seconds ? describe(seconds) : 'off'}`);
    this.reschedule();
    return this.statusOf(t);
  }

  // Queues it now; false when it's already running or queued
  runNow(key: string): boolean {
    this.mustGet(key);
    if (this.running?.key === key || this.queue.includes(key)) return false;
    this.enqueue(key);
    return true;
  }

  // When it runs next; null = off
  nextRun(key: string): Date | null {
    const t = this.mustGet(key);
    const interval = this.intervalOf(t);
    if (interval <= 0) return null;
    const firstSlot = new Date(this.bootedAt.getTime() + t.firstRunMs);
    const last = this.row(key)?.last_finished;
    if (!last) return firstSlot;
    const due = new Date(new Date(last).getTime() + interval * 1000);
    return due < firstSlot ? firstSlot : due;
  }

  private tick(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    let soonest = Infinity;
    const now = this.now().getTime();
    for (const t of this.tasks.values()) {
      const next = this.nextRun(t.key);
      if (!next || this.running?.key === t.key || this.queue.includes(t.key)) continue;
      if (next.getTime() <= now) this.enqueue(t.key);
      else soonest = Math.min(soonest, next.getTime());
    }
    const wait = Math.max(1000, Math.min(MAX_SLEEP_MS, soonest - now));
    this.timer = setTimeout(() => this.tick(), wait);
    this.timer.unref?.();
  }

  private reschedule(): void {
    if (!this.stopped) this.tick();
  }

  private enqueue(key: string): void {
    this.queue.push(key);
    this.drain = this.drain.then(() => this.runNext());
  }

  private async runNext(): Promise<void> {
    const key = this.queue.shift();
    if (!key) return;
    const t = this.tasks.get(key)!;
    const startedAt = this.now();
    this.running = { key, startedAt };
    this.ensureRow(key);
    this.db.prepare('UPDATE tasks SET last_started = ? WHERE key = ?').run(startedAt.toISOString(), key);
    const t0 = Date.now();
    let outcome: TaskOutcome = 'succeeded';
    let message: string | null;
    try {
      message = await t.run();
    } catch (err) {
      if (err instanceof TaskSkipped) {
        outcome = 'skipped';
        message = err.message;
      } else {
        outcome = 'failed';
        message = (err as Error).message;
        this.log.warn(`task ${t.name} failed: ${message}`);
      }
    }
    const ms = Date.now() - t0;
    this.db
      .prepare('UPDATE tasks SET last_finished = ?, last_duration_ms = ?, last_outcome = ?, last_message = ? WHERE key = ?')
      .run(this.now().toISOString(), ms, outcome, message, key);
    if (outcome !== 'skipped' && (outcome === 'failed' || ms > 5000)) this.log.info(`task ${t.name}: ${outcome} in ${(ms / 1000).toFixed(1)}s${message ? `: ${message}` : ''}`);
    this.running = null;
    this.reschedule();
  }

  private statusOf(t: TaskDefinition): TaskStatus {
    const row = this.row(t.key);
    const running = this.running?.key === t.key;
    const next = running ? null : this.nextRun(t.key);
    return {
      key: t.key,
      name: t.name,
      description: t.description,
      intervalSeconds: this.intervalOf(t),
      minSeconds: t.minSeconds,
      maxSeconds: t.maxSeconds,
      canTurnOff: t.canTurnOff,
      running,
      queued: this.queue.includes(t.key),
      startedAt: running ? this.running!.startedAt.toISOString() : null,
      lastStarted: row?.last_started ?? null,
      lastFinished: row?.last_finished ?? null,
      lastDurationMs: row?.last_duration_ms ?? null,
      lastOutcome: (row?.last_outcome as TaskOutcome | null) ?? null,
      lastMessage: row?.last_message ?? null,
      nextRun: next ? next.toISOString() : null,
    };
  }

  private intervalOf(t: TaskDefinition): number {
    return this.row(t.key)?.interval_seconds ?? t.defaultSeconds;
  }

  private row(key: string): Row | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE key = ?').get(key) as Row | undefined;
  }

  private ensureRow(key: string): void {
    this.db.prepare('INSERT OR IGNORE INTO tasks (key) VALUES (?)').run(key);
  }

  private mustGet(key: string): TaskDefinition {
    const t = this.tasks.get(key);
    if (!t) throw new RangeError(`No task “${key}”.`);
    return t;
  }
}

export function describe(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}
