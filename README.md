# yahoo-fantasy-sync

Local TypeScript/Node.js application that reads two independent 2026 Yahoo Fantasy Football leagues and publishes analysis tables to two personal Google Sheets:

| CLI selector | Local Yahoo league ID setting | Local spreadsheet title setting |
| --- | --- | --- |
| `bao` | `BAO_LEAGUE_ID` | `BAO_SPREADSHEET_TITLE` |
| `standard` | `STANDARD_LEAGUE_ID` | `STANDARD_SPREADSHEET_TITLE` |

Yahoo game keys, actual league names, team counts, ownership, scoring and roster requirements are discovered and validated from Yahoo. Each league's scoring is retrieved independently. Personal league IDs, configured display names, and spreadsheet titles live only in an ignored local `.env`; the public repository contains no personal league identities. The `bao` and `standard` selectors remain stable CLI aliases. There are no Yahoo write operations. No database or deployed server is required.

**Current setup state:** implementation and offline tests are complete. Real league existence, account access, actual settings, and Google writes must be verified with your credentials. The tests use explicitly synthetic fixtures; their game keys, counts, names and players are not live league results.

## Public homepage and privacy policy

The static GitHub Pages website lives in `docs/`. Its homepage describes the personal, non-commercial application and links to a separate privacy policy covering the actual Google Sheets scope, local OAuth storage, data use, retention, and revocation.

After publishing from this repository's `main` branch and `/docs` folder:

- Homepage: <https://stevechanlee.github.io/yahoo-fantasy-sync/>
- Privacy policy: <https://stevechanlee.github.io/yahoo-fantasy-sync/privacy.html>

See [the publishing and Google ownership-verification guide](guides/github-pages.md) for enabling Pages, checking the public URLs, updating Google OAuth branding, and handling the distinction between a project URL-prefix property and domain ownership. These URLs are deployment targets until the changes are pushed and Pages is enabled. This website does not host the synchronization app or accept credentials.

## 1. Node.js and installation

Use **Node.js 24 LTS**, including the native Apple Silicon (`arm64`) version on an M-series Mac. The default Node v12 found on this workspace is too old. Install the Node 24 macOS installer from [nodejs.org](https://nodejs.org/en/download), or, if you already use nvm:

```bash
cd yahoo-fantasy-sync
nvm install 24
nvm use 24
node --version
npm ci
# For a new checkout only; keep an existing .env unchanged:
test -f .env || cp .env.example .env
chmod 600 .env
npm run check
```

`node --version` should start with `v24.`. With another Node installation method, omit the two nvm commands. Run all commands from this project directory. The lockfile pins dependencies; `npm ci` is reproducible. Source execution uses the tsx loader; `npm run build` also produces runnable JavaScript in `dist/`.

Populate `BAO_LEAGUE_ID`, `BAO_LEAGUE_NAME`, `BAO_SPREADSHEET_TITLE`, `STANDARD_LEAGUE_ID`, `STANDARD_LEAGUE_NAME`, and `STANDARD_SPREADSHEET_TITLE` in your ignored `.env` before using the CLI. Both IDs must be distinct positive numeric Yahoo league IDs. Display names are used for progress and errors; the returned Yahoo name is authoritative after verification. On the original development Mac, the existing personal league settings have already been migrated to `.env`, with mode `0600`; OAuth credentials remain blank. Tests use separate synthetic identities and do not require your private configuration or OAuth.

### VS Code terminal

The shared workspace settings select a macOS Bash login terminal named **Project Bash (nvm)**. With [nvm installed](https://github.com/nvm-sh/nvm#installing-and-updating), ensure your shell startup files load it:

```bash
# In ~/.bashrc (or ~/.zshrc for zsh):
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# A Bash login shell also needs ~/.bash_profile to source ~/.bashrc.
```

On the original development Mac, nvm, a native arm64 Node 24 runtime, and these shell startup entries have been installed. `.nvmrc` selects the project major version and `engine-strict=true` rejects incompatible dependency installations. The system's older Node installation remains available independently.

Close existing VS Code terminals using the trash icon, then choose **Terminal → New Terminal** so the new startup configuration loads. In the project terminal, run:

```bash
command -v node
node --version
npm --version
node -p 'process.arch'
npm run check
```

Expected: an nvm-managed Node path, `v24.x`, a working npm version, `arm64` on Apple Silicon, and a successful build/test run. Existing terminal sessions retain their previous PATH until restarted. To refresh an existing Bash terminal instead, run `source ~/.bash_profile` followed by `nvm use`. No OAuth commands are needed for local development checks.

## 2. Configure Yahoo access — first credential checkpoint

1. Sign into the Yahoo account that manages your teams. Visit the [Yahoo Fantasy developer portal](https://sports.yahoo.com/developer/) and [apply for API access](https://sports.yahoo.com/developer/access/). Yahoo currently reviews applications and provisions access after approval; merely creating OAuth credentials does not establish Fantasy API access.
2. Create or locate your application at [Yahoo Developer Apps](https://developer.yahoo.com/apps/). Name it `yahoo-fantasy-sync`. Select an installed/personal app if offered, and configure the documented **`oob`** redirect for the local verification-code flow. If the console requires a web application type to expose this flow, that app type still works with `oob`. Use the exact credentials and redirect Yahoo provisions for your approved application. This implementation intentionally requires `oob`; it does not need a public callback URL.
3. Request **Fantasy Sports read access (`fspt-r`)**. Do not enable read/write permissions. Include the application Client ID in your access application. If Yahoo asks for confirmation after approval, use its [application confirmation page](https://sports.yahoo.com/developer/application-confirmation/).
4. A suitable use-case description is: “Personal local read-only synchronization of my two 2026 fantasy football leagues into private Google Sheets for weekly analysis. One user. League metadata, settings, standings, rosters, available players, matchups and recent completed transactions. No roster, waiver, or trade mutations.” Provide your own league IDs privately if Yahoo requests them, and provide the remaining application information truthfully.
5. Edit `.env` locally:

```dotenv
YAHOO_CLIENT_ID=your_consumer_key
YAHOO_CLIENT_SECRET=your_consumer_secret
YAHOO_REDIRECT_URI=oob
```

Do not paste secrets or verification codes into chat, source code, issue reports or Git. The two credential values can contain punctuation; quote values in `.env` if needed, especially if they contain `#`.

## 3. Authorize Yahoo and verify both leagues

```bash
npm run auth:yahoo
```

Open the printed URL in your system browser, sign into the team-owning Yahoo account, approve read access, then paste Yahoo's verification code into the **local terminal**. The URL contains the public client ID and temporary state, not your client secret. Tokens are stored in `.state/yahoo-token.json` with mode `0600`, and refresh automatically.

```bash
npm run verify:yahoo
```

This performs the complete Yahoo read workflow for **both leagues**, saves normalized JSON exports, and makes **no Google calls**. Verification requires the exact league ID and season, a complete standings team count, and an identifiable team owned by the signed-in account. It also retrieves each league's settings, every roster, FA and waiver pages, current-week scoreboard and recent transactions. A complete result exits `0`; a partial result or inaccessible league exits `1` and lists the affected endpoints.

Inspect `snapshots/bao/latest.json` and `snapshots/standard/latest.json`. Confirm `league.leagueKey`, `league.season`, `league.myTeamKey`, `league.numTeams` and `settings.status`. Inspect `settings.data` for the returned Superflex slots and bonus thresholds. If Yahoo marks multiple teams as owned by you, set `BAO_TEAM_KEY` or `STANDARD_TEAM_KEY` to a full owned key, then rerun. Unowned keys are rejected.

**Stop here until Yahoo verification succeeds.** A nonexistent or inaccessible league is reported rather than substituted with another season or league. Authentication cannot verify league existence before account access is granted.

## 4. Configure Google OAuth — second credential checkpoint

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Sheets API** in APIs & Services → Library. A billing account and Drive API are not required for this workflow.
3. Configure the Google Auth Platform consent screen (Branding / Audience). For a personal Gmail account choose External; while Testing, add your own email as a test user.
4. In Clients, create an OAuth client with application type **Desktop app**. Download its JSON file.
5. Store that file at `.credentials/google-client.json`, or set `GOOGLE_CLIENT_FILE` to its path:

```bash
mkdir -p .credentials
# Move the downloaded Desktop OAuth JSON to .credentials/google-client.json.
chmod 700 .credentials
chmod 600 .credentials/google-client.json
npm run auth:google
```

Open the printed URL, choose the **personal Google account that should own the sheets**, and grant spreadsheet access. A temporary HTTP callback listens only on `127.0.0.1` on a random available port and closes after authorization or a five-minute timeout. State validation and PKCE protect the flow. There is no persistent server. A Web application credential JSON is rejected; use Desktop app JSON containing an `installed` object.

The only Google scope requested is `https://www.googleapis.com/auth/spreadsheets`. This supports creating spreadsheets and accessing explicitly configured existing sheets without Drive-wide file access. It grants read/write access to spreadsheets in the authorized account; neither Gmail nor general Drive scopes are requested. Offline refresh tokens are stored in `.state/google-token.json` with mode `0600`.

```bash
npm run verify:google
```

Expected: `Google OAuth and Sheets API connectivity verified. No files created.` This authenticates a read of an intentionally nonexistent ID and expects Google's `404`; `401`/`403` are failures. The first actual sync verifies creation and write permissions.

Testing-mode Google consent grants for external apps may expire after seven days. Reauthorize when needed or change the project's publishing status appropriately; see Google's [refresh token expiration documentation](https://developers.google.com/identity/protocols/oauth2#expiration). Publishing an OAuth consent configuration is separate from deploying this local application.

## 5. Synchronize

```bash
npm run sync
npm run sync:bao
npm run sync:standard
```

Run the first command to synchronize both leagues; the next two are alternatives for one league. First sync creates two separate spreadsheets in the authorized account's Drive root. Their titles match your local `*_SPREADSHEET_TITLE` settings, and their IDs are persisted in `.state/spreadsheets.json`. Subsequent runs reuse those IDs. Keep that file backed up privately.

To use existing dedicated spreadsheets, put their IDs in `.env` before the first sync:

```dotenv
BAO_SPREADSHEET_ID=first_spreadsheet_id
STANDARD_SPREADSHEET_ID=second_spreadsheet_id
```

Use the part between `/d/` and `/edit` in a Google Sheets URL. The IDs must differ. Existing sync tabs must be empty or already bound by this app to the same league; unrelated tabs are left alone. Spreadsheet developer metadata binds each file to a full Yahoo league key. Cross-league writes and a different season are rejected even if an incorrect ID is configured.

The summary prints actual Yahoo league name, team count, roster player count, available player count (FA plus W), UTC sync timestamp and spreadsheet URL. Failed counts display `unknown`, not zero. Every report is saved to `.state/last-run.json`. A failed league does not prevent attempting the other league. A partial failure exits `1`, even when other datasets were successfully published.

Use a single process and a single `DATA_DIR` for these sheets. A heartbeat lock prevents overlapping local sync/auth processes and protects refreshed tokens, registry updates and history writes. It does not coordinate different computers or different state directories writing to the same spreadsheet. Do not manually edit, delete or concurrently write the app-managed tabs or History while syncing.

## Spreadsheet schemas and analysis

Every data row carries `league_key`, `season`, `fantasy_week` and `sync_at`. Identifiers are literal strings, preserving full Yahoo keys. Multi-valued fields use JSON arrays, avoiding ambiguous comma parsing. Numeric zero is numeric zero. Missing/unprovided or inapplicable data becomes JSON `null` and an empty Sheets cell. An absent injury designation does not certify health.

| Tab | Row grain and main fields |
| --- | --- |
| Dashboard | One metric per row: verified identity, week, team key, counts, filters, dataset status and its last successful source timestamp, capability notes and errors |
| My Roster | One player on your team, including `selected_position`, `roster_group` (`starter`, `bench`, `IR`), eligible positions, injury status, NFL team and bye when provided |
| Standings | One team: rank, wins/losses/ties, points for/against, waiver priority, FAAB balance if provided, `is_my_team` |
| All Rosters | One player per team; includes every team plus your team, `team_key` and `team_name` |
| Free Agents | One unique `player_key` from `status=FA`; scoped by configured position filters |
| Waivers | One unique `player_key` from `status=W`; independent of free-agent pagination |
| Matchups | One team per current-week matchup, opponent key, score, status, winner, playoff flag and team projected points if returned |
| Scoring Settings | One setting leaf per row: `setting_type`, exact `setting_path`, `stat_id`, `stat_name`, original `value` and unambiguous `value_json`; includes roster counts, scoring multipliers, nested thresholds/bonuses and all other returned settings |
| Transactions | One player action per recent transaction; multi-player adds/drops/trades share a full `transaction_key`. Transactions with no players retain a row with null player fields. Includes source/destination team keys and event time |
| History | Content-addressed dataset snapshots with manifest and JSON record fragments; reconstruction described below |

Entity tabs include `raw_json` so additional Yahoo-returned fields remain available without guessing new semantics. Complete settings are retained in JSON exports and represented as exact leaf paths in Sheets. Headers are frozen, filters support sorting, standings default to rank order, and available players default to name order.

Player weekly points or projections appear only if Yahoo returns them in the requested official response. This app does **not** scrape Yahoo UI, call private projection APIs, invent zero projections, or compute approximate points under complex bonus rules. The official documented resources used here do not expose a general player-projections endpoint. Usually `weekly_points` and `projected_points` in player tabs will be blank and `projection_status=not_provided_by_official_api`; team projections returned in the scoreboard are retained separately. Missing bye weeks, injury details and FAAB data remain missing.

For ChatGPT, provide the appropriate spreadsheet URL through your connected Drive/Sheets tools. A useful instruction is: “Read Dashboard first. Check dataset statuses and timestamps, then use this league's Scoring Settings and roster requirements. Join on full Yahoo keys. Treat missing projections as missing and do not combine leagues.” This project does not itself configure ChatGPT connectors or share your files publicly.

## History, backups and failure behavior

Before any Google writes, each attempt saves a normalized JSON export at `snapshots/<league>/latest.json`. A content-addressed `2026-<sha256>.json` file is created only for new snapshot content; timestamp-only reruns reuse the same content file. Exports contain no OAuth tokens. They do contain private fantasy data, including any manager fields Yahoo returns, so keep them private.

History is tracked independently per dataset. Its snapshot ID hashes the league, fantasy week, dataset schema, filters, transaction limit and content, excluding sync time. Identical content already present for that week/dataset is not appended again, including after a reversion to previously seen content. Week changes create new snapshots. Failed datasets do not create history rows.

`History` columns: `snapshot_id`, `league_key`, `season`, `fantasy_week`, `captured_at`, `dataset`, `entity_index`, `chunk_index`, `chunk_count`, `json_fragment`. A manifest uses `entity_index=-1`, describes schema and row count, and represents even an empty dataset. For each entity, group by `(snapshot_id, entity_index)`, sort numerically by `chunk_index`, concatenate `json_fragment`, and JSON-parse. Entity records have their original column names; `captured_at` supplies the snapshot timestamp. JSON strings inside fields such as `raw_json` or `eligible_positions_json` can then be parsed separately. This format preserves complete history without trying to fit a league snapshot in a 50,000-character cell.

Only fully fetched and validated datasets replace current tabs. A failed page invalidates the entire FA or W dataset; a failed team roster preserves All Rosters but can still update your own successfully fetched roster. Metadata/standings/ownership verification failure aborts that league before Google writes. Valid empty datasets clear stale rows; missing response containers are errors. Repeated pagination pages, count mismatches, wrong-game keys, duplicate roster players and contradictory availability are rejected.

The successful tabs, Dashboard, history additions and any new tab/binding setup are sent as **one atomic `spreadsheets.batchUpdate` per league**, with no clear-before-fetch operation. If Google rejects the batch, the old values remain. GETs retry rate limits, server errors and network failures with capped exponential backoff/jitter and `Retry-After`. Writes and rotating OAuth exchanges are never automatically replayed after ambiguous failures. A definitive `401` triggers one token refresh/retry. After an uncertain Sheets update, rerun; history IDs are read from the spreadsheet before writing, preventing duplicate snapshots after an already committed response was lost.

Spreadsheet creation records a pending intent first. If its response is lost, the next run pauses creation to avoid duplicate files. Find the titled spreadsheet in Drive and set its ID in `.env`. If you have verified no spreadsheet was created, back up `.state/spreadsheets.json` and remove only that league's `creationPending` entry. Existing local snapshots are never removed by sync.

There is no automatic retention deletion. At Google's 10-million-cell spreadsheet limit, archive history to a private backup file/spreadsheet before continuing; keep the current week's history IDs if you trim old rows so current snapshots remain deduplicated. Batches over the 40 MB local safety cap or individual cells over 45,000 UTF-16 code units fail before submission. Narrowing `PLAYER_POSITIONS` can reduce available-player volume, and is explicitly recorded as dataset coverage; an empty setting retrieves all positions. Google recommends small payloads for speed, so full unfiltered player pools may take longer. Yahoo reads span time rather than a transactional instant; overlap checks detect obvious mid-sync roster/availability changes, but rerun if changes occur during a long sync.

## Configuration

See [.env.example](.env.example). `PLAYER_POSITIONS=QB,RB,WR,TE,K,DEF` is optional; leaving it empty avoids assumptions about IDP or flex eligibility. Each status/position pair starts its own pagination at zero, advances by the actual returned count, and continues until a validated empty page. Position unions are deduplicated by full player key. A safety limit of 1,000 pages per pair fails explicitly rather than truncating.

`TRANSACTION_COUNT=100` requests the most recent completed transactions; it does not promise an all-season transaction archive. It is bounded to 1–1,000 in config. One transaction can produce multiple action rows. Weekly historical transaction views accrue as new/changed snapshots are observed. `DATA_DIR` and `SNAPSHOT_DIR` default to the ignored `.state/` and `snapshots/` directories; keep custom locations private and add them to your own ignore rules if inside a repository.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Old Node / unknown `--import` / engine error | Install/select Node 24, verify `node --version`, then run `npm ci` |
| Yahoo `invalid_scope`, `401`, or `403` | Confirm the correct app Client ID, read scope, Fantasy API approval/provisioning and team-owning Yahoo account; use Yahoo's confirmation page if instructed. Reauthorize after changes. Repeated token refresh does not grant API access |
| Yahoo redirect rejected | Use the same documented `oob` redirect in Yahoo and `.env`; check the configuration Yahoo supplied with your application approval |
| League not found or ownership ambiguous | Verify year, league IDs and account; inspect verification errors. Configure a full owned team key only when needed |
| Google `access_denied` | Add your account as a test user, choose that account, and check consent settings |
| Google Desktop JSON invalid | Download a Desktop app client, not a Web/service-account credential; set `GOOGLE_CLIENT_FILE` correctly |
| Google `403` | Enable Sheets API in the OAuth project's console, confirm edit access for configured IDs and spreadsheet scope; check quota, then rerun |
| Google refresh rejected | Run `npm run auth:google`; check Testing-mode token expiry, revoked access or changed credentials |
| Google callback timeout | Run auth again, use the system browser and allow local loopback access; consent must finish within five minutes |
| Rate limit / network timeout | GETs retry automatically. Wait and rerun after a final error. Ambiguous writes reconcile on the next run |
| Partial sync | Read the printed errors, `.state/last-run.json` and Dashboard; failed tabs retain their prior source timestamp. Fix the endpoint failure and rerun |
| Another process holds lock | Let the active command finish. A crashed process's stale lock can be recovered after 60 seconds; do not remove a live process's lock |
| Wrong league binding / populated unbound sync tabs | Use a different empty dedicated spreadsheet or the correct previously created ID; the app deliberately refuses cross-league overwrites |
| Lost local state | Restore `.state/spreadsheets.json` or set both IDs in `.env` before syncing; history deduplication is reconciled from Sheets |

## Development and validation

```bash
npm run check
node dist/cli.js --help
```

Tests cover XML singleton/empty responses and identity preservation, independent league rules/counts, complete starters/bench/IR, multi-position FA/W pagination and short pages, failures, OAuth rotation/permissions, retries, literal cell strings, history deduplication, empty datasets, atomic failure/lost-response recovery, cross-league isolation, creation recovery, JSON exports and both-league orchestration against mocked APIs. No tests contact private Yahoo/Google APIs or change live files.

The auth and REST clients are separate from normalization, schema generation and orchestration. Provider response bodies and authorization headers are never printed in errors. Secrets/tokens, state, exports, build output and downloaded client credential names are excluded by `.gitignore`. Application-owned state and token files are written atomically with mode `0600`; the default state directory uses `0700`. Keep `.env` and downloaded client JSON protected locally too.

Official references: [Yahoo Fantasy API resources and filters](https://sports.yahoo.com/developer/docs/), [Yahoo OAuth authorization code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/), [Google desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Google Sheets REST API](https://developers.google.com/workspace/sheets/api/reference/rest), [Sheets atomic batch semantics](https://developers.google.com/workspace/sheets/api/guides/batch).
