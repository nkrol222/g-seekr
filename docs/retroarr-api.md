# g-seekr ↔ RetroArr

g-seekr talks to RetroArr (`nkrol222/retroarr`) with a token that has only the `requests` scope.
Everything g-seekr asks of RetroArr goes through `server/src/retroarr.ts`. The request lifecycle
(`server/src/requests.ts`) depends only on `RequestBackend`, the part of that client it needs.

## Who decides what

| g-seekr | RetroArr |
| --- | --- |
| who may request, limits, approval, duplicates among requests | which library entry is which version (region, variant) |
| what was asked for: game, platform, version, updates and DLC, ROM hack | the entry's metadata, folder, monitoring and searching |
| telling the requester (timeline, Discord) | whether the library has it, and its state |

g-seekr never sends a game model and never decides whether the library has a version: it asks.

## The request API (`/api/v3/requests`, API version 1)

Errors answer `{ code, message }` with a 4xx or 5xx status. A 502 `metadata_unavailable` means
RetroArr couldn't reach IGDB; g-seekr shows it as "try again".

| Call | Body | Answer |
| --- | --- | --- |
| `GET info` | | `{ apiVersion, appVersion, features }` |
| `POST check` | `{ igdbId, platformId, region, variant }` | `{ game: { igdbId, title, year, coverUrl, platformIds }, entries, match, owned }`; 404 `unknown_game` |
| `POST fulfil` | `{ kind: "game", igdbId, platformId, region, variant, latestRevision, addOns? }` | `{ gameId, state, added }` |
| | `{ kind: "addons", igdbId, platformId, region, variant, addOns }` | 409 `not_in_library` unless owned |
| | `{ kind: "hack", hackId }` | `{ gameId, state, baseGameId, baseState }` |
| `POST states` | `{ gameIds }` (at most 500) | `{ games: [{ gameId, state, region, variant }] }` |

`addOns` is `{ latestUpdate, allDlc, dlc: [{ igdbId, title }] }`; RetroArr adds to what it wants of
the game and never takes a want away.

An entry's `state` and the request status g-seekr gives it:

| state | meaning | request |
| --- | --- | --- |
| `wanted` | monitored, not in the library yet | `searching` |
| `unmonitored` | not looked for | `searching` |
| `downloading` | a release is being fetched | `downloading` |
| `available` | in the library | `available` |
| `removed` | the entry is gone | `failed` |

Fulfil is idempotent: asking again, or two approvals at once, gives the same entry.

## The other calls (reads)

`GET /platform`, `GET /game/lookup` (search), `GET /downloadclient/queue/games` (progress),
`GET /games/search-status` (timeline), `GET /games/{id}/addons` (has the DLC come in),
`GET /romhacks`, the `/discover` reads, and `POST /games/{id}/replace` (a user's problem report).
Webhooks from RetroArr (`OnDownloadStarted`, `OnDownloadCompleted`, `OnDownloadFailed`,
`OnGameRemoved`) move requests between polls.

## Versions and deploying

g-seekr checks `apiVersion` at start-up (an error in the log) and in Settings → Connections →
Test. A change that breaks the contract raises the version on both sides. Deploy RetroArr first:
a RetroArr with the request API still answers an older g-seekr's reads, but the older g-seekr's
hand-offs (raw `POST /game`) are refused, so update g-seekr right after.
