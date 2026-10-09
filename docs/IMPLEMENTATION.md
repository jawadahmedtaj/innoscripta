# Requirements and implementation checkpoints

Authority: [the supplied six-page brief](case-study.pdf), read in full before coding.
The extended user request adds verification depth but does not conflict with the brief.

- [x] Three real federated React builds; one React singleton; runtime URLs; standalone adapters.
- [x] Strict TypeScript; native semantic UI; no component/grid/tree libraries.
- [x] People owns employees/rates; Delivery owns projects/tree/allocations; Shell owns session.
- [x] Validated, preserved seed and persistent edits; typed subscriptions and cleanup.
- [x] Effective-date costs, variable working days, PM canonical unit; March reference €7,880.
- [x] Four editable units, exact conversions, deterministic display reconciliation.
- [x] Three-level tree CRUD, safe moves/cascades, leaves only, derived parents.
- [x] Cross-project capacity, strict >100%, persistent last contributor ordering.
- [x] Runtime user/currency propagation and remote failure isolation/recovery.
- [x] Domain/integration tests, builds, browser verification, README and walkthrough.
- [x] Dockerfile and Compose configuration; configuration validation.
- [ ] Docker container execution: blocked by the host's absent daemon and privileged UID-mapping helpers. See VERIFICATION.md.

Sequence: (1) contracts, federation/container foundations and reference calculation;
(2) domain validation, persistence, People; (3) Delivery and cross-remote behavior;
(4) reconciliation, failure/runtime demos, verification and handover. Commit each working checkpoint.

## Initial fixture audit

60 employees, 150 rates, 4 projects, 90 breakdown items, 720 allocations. All entity IDs,
allocation cell keys and employee/effective-date keys are unique. All references are valid;
all allocations are on leaves; every tree is acyclic, contained in its project and at most
three BreakdownItem levels. Contracted hours are 20, 32 or 40.

The metadata horizon is April 2026–March 2027, but alloc-001 is March 2026. The actual
grid uses the union of the advertised horizon and allocation months (13 months), preserving
every record. Project dates do not prorate allocations. No other structural inconsistency
was found. Original JSON is copied byte-for-byte to data/baseline-seed.json.
