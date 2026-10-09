import type { Employee, SeedData } from '@baseline/contracts';
import {
  assertFiniteResult,
  DomainValidationError,
  monthDate,
  SUPPORTED_HOURS,
  type MonthlyCapacity,
} from './shared';

/** Return Monday-Friday dates in a calendar month, using UTC date-only arithmetic. */
export function workingDays(month: string): string[] {
  const { year, monthIndex } = monthDate(month);
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const result: string[] = [];
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

export function monthlyCapacity(employee: Employee, month: string): MonthlyCapacity {
  if (!SUPPORTED_HOURS.has(employee.weeklyHours)) {
    throw new DomainValidationError('Employee weeklyHours must be 20, 32, or 40');
  }
  const count = workingDays(month).length;
  const dailyCapacityHours = employee.weeklyHours / 5;
  const capacityHours = count * dailyCapacityHours;
  assertFiniteResult(capacityHours, 'Monthly capacity');
  return { month, workingDays: count, dailyCapacityHours, capacityHours };
}

function monthIndex(month: string): number {
  const parsed = monthDate(month);
  return parsed.year * 12 + parsed.monthIndex;
}

export function gridMonths(data: Pick<SeedData, 'meta' | 'allocations'>): string[] {
  const months = new Set<string>();
  const start = monthIndex(data.meta.gridHorizon.from);
  const end = monthIndex(data.meta.gridHorizon.to);
  for (let index = start; index <= end; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    months.add(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
  }
  data.allocations.forEach((allocation) => months.add(allocation.month));
  return [...months].sort();
}
