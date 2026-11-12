// A fake Jellyfin and RetroArr on one port, for running g-seekr locally without either:
//   npm run dev:fake        (Jellyfin at /jf, RetroArr at /ra, users alice/bob/root, password "pw")
// then start g-seekr with JELLYFIN_URL=http://127.0.0.1:5099/jf RETROARR_URL=http://127.0.0.1:5099/ra
// RETROARR_TOKEN=rat_xxx… (43 x). POST /ra/_import/{gameId} marks a game downloaded.
import { createServer } from 'node:http';
import { Fakes, JELLYFIN, RETROARR } from './fakes.js';

const fakes = new Fakes();
const port = Number(process.env.FAKE_PORT ?? 5099);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = req.url ?? '/';
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
