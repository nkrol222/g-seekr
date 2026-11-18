# g-seekr compared with Seerr: the gaps

g-seekr follows Seerr's flow: Jellyfin sign-in, then request, approval and hand-off, then
status. The first version covers that core loop and little more. This page lists what Seerr
(Jellyseerr/Overseerr) does that g-seekr doesn't yet, so the gaps can be closed in order.

"Depends on" names other work that has to land first:
- **A4:** custom formats and quality profiles (RetroArr fork);
- **A6:** status webhooks (RetroArr fork);
- **RSS:** RSS sync (RetroArr gap 2);
- **IGDB:** an IGDB endpoint RetroArr doesn't expose to the `requests` scope yet.

Status as of 2026-11-17.

## 1. Discovery and recommendations

Seerr opens on discovery. g-seekr opens on an empty search box.

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Discover page with sliders: trending, popular, upcoming, recently added | Done: popular right now (IGDB popularity), top rated, recently added to the library, popular per requestable platform, plus request rows | Upcoming releases (left out for now) | – |
| Browse by genre, studio or network | Done: a Browse page and filtered search, with platform, genre, year range, rating and rating count, game mode, theme, and an adult-games switch (off by default). Filters are saved per user | Developer or publisher, franchise | – |
| Detail page per title: overview, cast, trailers, ratings, where it's available | Done: a game page with backdrop, summary and story, request per platform, trailers, screenshots, facts, first release per platform, similar games | – | – |
| "Recommendations" and "Similar" on each title | Done: similar games, more from the series and more from the developer on the game page | – | – |
| Personal recommendations (from your watch history and watchlist) | Done: a For you page and Discover rows from requests, likes and RomM play history (each user links their own RomM token), with the reasons; "not interested" hides a game | Weigh what the household plays | – |
| Collections (a film series), with what's available and "Request collection" | Done: a Collections page and Discover rows (featured, popular, yours in progress). A collection is an IGDB series or a list admins put together or import (plain titles, a No-Intro/Redump DAT, an Internet Archive item; uncertain matches are reviewed before saving). The user picks a platform; "Request missing" makes one request per game the library doesn't have, within their limit | – | – |
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
| Download progress on the request ("Processing 43%") | Done: grabbed (with the release), a progress bar in percent while it downloads (asked every 10 s), imported, and a failed download with its reason | – | – |
| Marked available when the library has it, even unrequested | "In the library" from RetroArr's `isOwned` | Also check RomM (what people actually see), so games added by hand show as available | RomM API access |
| A deep link to the item in Jellyfin | A link to RomM's home page | Link to the game itself in RomM, looked up by IGDB id | RomM API access |

## 3. Issues

| Seerr | g-seekr today | To close it | Depends on |
|---|---|---|---|
| Users report problems with available media (video, audio, subtitles), and admins resolve them | Done: "Report a problem" on a game that's ready (won't launch, wrong game, wrong region or language, missing files or discs, something else). The Issues page lists them; an admin replaces the release (RetroArr blocklists it and grabs another, which replaces it on import) or resolves with a note. Discord is told | Comments both ways on a report | – |

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
| Configured in the web UI (servers, profiles, users, notifications) | Environment variables only | A Settings page for what changes at runtime (limits, notifications); secrets stay in env. The requestable platforms already follow RetroArr's enabled platforms | – |
| Several Sonarr/Radarr servers, and a default per type | One RetroArr | Several RetroArr instances or profiles, e.g. a separate one for PC games | A4 |
| API with an API key; Homepage widget type | Session-cookie API; Homepage shows only up/down | API keys for integrations; a summary endpoint (pending, processing, available counts) that Homepage's `customapi` widget can read | – |
| ~~Status updates in real time~~ | Done: RetroArr's webhooks, with the 5-minute poll as a backstop | – | – |
| Translated into many languages | English only | i18n, starting with the languages RetroArr already ships | – |
| Installable PWA, responsive | Responsive page, no PWA | Manifest, icons, service worker (needed for web push) | – |
| Request statistics, recently requested | None | An admin dashboard: requests over time, top requesters, fulfilment time, failure reasons | – |

## Suggested order

1. ~~**Live status and issues.**~~ Done: progress in percent, failure reasons, problem reports with a one-click replace.
2. ~~**Discovery basics.**~~ Done: Discover rows, Browse with filters, filtered search and a game page, from IGDB through RetroArr (its requests scope).
3. ~~**Recommendations.**~~ Done: For you page, Discover rows, game page rows, likes, "not interested", RomM history.
4. **Request options**, once A4 lands: a release preference per request.
5. **Permissions, notifications and settings UI**, as more people use it.
6. **Watchlist** with auto-request on release, after RetroArr's RSS sync.
