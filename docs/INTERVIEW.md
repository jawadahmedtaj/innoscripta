# Interview walkthrough

1. **Correctness first.** Start the suite and select Cost in Delivery. The live March panel shows 22 working days, 176 capacity hours, 0.50 PM, 88 hours, 50%, and EUR 7,880. Open the reference cell, explicitly enter 7,880, and show the canonical amount remains 0.5. March is deliberately retained outside the fixture metadata horizon.

2. **Boundaries.** Walk through contracts, pure domain functions, and the persistence adapter. People owns rates; Delivery owns the plan. Delivery prices published People rate records with shared pure functions. The adapter is authoritative, not either React tree. Explain the local-storage trade-off and how the injected contract permits a future backend.

3. **Runtime integration.** Compare both. Correct Adaeze's 2026-03-12 rate from 95 to 100: mounted Delivery changes from EUR 7,880 to EUR 8,160. Switch Shell to USD: USD 8,976 with labeled illustrative FX. Change active user and show both remotes update. Restore EUR and the 95 rate.

4. **One canonical amount.** Repeatedly switch units and refresh. Opening/saving an untouched rounded value makes no edit. Explicit changed input converts once using exact capacity/pricing. Incomplete or zero pricing disables Cost entry, leaving the other units usable.

5. **Tree and totals.** Select a parent: derived values stay read-only, even with one child. Create, rename and move a temporary empty branch; try excess depth or an invalid move. Delete it with explicit cascade. Compare leaf, parent and project totals: one project-wide largest-remainder projection supplies all margins. Explain the intermediate-subtotal trade-off and omitted aggregate percentages.

6. **Capacity and persistence.** Make two projects contribute more than 1 PM together, each below 100% individually. Both apps warn; Delivery names the latest contributing assignment. Refresh and open standalone apps to show saved data/edit ordering. Seed ties use a labeled convention, not invented timestamps.

7. **Federation proof.** Show Network requests to each remoteEntry and its lazy chunks, plus runtime React identity verification. Show independent build commands and thin standalone adapters. Run README's remote failure and alternative URL demonstrations, comparing unchanged Shell hashes.

8. **Tests and a live change.** Run the Docker checks service or `npm run check`. Inspect the reference/calendar/rate tests, tree/rounding tests, persistence tests and mounted integration workflows. A useful live exercise is adding one illustrative display currency: update the contract, multiplier, selector and tests without changing stored EUR rates or PM amounts.

Reset explicitly before another demo if you have changed the seed. `VERIFICATION.md` distinguishes checks actually executed from those blocked by the environment.
