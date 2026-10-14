# Project: NFT Radar Remediation & Verification

## Architecture
NFT Radar consists of seven integrated subsystems:
1. **Extension Client & DOM Parsing** (`extension/content.js`, `extension/tweet-parser.js`, `extension/moni-score.js`, `extension/filters.js`): MutationObserver timeline scraping, regex-based tweet metadata extraction, link and entity parsing, client-side filtering, and hovercard metric extraction.
2. **Extension Service Worker & Queue** (`extension/service-worker.js`, `extension/queue.js`, `extension/search-controller.js`, `extension/settings.js`, `extension/manifest.json`): Background MV3 lifecycle, in-memory and persistent queueing, exponential retry backoff, client-to-backend dispatch, EOD target crawler, and storage synchronization.
3. **Backend Express Ingest & Webhooks** (`vps_server.js`, `src/index.js`, `src/alchemy.js`): Ingestion API (`POST /ingest`), EVM webhook router (`POST /evm/webhook`), Alchemy payload decoding, and database batch execution.
4. **Deduplication, Concurrency & SQL Safety** (`src/dedupe.js`, `src/project-dedupe.js`, `src/project-key.js`, `src/parser.js`): Author and domain project key synthesis, atomic insertion / TOCTOU prevention, parameterized SQL queries, and LRU cache eviction.
5. **AI Classification, Opportunity Gating & Scoring** (`src/ai-classifier.js`, `src/opportunity-gate.js`, `src/quality-gate.js`, `src/scoring.js`): Prompt injection defenses / structured AI classification, regex discussion/action intent normalization, multi-factor scoring calculation, and quality gates.
6. **Telegram Broadcast, Formatting & Mini App APIs** (`src/formatter.js`, `src/daily-summary.js`, `src/telegram.js`, `src/telegram-bot.js`, `src/telegram-grammy.js`, `src/link-risk.js`, Mini App routes in `vps_server.js`): HTML parse entity escaping, message size clamping, rate-limiting queue, domain trust verification, and Telegram Mini App HMAC-SHA256 authentication.
7. **Empirical Verification & E2E Testing Track**: Dual-track test infrastructure, empirical proof suite resolving all 8 previously verified vulnerabilities, and end-to-end tweet lifecycle validation.

## Feature Inventory
| # | Feature / Issue Area | Description | Milestone | Source | Status |
|---|---------------------|-------------|-----------|--------|--------|
| 1 | A-01: Admin target proxy flag | Forward `isParserTarget` in `START_OBSERVER_PROXY` | M1 | AUDIT_REPORT §3.1 | DONE |
| 2 | A-02: Unicode ellipsis URL parsing | Strip trailing `…` and inspect title attribute to prevent 404 links | M1 | AUDIT_REPORT §3.1 | DONE |
| 3 | A-03: Trailing slash tweet_id | Use regex match `/\/status\/(\d+)/` to prevent empty ID | M1 | AUDIT_REPORT §3.1 | DONE |
| 4 | A-04: European comma parsing | Parse commas as decimal separators (`1,5M` -> 1,500,000) | M1 | AUDIT_REPORT §3.1 | DONE |
| 5 | A-05: False positive reply detection | Restrict "Replying to" check to parent header instead of full article text | M1 | AUDIT_REPORT §3.1 | DONE |
| 6 | A-06: Aggressive negative filter | Refine regex patterns in `filters.js` to avoid dropping valid mints | M1 | AUDIT_REPORT §3.1 | DONE |
| 7 | A-07: Uncaught IPC promise rejections | Add `.catch()` handlers to `chrome.runtime.sendMessage` | M1 | AUDIT_REPORT §3.1 | DONE |
| 8 | A-08: Moni heuristic validation | Restrict Moni parsing to verified classes and fallback gracefully | M1 | AUDIT_REPORT §3.1 | DONE |
| 9 | A-09: Crypto entity extraction | Extract EVM contracts, Solana base58 addresses, and cashtags | M1 | AUDIT_REPORT §3.1 | DONE |
| 10 | B-01: HoL queue deadlock on 401/403 | Find first ready queue item, increment retries on 401/403, fail after 3 | M2 | AUDIT_REPORT §3.2 | DONE |
| 11 | B-02: Cold-start storage clobber | Await `storageReady` in all top-level event and alarm listeners | M2 | AUDIT_REPORT §3.2 | DONE |
| 12 | B-03: EOD scan infinite loop | Increment `state.eodTargetIndex` in `finishCurrentQuery()` | M2 | AUDIT_REPORT §3.2 | DONE |
| 13 | B-04: Admin target quality gate drop | Add `!tweet.is_parser_target` exemption in `service-worker.js:383` | M2 | AUDIT_REPORT §3.2 | DONE |
| 14 | B-05: Missing fetch timeout | Add `AbortSignal.timeout(15000)` to all background fetch calls | M2 | AUDIT_REPORT §3.2 | DONE |
| 15 | B-06: Manifest storage & host perms | Add `"unlimitedStorage"` and host permissions in `manifest.json` | M2 | AUDIT_REPORT §3.2 | DONE |
| 16 | B-07: Storage quota leakage | Consolidate processed tweet tracking in bounded storage | M2 | AUDIT_REPORT §3.2 | DONE |
| 17 | B-08: Settings parseInt fallback | Provide fallback default when interval input is invalid | M2 | AUDIT_REPORT §3.2 | DONE |
| 18 | C-01: Express `req.json()` crash | Replace `await req.json()` with `req.body` in `/evm/webhook` | M3 | AUDIT_REPORT §3.3 | DONE |
| 19 | C-02: `ctx` and `processEvmQueue` | Fix `ctx` safety and port `processEvmQueue` implementation | M3 | AUDIT_REPORT §3.3 | DONE |
| 20 | C-03: DB batch statement mutation | Clone statement per `bind()` call to avoid shared closure mutation | M3 | AUDIT_REPORT §3.3 | DONE |
| 21 | C-04: Alchemy zero-value filter | Exempt `isERC721` transfers from zero ETH value check | M3 | AUDIT_REPORT §3.3 | DONE |
| 22 | C-05: Summary lock pre-auth DoS | Check authentication before acquiring `summaryLock` | M3 | AUDIT_REPORT §3.3 | DONE |
| 23 | C-06: Route error boundaries | Wrap `/ingest` and cron jobs in outer `try / catch` | M3 | AUDIT_REPORT §3.3 | DONE |
| 24 | D-01: TOCTOU concurrency race | Implement atomic `INSERT OR IGNORE` and activate mutex | M4 | AUDIT_REPORT §3.4 | DONE |
| 25 | D-02: SQL Injection in deduplication | Replace template strings with parameterized SQL bindings (`?`) | M4 | AUDIT_REPORT §3.4 | DONE |
| 26 | D-03: `__unknown__` author key drop | Isolate anonymous tweets by tweet ID to prevent false dedupe | M4 | AUDIT_REPORT §3.4 | DONE |
| 27 | D-04: Multi-tenant domain key collapse | Expand `SOCIAL_OR_OPAQUE_HOSTS` to include mirror, etherscan, etc. | M4 | AUDIT_REPORT §3.4 | DONE |
| 28 | D-05: Influencer 48-hour alert lockout | Discontinue author-only fallback; use tweet-specific project keys | M4 | AUDIT_REPORT §3.4 | DONE |
| 29 | D-06: Unbounded memory leak | Convert `chatInfoCache` and internal maps to bounded LRU caches | M4 | AUDIT_REPORT §3.4 | DONE |
| 30 | D-07: Inactive Mutex primitive | Connect `getLock(tweet_id)` to `/ingest` pipeline | M4 | AUDIT_REPORT §3.4 | DONE |
| 31 | D-08: Generic project name collisions | Filter generic names like "Free Mint" from generating colliding keys | M4 | AUDIT_REPORT §3.4 | DONE |
| 32 | E-01: Remote prompt injection | Defend prompt boundaries with strict escaping / structured inputs | M5 | AUDIT_REPORT §3.5 | DONE |
| 33 | E-02: Question mark false-drop | Remove `/\?/` from `DISCUSSION_PATTERNS`, prioritize action intent | M5 | AUDIT_REPORT §3.5 | DONE |
| 34 | E-03: Missing action patterns | Expand action patterns for airdrops, testnets, and exploits | M5 | AUDIT_REPORT §3.5 | DONE |
| 35 | E-04: Compound score penalty (-65) | Harmonize discussion penalty to prevent zeroing legitimate alpha | M5 | AUDIT_REPORT §3.5 | DONE |
| 36 | E-05: Undefined text scoring crash | Guard against missing `parsed.text` before string operations | M5 | AUDIT_REPORT §3.5 | DONE |
| 37 | E-06: Score scale desynchronization | Align 0-10 vs 0-100 scoring scale consistently across pipeline | M5 | AUDIT_REPORT §3.5 | DONE |
| 38 | E-07: EOD test mode bypass | Remove artificial `EOD_TEST` score overriding | M5 | AUDIT_REPORT §3.5 | DONE |
| 39 | E-08: Delayed summary silencing | Remove blanket `delayed_summary` drop for parser targets | M5 | AUDIT_REPORT §3.5 | DONE |
| 40 | F-01: Unescaped HTML entities in alerts | Wrap `data.wl_spots` and `data.supply` in `escapeHTML()` | M6 | AUDIT_REPORT §3.6 | DONE |
| 41 | F-02: Telegram message overflow | Clamp formatted messages to 4,000 characters | M6 | AUDIT_REPORT §3.6 | DONE |
| 42 | F-03: Rate limit 429 drops | Implement exponential retry queue for Telegram broadcasting | M6 | AUDIT_REPORT §3.6 | DONE |
| 43 | F-04: False positive link risk | Add official wallets (`phantom.app`, `solflare.com`) to trusted domains | M6 | AUDIT_REPORT §3.6 | DONE |
| 44 | F-05: Mini App zero-authentication | Implement HMAC-SHA256 verification using `TELEGRAM_BOT_TOKEN` | M6 | AUDIT_REPORT §3.6 | DONE |
| 45 | F-06: Hardcoded admin ID fallback | Remove fallback default `chat_id = '332680373'` | M6 | AUDIT_REPORT §3.6 | DONE |
| 46 | F-07: Unauthenticated profile wipe | Enforce authentication on `DELETE /api/miniapp/profile` | M6 | AUDIT_REPORT §3.6 | DONE |
| 47 | F-08: Division by zero in grammy price | Guard `baseline_price === 0` in price change alerts | M6 | AUDIT_REPORT §3.6 | DONE |
| 48 | M7-01: Invert empirical vulnerability proofs | Verify all 8 previously passing vulnerability tests resolve to secure | M7 | ORIGINAL_REQUEST §R2 | DONE |
| 49 | M7-02: End-to-end lifecycle verification | Verify tweet DOM parsing -> Service Worker -> Express -> Telegram | M7 | ORIGINAL_REQUEST §R2 | DONE |
| 50 | M7-03: Final forensic integrity audit | Comprehensive independent audit confirming zero cheats or facades | M7 | Forensic Audit Standard | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Extension Client & DOM Ingestion | `extension/content.js`, `extension/tweet-parser.js`, `extension/moni-score.js`, `extension/filters.js` | None | DONE |
| M2 | Extension Service Worker & Queue | `extension/service-worker.js`, `extension/queue.js`, `extension/search-controller.js`, `extension/settings.js`, `extension/manifest.json` | None | DONE |
| M3 | Backend Ingest & Webhooks | `vps_server.js` (routes & DB mock), `src/alchemy.js`, `src/index.js` | None | DONE |
| M4 | Deduplication, SQL Safety & Keys | `src/dedupe.js`, `src/project-dedupe.js`, `src/project-key.js`, `src/parser.js` | None | DONE |
| M5 | AI Classifier, Gating & Scoring | `src/ai-classifier.js`, `src/opportunity-gate.js`, `src/quality-gate.js`, `src/scoring.js`, `patch_eod_test_fix.js` | None | DONE |
| M6 | Telegram Broadcast & Mini App Auth | `src/formatter.js`, `src/daily-summary.js`, `src/telegram*.js`, `src/link-risk.js`, `vps_server.js` (Mini App routes) | M3, M4, M5 | DONE |
| M7 | Final E2E Verification & Post-Fix Audit | Full pipeline tests, empirical proof suite inversion, forensic integrity audit | M1-M6 | DONE |
| E2E | E2E Testing Track (Parallel) | `tests/e2e/`, `TEST_INFRA.md`, `TEST_READY.md` (Tiers 1-4 requirement-driven test suite) | None | DONE |

## Interface Contracts
### Content Script ↔ Service Worker (`extension/content.js` ↔ `extension/service-worker.js`)
- `TRANSLATE_AND_ENQUEUE`: Payload must include `tweet_id` (numeric string), `tweet_url`, `author`, `text`, `timestamp`, `links`, `is_parser_target`, `is_x_list`, `follower_count`, `moni_score`.
- `START_OBSERVER`: Message payload must forward `{ type: 'START_OBSERVER', isXList: Boolean, isParserTarget: Boolean }`.

### Service Worker ↔ Express VPS (`extension/service-worker.js` ↔ `vps_server.js:POST /ingest`)
- Headers: `Content-Type: application/json`, `x-client-key: <string>`.
- Payload: `{ tweet_id: string, tweet_url: string, author: string, text: string, detected_at: string, is_parser_target?: boolean, is_x_list?: boolean, links?: string[], ... }`.
- Status codes: 200 (Success), 400 (Invalid payload/empty ID), 401/403 (Invalid key - retry max 3 with exponential backoff then fail, do NOT deadlock queue), 409 (Duplicate).

### Express Ingest ↔ Deduplication & Storage (`vps_server.js` ↔ `src/dedupe.js`, `src/project-dedupe.js`)
- `checkDuplicate(db, tweetId)`: returns boolean or existing row.
- `saveTweet(db, tweetData)`: atomic upsert (`INSERT OR IGNORE INTO tweets ...`) or wrapped in mutex `getLock(tweet_id)`.
- `getProjectAlertStatus(db, projectKey, tweetId, username, hours, maxAuthors, isXList, opportunityType)`: uses parameterized SQL query bindings `?` with `opportunityType` safely bound as parameter.

### Express Ingest ↔ AI Classifier & Gating (`vps_server.js` ↔ `src/ai-classifier.js`, `src/opportunity-gate.js`, `src/scoring.js`)
- `runAIFilter(tweetText)`: returns `{ relevant: boolean, category: string, actionable: boolean, score: number, reason: string }` on normalized 0-10 or 0-100 scale. Inputs must be sanitized/escaped.
- `normalizeOpportunity(tweet)`: returns normalized object with `is_discussion`, `is_actionable_opportunity`, `opportunity_type`. Question marks in text do NOT automatically mark `is_discussion = 1` if action intent exists.
- `calculateScore(parsed, options)`: returns integer score 0-100. Guarantees safety when `parsed.text` is undefined.

### Express VPS ↔ Telegram Distribution (`vps_server.js` ↔ `src/formatter.js`, `src/telegram.js`)
- `formatTelegramMessage(data, lang)`: returns sanitized HTML string. Guarantees all dynamic fields (`wl_spots`, `supply`, `project_name`) pass through `escapeHTML()`. Message length clamped to <= 4000 characters.
- `sendTelegramBroadcast(bot, channelId, message, buttons)`: handles 429 rate limit with retry queue.

### Mini App API Security (`vps_server.js: /api/miniapp/*`)
- Query or Header `initData`: MUST be validated via HMAC-SHA256 using `TELEGRAM_BOT_TOKEN`.
- No unauthenticated fallback to `'332680373'`. Missing or invalid auth returns HTTP 401 Unauthorized.
- `DELETE /api/miniapp/profile`: MUST authenticate user from validated `initData` before executing profile deletion.

## Code Layout
```
H:\nft-radar\
├── extension\               # Chrome Extension Manifest V3
│   ├── manifest.json        # Extension manifest, permissions, host_permissions
│   ├── content.js           # Content script, DOM observer, hovercards
│   ├── tweet-parser.js      # DOM tweet parser, entity extraction
│   ├── service-worker.js    # Background service worker, queueing, sync
│   ├── queue.js             # Extension queue logic
│   ├── search-controller.js # Profile crawler, EOD target manager
│   ├── filters.js           # Keyword filtering
│   ├── moni-score.js        # Moni score parser
│   └── settings.js          # Settings UI & storage
├── src\                     # Shared Backend Engine Modules
│   ├── ai-classifier.js     # AI Classification, prompt construction
│   ├── opportunity-gate.js  # Opportunity classification & discussion gates
│   ├── quality-gate.js      # Quality filters, follower/Moni gates
│   ├── scoring.js           # Score calculation
│   ├── dedupe.js            # Tweet ID deduplication
│   ├── project-dedupe.js    # Project key deduplication & SQL queries
│   ├── project-key.js       # Project key synthesis
│   ├── parser.js            # Keyword & project name extraction
│   ├── formatter.js         # Telegram HTML message formatting
│   ├── telegram.js          # Telegram API broadcasting
│   ├── telegram-bot.js      # Telegram bot handlers
│   ├── telegram-grammy.js   # Grammy bot setup
│   ├── link-risk.js         # Domain verification & link safety
│   ├── alchemy.js           # Webhook payload parser
│   └── index.js             # Worker exports / D1 integration
├── vps_server.js            # Express 5 production VPS server
└── tests\                   # E2E & Empirical Verification Suite
    └── e2e\                 # Requirement-driven E2E test suites
```
