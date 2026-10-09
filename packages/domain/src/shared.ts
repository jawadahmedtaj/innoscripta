import type { Allocation, BreakdownItem, Currency } from '@baseline/contracts';

/** An input failed one or more domain boundary invariants. */
export class DomainValidationError extends Error {
  readonly issues: readonly string[];

  public constructor(issues: readonly string[] | string) {
    const normalized = typeof issues === 'string' ? [issues] : [...issues];
    super(normalized.join('; '));
    this.name = 'DomainValidationError';
    this.issues = normalized;
  }
}

export interface MonthlyCapacity {
  month: string;
  workingDays: number;
  dailyCapacityHours: number;
  capacityHours: number;
}

export interface PriceSegment {
  workingDays: number;
  hourlyCost: number;
  /** Cost of one full person-month for this slice (multiply by allocation PM). */
  costPerPm: number;
  validFrom: string;
}

export interface MonthPricing {
  month: string;
  capacityHours: number;
  costPerPm: number;
  missingWorkingDays: number;
  segments: readonly PriceSegment[];
}

export interface CapacityResult {
  totalPm: number;
  overCapacity: boolean;
  latest: Allocation | undefined;
}

export interface DeleteTreeResult {
  items: readonly BreakdownItem[];
  allocations: readonly Allocation[];
}

export const CURRENCY_RATES: Readonly<Record<Currency, number>> = Object.freeze({
  EUR: 1,
  USD: 1.1,
  GBP: 0.85,
});
export const FX_RATES = CURRENCY_RATES;

/** Generous persistence bounds keep later display conversions inside safe numeric precision. */
// 400 PM remains far beyond normal planning values while keeping a worst-case
// 60-person x 13-month cost grid inside safe reconciliation ticks.
export const DOMAIN_LIMITS = Object.freeze({
  maxAllocationPm: 400,
  maxHourlyCost: 1_000_000,
});

export const SUPPORTED_HOURS = new Set([20, 32, 40]);
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  // Date.UTC treats years 0-99 as offsets from 1900. Restrict fixture dates to
  // the supported four-digit planning range so date-only arithmetic is exact.
  if (year < 100 || year > 9999) return false;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export function validMonth(value: string): boolean {
  return (
    ISO_MONTH.test(value) && Number(value.slice(0, 4)) >= 100 && Number(value.slice(0, 4)) <= 9999
  );
}

export function monthDate(month: string): { year: number; monthIndex: number } {
  if (!validMonth(month)) throw new DomainValidationError(`Invalid month '${month}'`);
  const [yearText, monthText] = month.split('-');
  return { year: Number(yearText), monthIndex: Number(monthText) - 1 };
}

export function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(`${label} must be finite and non-negative`);
  }
}

export function assertSupportedPm(value: number): number {
  assertNonNegativeFinite(value, 'Person-month amount');
  if (value > DOMAIN_LIMITS.maxAllocationPm) {
    throw new DomainValidationError(
      `Person-month amount must be at most ${DOMAIN_LIMITS.maxAllocationPm}`,
    );
  }
  return value;
}

export function assertFiniteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new DomainValidationError(`${label} overflowed numeric precision`);
  }
  return value;
}

export function assertNever(value: never): never {
  throw new DomainValidationError(`Unsupported value '${String(value)}'`);
}
