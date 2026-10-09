# Baseline Planning Suite

Three independently compiled React microfrontends for staffing, effective-dated employee costs, and cross-project capacity. Built against the supplied [innoscripta brief](docs/case-study.pdf); the original [seed](data/baseline-seed.json) is preserved byte-for-byte.

## Run

Install Docker with its Compose plugin, then from a clean clone:

```sh
docker compose up
```

Open **http://localhost:8080**. Docker builds the application; Node is **not** required on the host. Standalone remotes are at **http://localhost:8080/people/** and **http://localhost:8080/delivery/**. The trailing slashes are intentional.

Run every automated check inside Docker:

```sh
docker compose --profile checks run --build --rm checks
```

Optional local development uses the exact versions in `.node-version`, `package.json`, and `package-lock.json`: Node 24.20.0 and npm 11.19.0.

```sh
npm ci
npm run check
npm start
```

`npm run check` runs strict typechecking, ESLint, all pure/service/React integration tests, three production builds, the production HTTP/runtime-configuration check, and tests executing the built federation artifacts. Individual commands: `npm run typecheck`, `npm run lint`, `npm run test:domain`, `npm run test:integration`, `npm test`, `npm run build`, `npm run verify:runtime`, `npm run verify:federation`. Grid projection tests are included by `npm test`. Formatting: `npm run format` or `npm run format:check`.

Build each app separately with `npm run build:shell`, `npm run build:people`, or `npm run build:delivery`. For an edit/build loop use `npx rspack build --config rspack.config.mjs --watch` beside `npm start`, then refresh. Federation works on production builds without a special development server.

## Architecture and ownership

```text
apps/shell          Navigation, active user, currency, remote loader, boundaries
apps/people         Employee register and effective-dated rate management
apps/delivery       Work breakdown, allocation editing, staffing/cost projections
packages/contracts  Entities, read models, commands, subscriptions, remote contract
packages/domain     Browser-independent validation and calculation functions
packages/data       Persistence, serialized commands, authoritative snapshots
packages/platform   Thin bootstrap, native dialog, styles, subscription hooks
data                Original seed JSON
docs                Original brief, decisions, verification, interview walkthrough
tests/integration   Mounted standalone/hosted workflows
scripts             Production server and runtime-configuration verification
```

| Data                                | Domain owner                               | Write contract                        |
| ----------------------------------- | ------------------------------------------ | ------------------------------------- |
| Employees and rates                 | People                                     | `planning.people.saveRate/removeRate` |
| Projects, breakdown and allocations | Delivery                                   | `planning.delivery` commands          |
| Active user and currency            | Shell; standalone controller when unhosted | `session.setActiveUser/setCurrency`   |

The data adapter is shared infrastructure. It enforces the owners' commands against one authoritative persisted document, validates each complete transaction, freezes its published snapshot, and notifies subscribers only after persistence succeeds. There are no competing React stores. Delivery reads People-owned rates through the published snapshot and uses shared pure pricing functions; this keeps calculation tests independent of either UI and avoids asynchronous per-cell requests. Projects and employees have no creation/deletion UI because the brief does not request it.

The public integration contract is `AppServices`. `subscribe(listener)` returns an unsubscribe function, and `getSnapshot()` keeps object identity until a commit. React consumes planning/session stores with `useSyncExternalStore`. Commands return promises; the initiating form displays validation/persistence errors. There is no untyped custom event bus. Both remotes stay mounted during navigation; **Compare both** exposes immediate cross-remote updates.

Hosted remotes receive the same service instance from Shell. Standalone entrypoints create the same adapter and default session (first employee, EUR), then render the exact component exported by their remote entry. Same-origin tabs receive changes through the browser's `storage` event. Web Locks serialize read/validate/write across tabs; commands also serialize within a tab. Browsers without Web Locks have only same-tab serialization. No server-side collaboration or authentication is implied.

### Real federation

Rspack 2.2.8's native `ModuleFederationPluginV1` builds three separate compilation graphs and asset directories. People and Delivery expose `./App` from real `remoteEntry.js` containers. Shell uses the native `init`/`get` protocol after initializing its share scope; it never imports sibling app source or embeds an iframe. React, React DOM, JSX runtime and the DOM client entry share singleton configuration and strict version 19.3.0. Shell checks exported React identity at runtime and reports a mismatch in the affected panel.

`scripts/serve.mjs` serves the three builds in one container to keep evaluation simple. They remain independent artifacts. Each remote's standalone HTML and hosted export use the same build and component. `publicPath: 'auto'` resolves lazy JS/CSS chunks relative to the remote entry, including after runtime relocation. The server allows cross-origin asset loads; an external remote host must also serve its assets correctly.

`PEOPLE_REMOTE_URL` and `DELIVERY_REMOTE_URL` come from the **running container's environment**. `/runtime-config.json` is generated from that environment and served with `Cache-Control: no-store`. Shell fetches it before bootstrapping. Remote URLs are not compiled into Shell JavaScript. A configuration change takes effect on reload; business/session updates do not need a reload.

Reference documentation: [Rspack native federation](https://rspack.dev/plugins/module-federation-plugin-v1).

## Calculations and decisions

- Canonical unit: **person-months (PM)**. Seed `amount: 0.5` remains 0.5 PM. Unit switching never writes data.
- Date-only arithmetic uses UTC components, Monday–Friday, no holidays or project-date proration. Monthly capacity = working days × weekly hours ÷ 5. Hours = PM × capacity; percentage = PM × 100.
- Rates apply inclusively from `validFrom` until the next rate begins, with no final expiry. Each working day carries PM × weekly hours ÷ 5 hours. Cost sums this effort at the rate covering each day. A weekend change starts charging on the next working day.
- Days before the first rate cost zero and are flagged. Partially uncovered months price covered days normally and uncovered days at zero. This partial-month policy is an assumption, not explicitly prescribed by the brief. Cost input is disabled for incomplete coverage or zero weighted cost; other units remain editable.
- Cost input divides by the **exact cost of one PM for that month**, including FX, never a rounded blended rate. Rates are edited in base EUR/hour, with display equivalents labeled.
- Fixed illustrative FX: **EUR 1 = USD 1.10 = GBP 0.85**. No live provider or symbol-only substitution. Underlying rates/pricing stay in EUR.
- Display precision: hours/PM/cost 2 decimals, percentage 1. Opening, focusing, blurring, switching units, cancelling, or saving untouched rounded text does not rewrite an allocation. Explicitly changing and saving rounded text is an intentional new value. Empty input is invalid; zero is a valid stored allocation.
- Negative/non-finite numbers, impossible dates, duplicate effective dates and invalid references are refused. Date years are 0100–9999. Numeric bounds derive from JavaScript's safe integer precision for display ticks, with dataset totals checked at the boundary; they impose no business capacity ceiling. Even 500 PM remains valid when its calculations fit safely, and produces a capacity warning.
- Capacity sums PM across **all projects** for each employee/month. Strictly greater than 1 PM warns; exactly 1 PM is allowed. `editSequence` is persisted monotonic command ordering and `editedBy` records attribution. Untouched seed allocations have no historical timestamp: the greatest stable allocation ID is the labeled initial tie-break. Zero amounts do not contribute to the latest assignment.
- Three BreakdownItem levels sit beneath a project, roots at level one. Only actual leaves are editable; a parent with one leaf remains read-only. Adding/moving a child beneath an allocated leaf is refused. Cross-project moves are refused. Delete explicitly cascades through descendants and allocations atomically.

### Rounding and reconciliation

Exact binary floating-point values stay canonical. The display group is one project's leaf allocation cells, across all employees/months, for the selected unit/currency. Largest remainder floors display ticks, rounds the exact group sum once, then awards remaining ticks by descending remainder with stable allocation IDs breaking ties.

Selected leaf/parent/project cells and row/column/grand totals sum the same reconciled integer ticks. This keeps hierarchy and both margins consistent. Intermediate subtotals are **not rounded independently** and may differ by a tick from independently rounding their raw sums. That is the explicit trade-off for coherent margins. Display adjustments never enter persistence. Search keeps the projection unchanged and groups hidden rows as “Other people” so the visible table still reconciles. Aggregate percentage totals are omitted: each percentage cell's denominator is that employee's monthly capacity, not a fictional team percentage.

### Supplied fixture

Audited counts: 60 employees, 150 rates, 4 projects, 90 breakdown items, 720 allocations. IDs/references/cell keys/rate dates are valid and unique, allocations are on leaves, and weekly hours are 20, 32 or 40. The horizon discrepancy is `alloc-001` in **March 2026**, before the advertised April 2026–March 2027 range. The grid unions metadata and allocation months, exposing 13 months without modifying the fixture. Project dates are descriptive and do not alter calculations.

The live reference reads `alloc-001`, `emp-001`, and current rates. Initial results: 22 working days, 176.00 capacity hours, 0.50 PM, 88.00 hours, 50.0%, EUR 7,880.00. Eight days × 4 hours × EUR 80 plus fourteen × 4 × EUR 95. The seed expectation is labeled separately so edits remain visible.

## Persistence and reset

Data lives in this browser origin's `localStorage`, at `baseline.planning.v1`. The validated fixture initializes it **only if the key is absent**. Saved data is validated and retained; corrupt data yields an error instead of silent reseeding. The session key is `baseline.session.v1`. Refreshes and container restarts preserve both. A different browser/profile/origin starts a separate dataset.

To export, copy `localStorage.getItem('baseline.planning.v1')` from browser DevTools. To explicitly reset, close other Baseline tabs and run this on localhost:8080:

```js
localStorage.removeItem('baseline.planning.v1');
localStorage.removeItem('baseline.session.v1');
location.reload();
```

Only Baseline keys are removed. `docker compose down` does not reset browser data. Session-only recovery needs just the session key removed. Future schema versions need an intentional migration, never an automatic reset.

## Remote failure and runtime URL demonstration

After starting normally, recreate only the runtime container **without rebuilding**:

```sh
DELIVERY_REMOTE_URL=/missing/delivery.js docker compose up -d --no-build --force-recreate baseline
```

Refresh http://localhost:8080. Delivery shows its configured URL and a recoverable error; Shell and People remain usable. Restore defaults:

```sh
docker compose up -d --no-build --force-recreate baseline
```

Refresh to fetch the corrected config. Retry also recovers when availability is restored at the existing URL. Entry/chunk requests time out after ten seconds; failures remain inside the affected panel.

To relocate working remotes without changing Shell assets:

```sh
docker compose exec baseline sh -c 'sha256sum dist/shell/*.js'
PEOPLE_REMOTE_URL=/alternate/people/remoteEntry.js DELIVERY_REMOTE_URL=/alternate/delivery/remoteEntry.js docker compose up -d --no-build --force-recreate baseline
docker compose exec baseline sh -c 'sha256sum dist/shell/*.js'
```

Refresh. Status lines show `/alternate/...` and verified React sharing; hashes stay unchanged. Alternative routes intentionally serve identical remote artifacts, including lazy chunks. Substitute a compatible independent remote host if desired. Restore defaults using the prior command.

`npm run verify:runtime` automates environment/config/route/hash checks against production assets using disposable servers with default, relocated and failed URLs. `npm run verify:federation` executes actual remote entries over HTTP in JSDOM: hosted and standalone apps, singleton identity, rate/session propagation, persistence, failed loading and relocated URLs. These tests do not substitute local imports for remote entries. Mounted UI tests also cover panel retries. The separate real-browser walkthrough is recorded in [verification](docs/VERIFICATION.md).

## Handover and limitations

See [verification and environment limitations](docs/VERIFICATION.md) and the [interview walkthrough](docs/INTERVIEW.md).

This is a local case study: no authentication, employee/project administration, multi-user backend, holidays, scheduling, offline mode, live FX, or mobile-specific workflow. Browser storage is bounded; failed writes are reported before new state is published. The supplied 60 people render directly without a grid/virtualization dependency. The service contract permits a backend later. Incompatible public contracts still need coordinated versioning; federation does not solve API evolution.
