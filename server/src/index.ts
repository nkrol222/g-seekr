import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { JellyfinClient } from './jellyfin.js';
import { REQUEST_API_VERSION, RetroArrClient } from './retroarr.js';
import { DirectIgdbRetroArrClient, IgdbApi } from './igdb.js';

const config = loadConfig();
const db = openDb(join(config.dataDir, 'g-seekr.db'));
const here = dirname(fileURLToPath(import.meta.url));

// With g-seekr's own IGDB app, the lists and game pages come straight from IGDB; the library and actions from RetroArr
const retroarr =
  config.igdbClientId && config.igdbClientSecret
    ? new DirectIgdbRetroArrClient(config.retroarrUrl, config.retroarrToken, new IgdbApi(config.igdbClientId, config.igdbClientSecret, db))
    : new RetroArrClient(config.retroarrUrl, config.retroarrToken);

const { app, requests, collections, tasks } = await buildApp({
  config,
  db,
  jellyfin: new JellyfinClient(config.jellyfinUrl),
  retroarr,
  webDir: join(here, '..', 'web'),
});

// The timed jobs (following requests, warming Discover, housekeeping): Tasks page
tasks.start();

// Say early whether the token works, without refusing to start: RetroArr may just be down
app.ready().then(async () => {
  // Imports that were still matching when g-seekr stopped carry on
  collections.resume();
  if (process.env.ALLOWED_PLATFORMS?.trim()) {
    app.log.warn('ALLOWED_PLATFORMS is ignored: people can request the platforms enabled in RetroArr (Settings → Platforms). Remove it from the env file.');
  }
  app.log.info(config.igdbClientId ? 'IGDB: asked directly with g-seekr’s own app' : 'IGDB: through RetroArr (set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to ask it directly)');
  try {
    await requests.platforms();
    app.log.info('RetroArr reachable, token accepted');
    // Requests are handed over through RetroArr's request API: say now when the two don't speak the same version
    const info = await retroarr.info();
    if (info.apiVersion !== REQUEST_API_VERSION) {
      app.log.error(`RetroArr's request API is version ${info.apiVersion}, g-seekr speaks ${REQUEST_API_VERSION}: requests will fail until both are updated`);
    }
  } catch (err) {
    app.log.warn(`RetroArr check failed: ${(err as Error).message}`);
  }
});

const shutdown = async () => {
  tasks.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
