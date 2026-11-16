# g-seekr compared with Seerr: the gaps

g-seekr follows Seerr's flow: Jellyfin sign-in, then request, approval and hand-off, then
status. The first version covers that core loop and little more. This page lists what Seerr
(Jellyseerr/Overseerr) does that g-seekr doesn't yet, so the gaps can be closed in order.

"Depends on" names other work that has to land first:
- **A4:** custom formats and quality profiles (RetroArr fork);
- **A6:** status webhooks (RetroArr fork);
- **RSS:** RSS sync (RetroArr gap 2);
- **IGDB:** an IGDB endpoint RetroArr doesn't expose to the `requests` scope yet.

Status as of 2026-11-14.

## 1. Discovery and recommendations

Seerr opens on discovery. g-seekr opens on an empty search box.

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Discover page with sliders: trending, popular, upcoming, recently added | Search only | Sliders backed by IGDB: popular (IGDB's popularity data), upcoming releases, recently released, "recently added to the library". Admins choose which sliders show | IGDB: RetroArr needs `requests`-scoped endpoints for IGDB lists (popular, upcoming by platform), or g-seekr gets its own IGDB credentials |
| Browse by genre, studio or network | None | Browse by platform (the one that matters most for ROMs), genre, franchise, developer/publisher, and era (decade) | IGDB |
| Detail page per title: overview, cast, trailers, ratings, where it's available | A result card with a three-line overview | A game page: cover and screenshots, summary, genres, developer, release dates per platform, IGDB rating, trailer, the platforms you can request it for, and the request history | IGDB (screenshots, videos and ratings are in RetroArr's metadata object already; it needs a detail endpoint) |
| "Recommendations" and "Similar" on each title | None | IGDB's `similar_games` and franchise or collection siblings on the game page | IGDB |
| Personal recommendations (from your watch history and watchlist) | None | "Because you requested X": similar games to your past requests. "Because you played X": RomM play history (RomM keeps per-user data such as last played; what its API exposes needs checking), matched by IGDB id. Ranked by IGDB rating, filtered to platforms you can request, minus what's already in the library or requested | IGDB; RomM API access (a RomM token for g-seekr) |
| Watchlist, with auto-request from a Plex/Jellyfin watchlist | None | A "want to play" list per user, with optional auto-request when a game releases. Pairs with upcoming releases | RSS, so a new release is grabbed promptly |
| Hide titles (blocklist) | None | Admins hide a game or a whole platform from discovery and search | – |

## 2. Requests

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Request options: 4K vs standard, server and quality profile, root folder, seasons | Game and platform only | A choice of quality or release preference per request (e.g. "English patch", "decrypted 3DS", "USA region"), mapped to a RetroArr profile | A4 |
| Requests for several seasons, partially available | One platform per request | Request several platforms in one action, each tracked on its own | – |
| Edit a pending request (change options) | Withdraw and request again | Change the platform or preference while pending | – |
| Admins request on behalf of a user | None | "Request for…" in the admin view | – |
| Quotas per user and per media type, with global defaults | One limit per user, plus a global default | Separate limits per platform family, if that turns out to be useful | – |
| Comments on a request, both ways | One admin note on approve or decline | A comment thread per request; notifications on new comments | – |
| Download progress on the request ("Processing 43%") | Live from RetroArr's webhooks: grabbed (with the release), available, and a failed download with its reason | Progress in percent while downloading | A RetroArr queue endpoint in the `requests` scope |
| Marked available when the library has it, even unrequested | "In the library" from RetroArr's `isOwned` | Also check RomM (what people actually see), so games added by hand show as available | RomM API access |
| A deep link to the item in Jellyfin | A link to RomM's home page | Link to the game itself in RomM, looked up by IGDB id | RomM API access |

## 3. Issues

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Users report problems with available media (video, audio, subtitles), and admins resolve them | None | "Report a problem" on an available game: won't launch, wrong game, wrong region, missing discs, needs BIOS. Admins see a queue; "replace" blocklists the release in RetroArr and searches again | A `requests`-scoped RetroArr endpoint for "blocklist this game's release and search again" (the failed-download handling already does this internally) |

## 4. Users and permissions

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Granular permissions: request, auto-approve per type, view or manage requests, manage users, manage issues, advanced options | Admin and auto-approve only | Roles: requester, trusted (auto-approve), moderator (approve and decline), admin | – |
| Import Jellyfin users in bulk; local users; OIDC | Users appear at first sign-in; Jellyfin only | Import from Jellyfin. Optional Authentik OIDC sign-in, matching RomM's | – |
| Per-user settings: language, notification channels, quotas shown | None | A profile page: notification preferences, own quota and usage | – |

## 5. Notifications

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Discord, email, Telegram, Pushover, Gotify, ntfy, Slack, webhooks, web push; per user and per event | One Discord channel webhook | Per-user notifications: web push (PWA), and Discord DM or mention by linked Discord id. Per-event toggles. A generic webhook out | – |

## 6. Administration and integration

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Configured in the web UI (servers, profiles, users, notifications) | Environment variables only | A Settings page for what changes at runtime (limits, platforms, notifications); secrets stay in env | – |
| Several Sonarr/Radarr servers, and a default per type | One RetroArr | Several RetroArr instances or profiles, e.g. a separate one for PC games | A4 |
| API with an API key; Homepage widget type | Session-cookie API; Homepage shows only up/down | API keys for integrations; a summary endpoint (pending, processing, available counts) that Homepage's `customapi` widget can read | – |
| ~~Status updates in real time~~ | Done: RetroArr's webhooks, with the 5-minute poll as a backstop | – | – |
| Translated into many languages | English only | i18n, starting with the languages RetroArr already ships | – |
| Installable PWA, responsive | Responsive page, no PWA | Manifest, icons, service worker (needed for web push) | – |
| Request statistics, recently requested | None | An admin dashboard: requests over time, top requesters, fulfilment time, failure reasons | – |

## Suggested order

1. **Live status and issues:** grabbed, available and failed-with-reason are live since A6. Still to do: progress in percent, and "report a problem" with a one-click replace. These close the loop on what users already do.
2. **Discovery basics:** a game detail page, then sliders for popular, upcoming, recently added and by platform. This needs the IGDB endpoints in RetroArr, or g-seekr's own IGDB credentials. That choice is open: RetroArr already holds the credentials and the platform mapping, so extending its `requests` scope keeps one source of truth.
3. **Recommendations:** similar games on the detail page, then "because you requested" and "because you played", the latter from RomM.
4. **Request options**, once A4 lands: a release preference per request.
5. **Permissions, notifications and settings UI**, as more people use it.
6. **Watchlist** with auto-request on release, after RetroArr's RSS sync.
