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
| `searching` | RetroArr has the game, monitored, and is looking for a release. Its monitored sweep keeps searching. After a failed download the request says why, and RetroArr searches again by itself. |
| `downloading` | RetroArr grabbed a release (shown on the request), or reports the game downloading. |
| `available` | RetroArr imported it. The request links to RomM. |
| `declined` | An admin said no, optionally with a note. |
| `failed` | RetroArr refused or couldn't be reached. An admin can retry. |

Each request on **Requests** shows where it's at in plain words, for example "Looking for a copy:
no copy found yet. Next look today 6:00 pm". **Details** opens its timeline:

| Step | What it says |
|---|---|
| Requested | when |
| Approval / Approved | "Waiting for an admin to approve it" until then |
| Looking for a copy | the outcome of RetroArr's last search and the next one |
| Downloading | live progress |
| Added to the library | when |
| Ready in RomM | when, with a Play button |

The search outcome is one of: no copy found yet; copies found but none good enough yet; found one;
couldn't look just now. A History list underneath records each change.

Admins also see the detail behind each step: the release, the best one RetroArr found and why it
wasn't grabbed, who approved it, and the error. Users see plain steps only. The search status comes
from RetroArr's `/api/v3/games/search-status` (fork). An older RetroArr just leaves out the search
detail.

The hand-off works like this:
1. g-seekr reuses RetroArr's existing entry for that IGDB game and platform. If there isn't one, it adds the game with RetroArr's IGDB metadata.
2. It sets the game to monitored.
3. It starts a search with automatic grabbing.

RetroArr's webhooks move a request as things happen: a grab makes it `downloading`, an import
`available`, and a failed download leaves it `searching` with the reason. A removed game fails it.
They need `RETROARR_WEBHOOK_TOKEN`; see "RetroArr webhook" below. Every `POLL_SECONDS` (default
5 minutes), g-seekr also checks the games it handed off, which catches anything a webhook missed.

### Tasks

Admins see g-seekr's timed jobs under **Tasks**: how often each runs (changeable there; the
interval is kept in the database), how the last run went, when the next one is, and **Run now**.
They run one at a time, and after a restart each waits its own delay, so RetroArr isn't asked for
everything at once:

| Task | Default | What it does |
|---|---|---|
| Follow requests | `POLL_SECONDS` (5 min) | The backstop for missed webhooks, and links ready requests to the game in RomM. |
| Warm up Discover | 5 h | Loads Discover's rows and the popular collections ahead of time, so the page opens fast. RetroArr keeps IGDB answers for 6 h. |
| Housekeeping | 24 h | Deletes expired sign-ins, and list imports saved more than 30 days ago. |

## Rules

- **One open request per game and platform.** A second request is refused with "already requested". A game that's already downloaded is refused with "already in the library".
- **Request limit:** `REQUEST_LIMIT` per user every `REQUEST_LIMIT_DAYS`. Admins can change the limit per user. Admins themselves have no limit.
- **Platforms:** exactly those enabled in RetroArr (Settings → Platforms); a change there shows within two minutes. A game can only be requested for platforms IGDB lists it on.
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

### IGDB

Discover, Browse, game pages, series and list imports come from IGDB. With `IGDB_CLIENT_ID` and
`IGDB_CLIENT_SECRET` set, g-seekr asks IGDB itself, with its own Twitch app. That app gets its own
4 requests a second, separate from RetroArr's, and g-seekr keeps the answers six hours in its
database, so they survive a restart. What the library has of each game still comes from RetroArr, in
one call per page. Without them, it all goes through RetroArr, as before.

To create the app: [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register
Your Application**: any name, OAuth redirect `http://localhost`, category **Application
Integration**, client type **Confidential**. Copy the client ID, then press **New Secret**.

### Recommendations and RomM

The **For you** page and Discover's "Recommended for you" and "Because you …" rows come from
each user's requests, likes (♥ on a game's page) and, once they link it, their RomM history: IGDB's
similar games and series for each, best shared first. A game rated 1–3 in RomM, or marked "not
interested", never comes back. The user's saved filters apply, except themes and game modes.

Linking RomM needs `ROMM_API_URL` (RomM's API as g-seekr reaches it, e.g. its tailnet URL). Each
user then makes a client token in RomM (**Settings → Client API Tokens**, scopes "View your
profile" and "View ROMs") and pastes it under **Account → RomM link**. g-seekr checks that the
token's RomM username is the user's own (usernames match between Jellyfin and RomM), keeps it in
its database, and never sends it back to the browser.

### Collections

The **Collections** page (and Discover's collection rows) shows IGDB series and lists. On a
collection the user picks a platform, sees how much of it the library has ("3 of 5 on
PlayStation"), and **Request missing** makes one request per game that the library doesn't have and
nobody has requested yet. Each counts against the user's limit and is approved like any other
request; games not on that platform are greyed out.

Admins make lists by hand or import them (**Collections → Import a list**) from pasted titles, a
No-Intro or Redump DAT, or an Internet Archive item (g-seekr reads `archive.org/metadata/<id>`, so
it needs to reach archive.org). Titles are matched on IGDB through RetroArr for one platform, about
four a second. Confident matches are chosen; the rest wait on a review page, where the admin picks a
candidate, searches, or skips each one, then saves. A ★ puts a series or list in Discover's
"Featured collections" row.

### Playing it: RomM

RomM's library is what counts as owned. RetroArr's RomM sync (RetroArr → Settings → RomM)
keeps RetroArr's library in step with RomM and records each game's RomM id. With that:
- a game page shows **Play in RomM** for each platform RomM has it on, or **In the library** while
  RomM hasn't scanned it yet;
- a ready request gets **Play in RomM**, linking to the game itself (`ROMM_URL/rom/<id>`). Until
  RomM has the game, which is usually within the hour of the import, it says it's being added.

### RetroArr webhook

So requests update the moment RetroArr grabs, imports or fails a download:
1. Generate a secret, `openssl rand -hex 32`, and set it as `RETROARR_WEBHOOK_TOKEN`.
2. In RetroArr → **Settings → Webhooks**, add one:
   - URL `https://<g-seekr>/api/webhooks/retroarr`, method `POST`;
   - events `OnDownloadStarted`, `OnDownloadCompleted`, `OnDownloadFailed` and `OnGameRemoved`;
   - headers `{"X-Webhook-Token": "<the secret>"}`;
   - no payload template.
3. Press **Test**. g-seekr answers `{"updated": 0}` for the test event; a wrong token gets `401`.

Without the variable the endpoint answers `404` and only the poller runs. The token is compared in
constant time. The endpoint takes no session or CSRF header, since RetroArr isn't a browser.

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
