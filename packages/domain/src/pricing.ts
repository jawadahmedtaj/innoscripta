import type { AllocationUnit, Currency, Employee, RateRecord } from '@baseline/contracts';
import { monthlyCapacity, workingDays } from './calendar';
import {
  assertFiniteResult,
  assertNever,
  assertNonNegativeFinite,
  assertSupportedPm,
  CURRENCY_RATES,
  DomainValidationError,
  DOMAIN_LIMITS,
  type MonthPricing,
  type PriceSegment,
} from './shared';

export type { MonthPricing, PriceSegment } from './shared';

export function priceMonth(
  employee: Employee,
  rates: readonly RateRecord[],
  month: string,
): MonthPricing {
  const calendar = workingDays(month);
  const capacity = monthlyCapacity(employee, month);
  const sortedRates = rates
    .filter((rate) => rate.employeeId === employee.id)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id));
  sortedRates.forEach((rate) => {
    assertNonNegativeFinite(rate.hourlyCost, `Hourly cost for rate '${rate.id}'`);
    if (rate.hourlyCost > DOMAIN_LIMITS.maxHourlyCost) {
      throw new DomainValidationError(`Hourly cost must be at most ${DOMAIN_LIMITS.maxHourlyCost}`);
    }
  });
  const segmentByRate = new Map<
    string,
    { workingDays: number; hourlyCost: number; validFrom: string }
  >();
  let missingWorkingDays = 0;
  calendar.forEach((date) => {
    let selected: RateRecord | undefined;
    for (const rate of sortedRates) {
      if (rate.validFrom <= date) selected = rate;
      else break;
    }
    if (selected === undefined) {
      missingWorkingDays += 1;
      return;
    }
    const prior = segmentByRate.get(selected.id);
    if (prior === undefined) {
      segmentByRate.set(selected.id, {
        workingDays: 1,
        hourlyCost: selected.hourlyCost,
        validFrom: selected.validFrom,
      });
    } else {
      prior.workingDays += 1;
    }
  });
  const segments: PriceSegment[] = [...segmentByRate.values()].map((segment) => {
    const costPerPm = segment.workingDays * capacity.dailyCapacityHours * segment.hourlyCost;
    assertFiniteResult(costPerPm, 'Rate segment cost');
    return { ...segment, costPerPm };
  });
  const costPerPm = segments.reduce((sum, segment) => sum + segment.costPerPm, 0);
  assertFiniteResult(costPerPm, 'Monthly cost per person-month');
  return { month, capacityHours: capacity.capacityHours, costPerPm, missingWorkingDays, segments };
}

export function currencyMultiplier(currency: Currency): number {
  return CURRENCY_RATES[currency];
}

export function fromPm(
  amount: number,
  unit: AllocationUnit,
  employee: Employee,
  rates: readonly RateRecord[],
  month: string,
  currency: Currency = 'EUR',
): number {
  assertSupportedPm(amount);
  const capacity = monthlyCapacity(employee, month);
  switch (unit) {
    case 'pm':
      return amount;
    case 'hours':
      return assertFiniteResult(amount * capacity.capacityHours, 'Hours conversion');
    case 'percent':
      return assertFiniteResult(amount * 100, 'Percentage conversion');
    case 'cost':
      return assertFiniteResult(
        amount * priceMonth(employee, rates, month).costPerPm * currencyMultiplier(currency),
        'Cost conversion',
      );
    default:
      return assertNever(unit);
  }
}

export function toPm(
  input: number,
  unit: AllocationUnit,
  employee: Employee,
  rates: readonly RateRecord[],
  month: string,
  currency: Currency = 'EUR',
): number {
  assertNonNegativeFinite(input, `${unit} input`);
  const capacity = monthlyCapacity(employee, month);
  switch (unit) {
    case 'pm':
      assertSupportedPm(input);
      return input;
    case 'hours':
      if (capacity.capacityHours === 0) {
        throw new DomainValidationError('Cannot convert hours without monthly capacity');
      }
      return assertSupportedPm(
        assertFiniteResult(input / capacity.capacityHours, 'Hours inverse conversion'),
      );
    case 'percent':
      return assertSupportedPm(assertFiniteResult(input / 100, 'Percentage inverse conversion'));
    case 'cost': {
      const pricing = priceMonth(employee, rates, month);
      if (pricing.missingWorkingDays > 0) {
        throw new DomainValidationError(
          'Cost editing is unavailable because this month has incomplete cost-rate coverage',
        );
      }
      const costPerPm = pricing.costPerPm * currencyMultiplier(currency);
      if (costPerPm <= 0) {
        throw new DomainValidationError(
          'Cost editing is unavailable because this month has no priced working days',
        );
      }
      return assertSupportedPm(assertFiniteResult(input / costPerPm, 'Cost inverse conversion'));
    }
    default:
      return assertNever(unit);
  }
}
