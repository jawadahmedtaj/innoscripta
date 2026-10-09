import type { AllocationUnit } from '@baseline/contracts';
import {
  assertFiniteResult,
  assertNever,
  DomainValidationError,
} from './shared';

export function precisionForUnit(unit: AllocationUnit): number {
  switch (unit) {
    case 'hours':
      return 2;
    case 'pm':
      return 2;
    case 'percent':
      return 1;
    case 'cost':
      return 2;
    default:
      return assertNever(unit);
  }
}

export function roundToPrecision(value: number, decimals: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(decimals) || decimals < 0) {
    throw new DomainValidationError('Invalid precision input');
  }
  const scale = 10 ** decimals;
  const scaled = assertFiniteResult((value + Number.EPSILON) * scale, 'Display rounding');
  const roundedTicks = Math.round(scaled);
  if (!Number.isSafeInteger(roundedTicks)) {
    throw new DomainValidationError('Display rounding exceeds safe integer precision');
  }
  return roundedTicks / scale;
}

export function formatUnitValue(value: number, unit: AllocationUnit): string {
  return roundToPrecision(value, precisionForUnit(unit)).toFixed(precisionForUnit(unit));
}

/** Largest-remainder display reconciliation. IDs break equal remainder ties deterministically. */
export function reconcile(
  values: readonly { id: string; value: number }[],
  decimals: number,
): Record<string, number> {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new DomainValidationError('Decimals must be an integer from 0 to 8');
  }
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    throw new DomainValidationError('Reconciliation IDs must be unique');
  }
  if (values.length === 0) return {};
  values.forEach((value) => {
    if (!Number.isFinite(value.value)) {
      throw new DomainValidationError(`Reconciliation value '${value.id}' must be finite`);
    }
  });
  const scale = 10 ** decimals;
  const scaledValues = values.map((value) =>
    assertFiniteResult(value.value * scale, `Reconciliation value '${value.id}'`),
  );
  const floors = scaledValues.map((value) => Math.floor(value));
  if (floors.some((value) => !Number.isSafeInteger(value))) {
    throw new DomainValidationError('Reconciliation exceeds safe integer precision');
  }
  const remainders = values.map((value, index) => ({
    id: value.id,
    index,
    remainder: (scaledValues[index] ?? 0) - (floors[index] ?? 0),
  }));
  const target = Math.round(
    assertFiniteResult(
      values.reduce((sum, value) => sum + value.value, 0) * scale,
      'Reconciliation total',
    ),
  );
  if (!Number.isSafeInteger(target)) {
    throw new DomainValidationError('Reconciliation total exceeds safe integer precision');
  }
  let residual = target - floors.reduce((sum, value) => sum + value, 0);
  const ticks = [...floors];
  const descending = [...remainders].sort(
    (a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id),
  );
  const ascending = [...remainders].sort(
    (a, b) => a.remainder - b.remainder || a.id.localeCompare(b.id),
  );
  if (residual > 0) {
    for (let index = 0; residual > 0; index += 1) {
      const targetValue = descending[index % descending.length];
      if (targetValue !== undefined) {
        ticks[targetValue.index] = (ticks[targetValue.index] ?? 0) + 1;
      }
      residual -= 1;
    }
  } else if (residual < 0) {
    for (let index = 0; residual < 0; index += 1) {
      const targetValue = ascending[index % ascending.length];
      if (targetValue !== undefined) {
        ticks[targetValue.index] = (ticks[targetValue.index] ?? 0) - 1;
      }
      residual += 1;
    }
  }
  if (ticks.some((value) => !Number.isSafeInteger(value))) {
    throw new DomainValidationError('Reconciliation ticks exceed safe integer precision');
  }
  return Object.fromEntries(values.map((value, index) => [value.id, (ticks[index] ?? 0) / scale]));
}

