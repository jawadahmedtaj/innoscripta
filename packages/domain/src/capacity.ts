import type { Allocation } from '@baseline/contracts';
import { assertFiniteResult, assertSupportedPm, type CapacityResult } from './shared';

export type { CapacityResult } from './shared';

export function getCapacity(
  allocations: readonly Allocation[],
  employeeId: string,
  month: string,
): CapacityResult {
  const relevant = allocations.filter(
    (allocation) => allocation.employeeId === employeeId && allocation.month === month,
  );
  // Kahan summation keeps the capacity boundary stable for decimal inputs such
  // as 0.2 + 0.4 + 0.3 + 0.1 while preserving strict comparison semantics for
  // deliberate values above one person-month.
  let totalPm = 0;
  let compensation = 0;
  relevant.forEach((allocation) => {
    assertSupportedPm(allocation.amount);
    const correctedAmount = allocation.amount - compensation;
    const nextTotal = totalPm + correctedAmount;
    compensation = nextTotal - totalPm - correctedAmount;
    totalPm = nextTotal;
  });
  const correctedTotal = assertFiniteResult(totalPm, 'Capacity total');
  const sorted = relevant
    .filter((allocation) => allocation.amount > 0)
    .sort((a, b) => (a.editSequence ?? 0) - (b.editSequence ?? 0) || a.id.localeCompare(b.id));
  const latest = sorted.at(-1);
  return {
    totalPm: correctedTotal,
    overCapacity: correctedTotal > 1,
    latest,
  };
}
