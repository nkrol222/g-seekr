import type { GameRequest } from './store.js';

// Discord messages for new requests and for changes the requester cares about.
// Plain text with mentions switched off, so a game title can't ping @everyone.
export class Notifier {
  constructor(
    private readonly webhookUrl: string | null,
    private readonly log: { warn: (msg: string) => void },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private label(r: GameRequest): string {
    return `**${r.title}**${r.year ? ` (${r.year})` : ''} for ${r.platformName}`;
  }

  async requestCreated(r: GameRequest): Promise<void> {
    await this.send(
      r.status === 'pending'
        ? `🎮 ${r.username} requested ${this.label(r)}. It's waiting for approval.`
        : `🎮 ${r.username} requested ${this.label(r)}. It was approved automatically.`,
    );
  }

  async statusChanged(r: GameRequest): Promise<void> {
    const note = r.note ? ` Note: ${r.note}` : '';
    switch (r.status) {
      case 'available':
        return this.send(`✅ ${this.label(r)} is ready to play, ${r.username}.`);
      case 'declined':
        return this.send(`❌ ${r.username}'s request for ${this.label(r)} was declined.${note}`);
      case 'failed':
        return this.send(`⚠️ ${r.username}'s request for ${this.label(r)} couldn't be sent to RetroArr: ${r.error ?? 'unknown error'}`);
      default:
        return;
    }
  }

  private async send(content: string): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.log.warn(`Discord webhook answered ${res.status}`);
    } catch (err) {
      this.log.warn(`Discord webhook failed: ${(err as Error).message}`);
    }
  }
}
