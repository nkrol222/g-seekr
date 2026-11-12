import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { JellyfinClient } from './jellyfin.js';
import { RetroArrClient } from './retroarr.js';

const config = loadConfig();
const db = openDb(join(config.dataDir, 'g-seekr.db'));
const here = dirname(fileURLToPath(import.meta.url));

const { app, requests } = await buildApp({
  config,
  db,
  jellyfin: new JellyfinClient(config.jellyfinUrl),
  retroarr: new RetroArrClient(config.retroarrUrl, config.retroarrToken),
  webDir: join(here, '..', 'web'),
});

// Follow handed-off requests until RetroArr has imported them
let polling = false;
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    await requests.poll();
  } finally {
    polling = false;
  }
};
const timer = setInterval(() => void poll(), config.pollSeconds * 1000);

// Say early whether the token works, without refusing to start: RetroArr may just be down
app.ready().then(async () => {
  try {
    await requests.platforms();
    app.log.info('RetroArr reachable, token accepted');
  } catch (err) {
    app.log.warn(`RetroArr check failed: ${(err as Error).message}`);
  }
});

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
