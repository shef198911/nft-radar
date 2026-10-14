# Test Infrastructure Specification: NFT Radar E2E Verification Suite

**Version:** 1.0.0  
**Target System:** NFT Radar Chrome Extension MV3 & Express Backend Pipeline  
**Author:** Test Writer E2E (`teamwork_preview_test_writer`)  
**Standard:** 4-Tier Opaque-Box E2E Testing Methodology  

---

## 1. Test Philosophy & Principles

### 1.1 Opaque-Box Verification
All tests treat the system and its modules as opaque-box components governed by strict behavioral contracts defined in `PROJECT.md`, `AUDIT_REPORT.md`, and `ORIGINAL_REQUEST.md`. Assertions are derived from observable inputs, state transitions, external network contracts, and persisted database artifacts rather than private internal implementation details.

### 1.2 Progressive Testability & Non-Regressive Assertions
Tests validate both the intended system behaviors and the resolution of vulnerabilities cataloged in the audit. When evaluating remediation milestones:
- Tests verify contract adherence without modifying production code.
- Boundary conditions and security constraints are tested against expected specification outputs.
- Test suites operate deterministically without relying on unseeded external network state.

### 1.3 Test Integrity & Anti-Facade Standard
- **Zero Facades**: No test shall return unconditional passing results or assert tautologies (e.g. `assert(true)`).
- **Behavioral Assertions**: Every test must fail if the expected contract, security boundary, or data pipeline breaks.
- **Authoritative Expected Outputs**: Expected outputs are derived directly from the normative requirements in `PROJECT.md § Interface Contracts`, standard RFCs (HTTP, URL, HTML5, HMAC-SHA256), and Telegram Bot API specifications.

### 1.4 Adversarial Edge Case Verification
In accordance with verification standards, the suite includes:
- **Encoding & Escaping Integrity**: HTML meta-characters (`<`, `>`, `&`, `"`), unicode ellipsis (`…`), and international number formatting (`1,5M`).
- **Security Boundaries**: AI prompt injection delimiters (`"""`), SQL injection vectors (`' OR '1'='1`), and unauthenticated API probing.
- **Resource & Concurrency Stress**: Race conditions, mutex serialization, and payload length limits (>4000 characters).

---

## 2. Feature Inventory & 4-Tier Mapping

The NFT Radar architecture encompasses eight core functional subsystems. The matrix below maps each subsystem across all four tiers:

| Subsystem / Feature | Tier 1: Feature Coverage (>=5 tests) | Tier 2: Boundary & Corner Cases | Tier 3: Cross-Feature Combinations | Tier 4: Real-World Scenarios |
|---|---|---|---|---|
| **F-01: DOM Tweet Parsing** | URL extraction, username/display, status ID, link normalization, text extraction | Trailing slash URL, unicode ellipsis in URLs, multi-line author name, missing `<time>` | DOM scrape -> Queue enqueue -> IPC serialization | Live Twitter DOM with quotes, media & hashtags |
| **F-02: Extension Queue & IPC** | Enqueueing, FIFO dispatch, HTTP 200 removal, retry scheduling, IPC payload validation | 401/403 authorization backoff, empty queue handling, max retry capping (5 attempts) | DOM Scrape -> In-memory Queue -> Express Ingestion dispatch | Head-of-line failure recovery with secondary queued items |
| **F-03: Express Ingestion (`POST /ingest`)** | Auth header check, payload validation, URL syntax, blacklist filtering, score assignment | Text > 50,000 chars, payload > 100KB, empty text, whitespace-only text | Ingestion -> Deduplication -> Mutex lock acquisition | High-volume burst ingestion under concurrent worker clients |
| **F-04: Deduplication & SQL Safety** | Tweet ID uniqueness, project key generation, parameterized SQL bindings, author duplicate check, 48h window | Anonymous `__unknown__` author isolation, multi-tenant domain key separation, special chars in project keys | Concurrent duplicate requests -> Atomic insertion / Mutex | High-reputation influencer 48-hour multi-tweet alert lifecycle |
| **F-05: AI Classifier & Scoring** | Schema conformance, score calculation, keyword weighting, priority mapping (HOT/HIGH/NORMAL), fallback scoring | Prompt injection escaping (`"""`), missing `parsed.text`, negative penalty harmonization, 0-10 vs 0-100 scale | Ingestion -> AI Gate Evaluation -> Opportunity categorization | Complex airdrop announcement with embedded markdown & URLs |
| **F-06: Quality & Opportunity Gates** | Follower count gate, Moni score threshold, actionable intent detection, discussion pattern matching, admin target pass-through | Question mark rhetorical alpha, null Moni score with follower fallback, zero follower edge | Ingestion -> Quality Gate -> Telegram broadcast gating | Admin parser target scanned with low follower/Moni score |
| **F-07: Telegram Alert Formatting** | HTML entity escaping, priority badge rendering, tag synthesis, chain icon selection, broadcast dispatch | Supply `<1000`, WL spots `<50`, message clamping at 4,000 chars, 429 rate limit backoff | AI Gate -> Formatter -> Telegram Bot API serialization | Formatted alert payload ready for Telegram HTML parser |
| **F-08: Mini App Authentication & APIs** | HMAC-SHA256 validation, valid initData parsing, portfolio data query, tracker retrieval, profile deletion safety | Expired auth token, malformed signature, missing auth query, default admin ID `332680373` rejection | Mini App auth -> Profile query -> Transaction tracking | Secure Telegram Mini App user session lifecycle |

---

## 3. Test Architecture & Harness

### 3.1 Directory Layout
```
tests/e2e/
├── fixtures/
│   ├── dom_articles.cjs       # Synthetic DOM snippets representing Twitter/X articles
│   ├── tweet_payloads.cjs     # Valid, malicious, and edge-case tweet JSON objects
│   └── mock_telegram.cjs      # In-memory mock Telegram Bot API & validator
├── helpers/
│   ├── test_harness.cjs       # Assertion utilities, runner reporting & metrics
│   ├── db_helper.cjs          # In-memory SQLite database setup & migrations
│   └── mock_server.cjs        # Ephemeral Express / HTTP test server helper
├── tier1_features.test.cjs    # Tier 1: Feature Coverage Suites (>=5 per feature)
├── tier2_boundaries.test.cjs  # Tier 2: Boundary & Corner Case Suites
├── tier3_combinations.test.cjs# Tier 3: Cross-Feature Combinations & Concurrency
├── tier4_scenarios.test.cjs   # Tier 4: Real-World Alpha Tweet Scenarios
└── run_all_e2e.cjs            # Unified Master E2E Test Runner
```

### 3.2 Component Harnesses
1. **Virtual DOM Harness**: Utilizes `jsdom` to emulate Twitter/X DOM timeline elements (`<article data-testid="tweet">`), hovercards, and navigation contexts for `extension/tweet-parser.js` and `extension/content.js`.
2. **In-Memory Database Harness**: Spins up isolated in-memory or temporary SQLite databases using `better-sqlite3`, initializing schema tables (`tweets`, `coin_trackers`, `profiles`, `price_alerts`, `evm_queue`, etc.) to test deduplication, queries, and atomic concurrency without state leakage between tests.
3. **Mock HTTP & Server Harness**: Spawns ephemeral Node.js HTTP/Express instances to test `/ingest`, `/evm/webhook`, and `/api/miniapp/*` endpoints with real TCP socket requests and network headers.
4. **Mock Telegram Receiver**: Validates formatted HTML messages against Telegram's strict parse entity rules (matching `<b|i|a|code|pre>` tags, rejecting unescaped `<` or `&`, and verifying character limits <= 4096).

---

## 4. Coverage Thresholds & Quality Gates

| Metric | Target Threshold | Rationale |
|---|---|---|
| **Tier 1 Feature Tests** | >= 40 tests (>=5 per 8 features) | Guarantees comprehensive baseline verification of all subsystems |
| **Tier 2 Boundary Tests** | >= 15 tests | Verifies all 8 critical audit boundary bugs + additional edge conditions |
| **Tier 3 Combinatorial Tests**| >= 10 tests | Validates pairwise pipeline transitions, mutex locks, and concurrency |
| **Tier 4 Scenario Tests** | >= 5 tests | Full lifecycle simulation from timeline DOM parsing to broadcast |
| **Total Test Count** | >= 70 tests | Complete opaque-box verification across the entire project |
| **Execution Speed** | < 15 seconds | Enables rapid feedback in automated CI/CD and pre-commit checks |
| **Isolation** | 100% Hermetic | Every test creates its own mock/database and performs teardown |

---

## 5. Execution Guide

To execute the entire E2E test suite:
```bash
node tests/e2e/run_all_e2e.cjs
```

To execute individual tiers:
```bash
node tests/e2e/tier1_features.test.cjs
node tests/e2e/tier2_boundaries.test.cjs
node tests/e2e/tier3_combinations.test.cjs
node tests/e2e/tier4_scenarios.test.cjs
```
