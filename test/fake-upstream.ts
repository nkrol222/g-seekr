// A fake Jellyfin and RetroArr on one port, for running g-seekr locally without either:
//   npm run dev:fake        (Jellyfin at /jf, RetroArr at /ra, users alice/bob/root, password "pw")
// then start g-seekr with JELLYFIN_URL=http://127.0.0.1:5099/jf RETROARR_URL=http://127.0.0.1:5099/ra
// RETROARR_TOKEN=rat_xxx… (43 x). POST /ra/_import/{gameId} marks a game downloaded.
import { createServer } from 'node:http';
import { Fakes, JELLYFIN, RETROARR } from './fakes.js';

const fakes = new Fakes();
// More of a catalogue to look at than the unit tests need
for (const [id, title, year, platforms] of [
  [1103, 'Super Metroid', 1994, [41]],
  [1026, 'The Legend of Zelda: A Link to the Past', 1991, [41]],
  [1068, 'Super Mario World', 1990, [41]],
  [1074, 'Super Mario 64', 1996, [50]],
  [1009, 'Final Fantasy VI', 1994, [41, 50]],
  [1029, 'Castlevania: Symphony of the Night', 1997, [50]],
  [1121, 'Metal Gear Solid', 1998, [50]],
  [1079, 'Secret of Mana', 1993, [41]],
  [1131, 'Chrono Cross', 1999, [50]],
] as const) fakes.catalogue.set(id, { title, year, platforms: [...platforms] });
// Series for the collection pages, and what the import matcher "finds"
fakes.franchises.set(5, { name: 'Final Fantasy', games: [427, 1009] });
fakes.franchises.set(6, { name: 'Chrono', games: [1020, 1131] });
fakes.franchises.set(7, { name: 'Super Mario', games: [1068, 1074] });
fakes.franchises.set(9, { name: 'Mana', games: [1079] });
fakes.matches.set('Super Metroid', [[1103, 1]]);
fakes.matches.set('Secret of Mana', [[1079, 0.97]]);
fakes.matches.set('Zelda', [[1026, 0.62]]);
fakes.matches.set('Mario', [[1068, 0.55], [1074, 0.52]]);
const port = Number(process.env.FAKE_PORT ?? 5099);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = req.url ?? '/';
  // POST /ra/_queue/{gameId}/{percent}: the download client reports that much of the game's release
  const q = url.match(/^\/ra\/_queue\/(\d+)\/(\d+)$/);
  if (q) {
    const gameId = Number(q[1]);
    const game = fakes.games.find((g) => g.id === gameId);
    fakes.queue = [...(fakes.queue ?? []).filter((d) => d.gameId !== gameId), { gameId, release: `${game?.title ?? 'Game'} (USA)`, progress: Number(q[2]), state: 'Downloading', trackedState: 'Downloading' }];
    res.writeHead(204).end();
    return;
  }
  const m = url.match(/^\/ra\/_import\/(\d+)$/);
  if (m) {
    const game = fakes.games.find((g) => g.id === Number(m[1]));
    if (game) game.status = 4;
    res.writeHead(game ? 204 : 404).end();
    return;
  }
  const target = url.startsWith('/jf/') ? JELLYFIN + url.slice(3) : url.startsWith('/ra/') ? RETROARR + url.slice(3) : null;
  if (!target) {
    res.writeHead(404).end();
    return;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  try {
    const upstream = await fakes.fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks).toString() : undefined });
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.writeHead(502).end(String(err));
  }
}).listen(port, '127.0.0.1', () => console.log(`fake Jellyfin/RetroArr on http://127.0.0.1:${port}`));
