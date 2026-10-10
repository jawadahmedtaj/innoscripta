# Verification record

Executed in the supplied workspace on 2026-10-10, with Node 24.20.0 and npm 11.19.0. No public deployment or push was performed.

## Automated checks

| Check                                                    | Result                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                      | Passed: strict TypeScript, no emit, unchecked-index and exact-optional checks enabled                                                                                                      |
| `npm run lint`                                           | Passed: ESLint, including no explicit `any` and application import boundaries                                                                                                              |
| `npm test`                                               | Passed: 39 tests in four files                                                                                                                                                             |
| Pure domain tests                                        | 17 passed: original fixture, reference, calendar/rates, missing coverage, conversions/drift, rounding, tree, capacity and numerical validation                                             |
| Persistence tests                                        | 8 passed: initialize once, reload, serialized commands, invalid inputs, edit ordering, cascade, lifecycle cleanup, atomic failed writes                                                    |
| Grid projection tests                                    | 3 passed: reconciliation, percentage policy, adversarial fractional parent/child totals                                                                                                    |
| React integration tests                                  | 11 passed: standalone adapters, hosted session/rate/capacity updates, persistence, failure/retry, rounded edits and parent/empty-project behavior                                          |
| `npm run build`                                          | Passed: separate Shell, People and Delivery production builds                                                                                                                              |
| `npm run verify:runtime`                                 | Passed: environment-generated configuration, default/alternate/missing routes and unchanged Shell JS hash                                                                                  |
| `npm run verify:federation`                              | Passed: actual built remote entries executed over HTTP in JSDOM, both standalone apps, hosted containers, React identity, live rate/session updates, persistence, isolation and relocation |
| Fresh tracked-source checkout: `npm ci && npm run check` | Passed in an empty temporary directory from `git archive HEAD`, at source commit `5eedca1`, including all 39 tests, builds and both runtime/federation checks                              |
| `docker compose config`                                  | Passed                                                                                                                                                                                     |
| `docker compose --profile checks config`                 | Passed                                                                                                                                                                                     |
| `docker manifest inspect node:24.20.0-bookworm-slim`     | Passed: the pinned multi-platform base image exists                                                                                                                                        |
| `docker compose up -d`                                   | **Blocked**: no accessible Docker daemon                                                                                                                                                   |

The React integration tests inject a loader to focus on application behavior. They do **not** claim to test the federation protocol. The separate built-artifact script loads real `remoteEntry.js` files and invokes their runtime, and the browser walkthrough below verifies actual Chromium behavior. JSDOM's native-dialog methods are adapted for tests; browser dialogs were also exercised in the live application.

## Real browser walkthrough

Used the T3 collaborative browser against production assets served by the same `scripts/serve.mjs` used by the container, at **http://localhost:8080**.

- Shell loaded independent People and Delivery remote entries and lazy assets; each reported `shared React verified` after an actual identity comparison. Both globals exposed Module Federation container `get` functions.
- The live reference displayed **22 days, 176.00 capacity hours, 88.00 allocation hours, 0.50 PM, 50.0%, EUR 7,880.00**. Segments were EUR 2,560.00 and EUR 5,320.00. Explicit Cost entry of 7,880 saved canonical 0.5 PM and a persisted edit sequence.
- While both remotes were mounted, changing People rate `rate-002` from EUR 95 to EUR 100 changed Delivery to **EUR 8,160.00**. Switching Shell to USD changed it to **USD 8,976.00**. Active user `emp-002` propagated to both views. The rate was subsequently restored to 95.
- Standalone `/people/` and `/delivery/` opened independently and retained the edited rate/session from Shell on the same origin.
- Allocated **0.60 PM** to Adaeze in `prj-1/wbs-012` and **0.60 PM** in `prj-2/wbs-037`, March 2026. Both apps flagged the combined 120%; Delivery named Reporting Platform / Design as the latest assignment. Refresh preserved the amounts, editor and sequence ordering.
- Created a root breakdown item, renamed it, moved it under `wbs-001`, then deleted it. The tree returned to the original 90 items with no error.
- Restarted the server with `DELIVERY_REMOTE_URL=/missing/delivery.js`. Delivery showed its in-panel error; Shell controls and People were usable. Restored the default environment and refreshed; both remotes recovered.
- Restarted with both remote URLs under `/alternate/`. The browser loaded those entries and their lazy chunks successfully and again verified React identity. Compared SHA-256 hashes of **every Shell JS file** before and after: no changes, and no rebuild between those server restarts.

Browser navigation, form editing, DOM inspection and persisted-state checks succeeded. Initial screenshot capture failed; during the final validation it succeeded and the desktop layout was inspected. Some focused interaction calls were unreliable, so native DOM events/form submission through the same T3 browser completed those steps and the resulting UI and persistence were checked. No alternative browser system was used. Test-only browser edits are reset before handover; the repository seed was never edited.

## Final validation and fixes

Re-read the complete brief and audited calculations, persistence, UI behavior, federation and container startup independently. The audit found and fixed:

- A floating-point sum of 0.2 + 0.4 + 0.3 + 0.1 PM could falsely flag 100% as overcapacity. Compensated summation now retains the strict boundary; decimal permutations and deliberate `1 + Number.EPSILON` have separate regressions.
- Direct unit conversions could produce unsafe display ticks for extreme finite values. Conversions now reject those values before rendering, while numerically safe overcapacity remains allowed.
- Cost input itself remained editable when its Save button was disabled for missing pricing. Both are now disabled with the same explanation.
- Parent selectors with duplicate names were ambiguous. They now include full paths and IDs, and empty projects have a clear empty state.
- A tree dialog could target the fallback selection if another tab deleted the original node. Rename/move/delete dialogs now retain the original ID and refuse the stale action.

Final source commit `5eedca1` passed `npm ci && npm run check` from a fresh archive at `/tmp/baseline-clean-uY0PZl`: **39 tests**, all three builds, and both runtime/federation checks. Domain tests additionally passed under `TZ=America/Los_Angeles` and `TZ=Pacific/Auckland` (17 tests each). Formatting and `git diff --check` passed.

Additional browser validation covered:

- Rate correction from 95 to 100, GBP display of £6,936, and propagation of active user `emp-002` to both apps. Standalone tabs retained the same session and rates. Restoring the 95 rate in standalone People updated both already-mounted Delivery views to £6,698.
- Duplicate effective-date rejection with no extra record; adding a March 20 rate at 120 changed the live cost to £7,378, and removal restored £6,698.
- Explicit GBP cost entry of 6,698 saved 0.5 PM with edit attribution. Eighty unit changes left persisted data byte-for-byte unchanged.
- 0.6 PM in each of two projects produced the combined capacity warning in People and Delivery, named the latest contributor, and retained its edit order after refresh.
- Every displayed row and column total reconciled in PM, hours and cost, with zero tick mismatches in browser DOM checks.
- A temporary tree node was created, renamed and moved. Deleting it through Shell while a standalone rename dialog was open produced the stale-target message; the original 90 items remained intact.
- Partially uncovered March pricing visibly flagged the cell and disabled both Cost input and Save.
- A disposable server at port 8081 used the failed remote URL; People and Shell currency controls stayed usable. Restarting it with defaults recovered both remotes. Port 8082 used `/alternate/` runtime URLs and loaded both remote entries and their lazy chunks with verified React identity. Shell JS hashes were unchanged throughout these runtime changes, with no intervening rebuild.

Docker configuration still passes, but a fresh `docker compose build --progress=plain baseline` attempt failed because `/var/run/docker.sock` is absent. Container execution remains the only environment-blocked acceptance check.

## Fixture integrity

The supplied attachment and `data/baseline-seed.json` have the same SHA-256:

```text
a8253128db676bf72978403e8c904bfe55c8c1c95c61cd75af0db0dd19ee2463
```

The fixture audit and deviations are in `IMPLEMENTATION.md` and the README. Every record is retained, including March 2026.

## Environment limitation: container execution

The host originally had no Docker CLI or daemon. User-space Docker/Compose binaries were installed and Compose configuration was validated. The attempted `docker compose up -d` failed with:

```text
failed to connect to the docker API at unix:///var/run/docker.sock
connect: no such file or directory
```

An attempted rootless daemon could not run containers: this WSL environment lacks privileged `newuidmap`/`newgidmap` helpers. A one-UID user-namespace workaround failed image-layer extraction with an `lchown ... invalid argument` error. `sudo -n` requires interactive authentication. Experimental daemons were stopped.

Therefore the actual Docker image build, Compose stack startup, and Docker-hosted browser check remain **unverified**. The same pinned toolchain, production builds, server, runtime configuration and browser workflows passed outside Docker. The exact remaining evaluator checks are:

```sh
docker compose up
docker compose --profile checks run --build --rm checks
```

Then open the three URLs and run the runtime relocation/failure commands in the README. This limitation is recorded rather than claiming a container check that could not execute.
