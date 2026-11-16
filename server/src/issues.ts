import type { Notifier } from './notify.js';
import { RequestError, type Logger, type RetroArrEventData } from './requests.js';
import { RetroArrError, type RetroArrClient } from './retroarr.js';
import { ISSUE_KINDS, type Issue, type IssueKind, type Store, type User } from './store.js';

export const ISSUE_LABEL: Record<IssueKind, string> = {
  wont_launch: 'Won’t launch',
  wrong_game: 'Wrong game',
  wrong_region: 'Wrong region or language',
  missing_files: 'Missing files or discs',
  other: 'Something else',
};

export const isIssueKind = (v: unknown): v is IssueKind => typeof v === 'string' && (ISSUE_KINDS as string[]).includes(v);

// Problems with a game that's ready to play, like Seerr's issues:
//   open ──replace──▶ replacing ──RetroArr imports the new release──▶ resolved
//     └──resolve (an admin's note)──────────────────────────────────▶ resolved
// Replace blocklists the release in RetroArr and grabs another; while that downloads, the old release stays playable.
export class IssueService {
  constructor(
    private readonly store: Store,
    private readonly retroarr: RetroArrClient,
    private readonly notifier: Notifier,
    private readonly log: Logger,
    private readonly isAdmin: (user: User) => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  report(user: User, requestId: number, kind: IssueKind, message: string | null): Issue {
    const request = this.store.request(requestId);
    if (!request || (request.userId !== user.id && !this.isAdmin(user))) throw new RequestError('Request not found.', 404, 'not_found');
    if (request.status !== 'available') throw new RequestError('Problems can be reported once a game is ready to play.', 409, 'wrong_status', request);
    if (this.store.unresolvedIssueFor(requestId)) throw new RequestError('A problem with this game has already been reported.', 409, 'already_reported');
    let issue: Issue;
    try {
      issue = this.store.createIssue({ requestId, userId: user.id, kind, message });
    } catch {
      // Lost a race with another report
      throw new RequestError('A problem with this game has already been reported.', 409, 'already_reported');
    }
    this.log.info(`issue ${issue.id}: ${user.username} reported ${kind} on request ${requestId}`);
    void this.notifier.issueReported(issue, ISSUE_LABEL[kind]);
    return issue;
  }

  list(user: User, all: boolean): Issue[] {
    return this.store.listIssues(all && this.isAdmin(user) ? {} : { userId: user.id });
  }

  // Blocklists the reported release in RetroArr and grabs another. Nothing to grab yet: the report stays open and says so.
  async replace(admin: User, id: number): Promise<Issue> {
    const issue = this.mustGet(id);
    if (issue.status !== 'open') throw new RequestError(`Only open reports can be replaced (this one is ${issue.status}).`, 409, 'wrong_status');
    if (issue.retroarrGameId === null) throw new RequestError('This request isn’t linked to a game in RetroArr.', 409, 'no_game');

    const reason = `${ISSUE_LABEL[issue.kind]}${issue.message ? `: ${issue.message}` : ''} (reported by ${issue.username} in g-seekr)`;
    let result;
    try {
      result = await this.retroarr.replace(issue.retroarrGameId, reason);
    } catch (err) {
      if (err instanceof RetroArrError && (err.status === 409 || err.status === 404)) {
        throw new RequestError(err.message.replace(/^RetroArr answered \d+: /, ''), 409, 'cannot_replace');
      }
      throw err;
    }

    let updated: Issue;
    if (result.autoQueued) {
      updated = this.store.updateIssue(id, { status: 'replacing', replacementRelease: result.release, resolution: null })!;
      this.log.info(`issue ${id}: ${admin.username} replaced ${result.blocklisted ?? 'the release'} with ${result.release ?? 'another release'}`);
    } else {
      const why = result.error ?? result.skipped ?? 'nothing qualified for download';
      updated = this.store.updateIssue(id, {
        resolution: `${result.blocklisted ? 'The reported release is blocklisted, but n' : 'N'}o replacement was grabbed yet: ${why}. Try again later.`,
      })!;
      this.log.info(`issue ${id}: ${admin.username} asked for a replacement, none grabbed: ${why}`);
    }
    void this.notifier.issueChanged(updated);
    return updated;
  }

  resolve(admin: User, id: number, note: string | null): Issue {
    const issue = this.mustGet(id);
    if (issue.status === 'resolved') throw new RequestError('This report is already resolved.', 409, 'wrong_status');
    const updated = this.store.updateIssue(id, {
      status: 'resolved',
      resolution: note ?? 'Resolved by an admin.',
      resolvedBy: admin.id,
      resolvedAt: this.now().toISOString(),
    })!;
    this.log.info(`issue ${id}: resolved by ${admin.username}`);
    void this.notifier.issueChanged(updated);
    return updated;
  }

  // RetroArr's webhooks for a game being replaced. Returns how many reports changed.
  handleRetroArrEvent(event: string, data: RetroArrEventData): number {
    const gameId = typeof data.gameId === 'number' ? data.gameId : null;
    if (gameId === null) return 0;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const replacing = this.store.listIssues({ statuses: ['replacing'] }).filter((i) => i.retroarrGameId === gameId);
    let changed = 0;
    for (const issue of replacing) {
      let updated: Issue | null;
      switch (event) {
        case 'OnDownloadStarted':
          updated = this.store.updateIssue(issue.id, { replacementRelease: text(data.release) ?? issue.replacementRelease, resolution: null });
          break;
        case 'OnDownloadCompleted': {
          const release = text(data.release) ?? issue.replacementRelease;
          // The request now has the replacement
          if (release) this.store.updateRequest(issue.requestId, { release });
          updated = this.store.updateIssue(issue.id, {
            status: 'resolved',
            resolution: `Replaced${release ? ` with ${release}` : ''}.`,
            resolvedAt: this.now().toISOString(),
          });
          void this.notifier.issueChanged(updated!);
          break;
        }
        case 'OnDownloadFailed': {
          const reason = text(data.reason);
          updated = this.store.updateIssue(issue.id, {
            resolution: `The replacement’s download failed${reason ? `: ${reason}` : ''}. RetroArr is searching again.`,
          });
          break;
        }
        case 'OnGameRemoved':
          updated = this.store.updateIssue(issue.id, {
            status: 'resolved',
            resolution: 'The game was removed from RetroArr.',
            resolvedAt: this.now().toISOString(),
          });
          break;
        default:
          continue;
      }
      if (updated) changed++;
    }
    return changed;
  }

  private mustGet(id: number): Issue {
    const issue = this.store.issue(id);
    if (!issue) throw new RequestError('Report not found.', 404, 'not_found');
    return issue;
  }
}
