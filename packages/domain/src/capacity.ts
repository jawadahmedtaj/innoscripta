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
  const totalPm = relevant.reduce((sum, allocation) => {
    assertSupportedPm(allocation.amount);
    return sum + allocation.amount;
  }, 0);
  assertFiniteResult(totalPm, 'Capacity total');
  const sorted = [...relevant].sort(
    (a, b) => (a.editSequence ?? 0) - (b.editSequence ?? 0) || a.id.localeCompare(b.id),
  );
  const latest = sorted.at(-1);
  return { totalPm, overCapacity: totalPm > 1, latest };
}

