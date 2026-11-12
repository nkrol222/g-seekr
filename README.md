# g-seekr

Game requests for Jellytime, built on the same model as Seerr. People sign in with their
Jellyfin account, search for a game, and request it for a platform. An admin approves the
request, and g-seekr hands the game to RetroArr (`nkrol222/retroarr`). RetroArr adds the game,
monitors it and searches for it. The requester can follow the request until it's ready to
play in RomM.

```
browser ── g-seekr ──sign-in──▶ Jellyfin
              │
              └──token (requests scope)──▶ RetroArr ──▶ Prowlarr / qBittorrent ──▶ ROM library ──▶ RomM
```

## How a request moves

| Status | Meaning |
|---|---|
| `pending` | Waiting for an admin. Admins' own requests, and those of users set to auto-approve, skip this. |
| `approved` | Being handed to RetroArr. |
| `searching` | RetroArr has the game, monitored, and is looking for a release. Its monitored sweep keeps searching. |
| `downloading` | RetroArr reports the game downloading. |
| `available` | RetroArr imported it. The request links to RomM. |
| `declined` | An admin said no, optionally with a note. |
| `failed` | RetroArr refused or couldn't be reached. An admin can retry. |

The hand-off works like this:
1. g-seekr reuses RetroArr's existing entry for that IGDB game and platform. If there isn't one, it adds the game with RetroArr's IGDB metadata.
2. It sets the game to monitored.
3. It starts a search with automatic grabbing.

Every `POLL_SECONDS` (default 5 minutes), g-seekr checks the games it handed off and updates
their status. RetroArr's status webhooks (fork step A6) will replace the polling later.

## Rules

- **One open request per game and platform.** A second request is refused with "already requested". A game that's already downloaded is refused with "already in the library".
- **Request limit:** `REQUEST_LIMIT` per user every `REQUEST_LIMIT_DAYS`. Admins can change the limit per user. Admins themselves have no limit.
- **Platforms:** only those enabled in RetroArr, optionally narrowed with `ALLOWED_PLATFORMS`. A game can only be requested for platforms IGDB lists it on.
- **Admins** are Jellyfin admins (unless `JELLYFIN_ADMINS_ARE_ADMINS=false`) and anyone made admin on the Users page. The first Jellyfin admin to sign in always becomes one.
- **Withdrawing:** requesters can withdraw their own pending requests. Admins can remove any request; RetroArr keeps the game.

## Security

- **Passwords** are checked against Jellyfin and never stored. g-seekr closes the Jellyfin session the check opens.
- **Sessions** use a random 256-bit ID in an `httpOnly`, `SameSite=Lax` and (by default) `Secure` cookie. Only its SHA-256 is stored.
- **CSRF:** every change needs the `x-gseekr: 1` header, which another site can't send without a CORS preflight that g-seekr never grants. When `PUBLIC_URL` is set, changes from any other `Origin` are refused too.
- **Sign-in throttling:** after 5 failed sign-ins per username, or 10 per client address, within 15 minutes, further attempts are refused until the window passes.
- **RetroArr access** uses a scoped token (`requests`), never the instance API key. The config refuses anything that isn't a `rat_…` token. With that token RetroArr refuses deletes, settings and token management.
- **Discord messages** are sent with mentions disabled, so a game title can't ping anyone.
- **Headers:** responses carry a strict Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff`.

## Configuration

Everything comes from environment variables. [`.env.example`](.env.example) lists them with
their defaults. `JELLYFIN_URL`, `RETROARR_URL` and `RETROARR_TOKEN` are required.

To create the RetroArr token: RetroArr → **Settings → API access → Tokens for other apps**.
Name it `g-seekr`, tick only `requests`, and copy the `rat_…` value. It's shown once.

## Running it

```bash
docker run -d --name g-seekr -p 127.0.0.1:5056:5056 -v ./data:/data --env-file .env ghcr.io/nkrol222/g-seekr:main
```

- **Data:** the SQLite database is `/data/g-seekr.db`. The image runs as `node` (1000:1000); with compose `user:`, make `/data` writable by that user.
- **Health check:** `GET /api/health`.
- **TLS:** serve it behind a proxy that terminates TLS (Tailscale Serve, Caddy), and set `TRUST_PROXY` so client addresses are right.

## Compared with Seerr

[`docs/seerr-gaps.md`](docs/seerr-gaps.md) lists what Seerr does that g-seekr doesn't yet,
including discovery, recommendations, live progress, issue reports, permissions and
notifications. It also says what each gap depends on and suggests an order.

## Development

```bash
npm ci
npm run dev:fake        # fake Jellyfin + RetroArr on :5099 (users alice, bob, root; password "pw")
JELLYFIN_URL=http://127.0.0.1:5099/jf RETROARR_URL=http://127.0.0.1:5099/ra \
  RETROARR_TOKEN=rat_$(printf 'x%.0s' $(seq 43)) DATA_DIR=./data SECURE_COOKIES=false \
  npm run dev:server    # API on :5056
npm run dev:web         # UI on :5173, proxying /api
```

With the fake running, `POST /ra/_import/{gameId}` marks a game as downloaded.

Checks (the same ones CI runs): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

Stack:
- Node 22 with Fastify 5;
- SQLite through the built-in `node:sqlite`, so there's no native module to compile;
- React 19 with Vite 6;
- Vitest. The tests run the whole app in-process, with fake Jellyfin, RetroArr and Discord behind a stubbed `fetch`.
