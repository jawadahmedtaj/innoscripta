export { DomainValidationError, DOMAIN_LIMITS, FX_RATES } from './shared';
export type {
  CapacityResult,
  DeleteTreeResult,
  MonthPricing,
  MonthlyCapacity,
  PriceSegment,
} from './shared';

export { workingDays, monthlyCapacity, gridMonths } from './calendar';
export { currencyMultiplier, fromPm, priceMonth, toPm } from './pricing';
export { formatUnitValue, precisionForUnit, reconcile, roundToPrecision } from './rounding';
export {
  aggregateAllocation,
  createBreakdownItem,
  deleteBreakdownItem,
  descendants,
  leafIds,
  moveBreakdownItem,
  renameBreakdownItem,
} from './tree';
export { getCapacity } from './capacity';
export { parseSeed, validatePlanningData } from './validation';

/** Public alias used by display code when selecting precision for an allocation unit. */
export { precisionForUnit as unitPrecision } from './rounding';
