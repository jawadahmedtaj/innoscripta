import type {
  Allocation,
  BreakdownItem,
  Employee,
  PlanningData,
  Project,
  RateRecord,
  SeedData,
} from '@baseline/contracts';
import { monthlyCapacity } from './calendar';
import {
  DomainValidationError,
  DOMAIN_LIMITS,
  FX_RATES,
  isRecord,
  SUPPORTED_HOURS,
  validDate,
  validMonth,
} from './shared';

function stringField(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(`${field} must be a non-empty string`);
    return '';
  }
  return value;
}

function finiteNumber(
  value: unknown,
  field: string,
  issues: string[],
  nonNegative = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegative && value < 0)) {
    issues.push(`${field} must be a finite${nonNegative ? ' non-negative' : ''} number`);
    return 0;
  }
  return value;
}

function ensureUnique(values: readonly string[], label: string, issues: string[]): void {
  const seen = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) issues.push(`Duplicate ${label} '${value}'`);
    seen.add(value);
  });
}

function validateDatasetDisplaySafety(
  employees: readonly Employee[],
  rates: readonly RateRecord[],
  allocations: readonly Allocation[],
  issues: string[],
): void {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const maxRateByEmployee = new Map<string, number>();
  rates.forEach((rate) =>
    maxRateByEmployee.set(
      rate.employeeId,
      Math.max(maxRateByEmployee.get(rate.employeeId) ?? 0, rate.hourlyCost),
    ),
  );
  let pmTicks = 0;
  let hoursTicks = 0;
  let percentTicks = 0;
  let costTicks = 0;
  allocations.forEach((allocation) => {
    const employee = employeeById.get(allocation.employeeId);
    if (employee === undefined) return;
    const capacityHours = monthlyCapacity(employee, allocation.month).capacityHours;
    const pm = allocation.amount;
    pmTicks += pm * 100;
    hoursTicks += pm * capacityHours * 100;
    percentTicks += pm * 100 * 10;
    // USD is the highest illustrative FX multiplier. The employee's maximum
    // rate bounds every effective-rate blend used for this allocation.
    costTicks +=
      pm * capacityHours * (maxRateByEmployee.get(employee.id) ?? 0) * FX_RATES.USD * 100;
  });
  const totals: readonly [string, number][] = [
    ['PM', pmTicks],
    ['hours', hoursTicks],
    ['percentage', percentTicks],
    ['cost', costTicks],
  ];
  totals.forEach(([unit, total]) => {
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER)
      issues.push(`Dataset ${unit} display reconciliation exceeds safe numeric precision`);
  });
}

function parseEmployee(value: unknown, index: number, issues: string[]): Employee | undefined {
  if (!isRecord(value)) {
    issues.push(`employees[${index}] must be an object`);
    return undefined;
  }
  const id = stringField(value.id, `employees[${index}].id`, issues);
  const name = stringField(value.name, `employees[${index}].name`, issues);
  const role = stringField(value.role, `employees[${index}].role`, issues);
  const weeklyHours = finiteNumber(value.weeklyHours, `employees[${index}].weeklyHours`, issues);
  if (!SUPPORTED_HOURS.has(weeklyHours)) {
    issues.push(`employees[${index}].weeklyHours must be 20, 32, or 40`);
  }
  return { id, name, role, weeklyHours };
}

function parseRate(value: unknown, index: number, issues: string[]): RateRecord | undefined {
  if (!isRecord(value)) {
    issues.push(`rateRecords[${index}] must be an object`);
    return undefined;
  }
  const id = stringField(value.id, `rateRecords[${index}].id`, issues);
  const employeeId = stringField(value.employeeId, `rateRecords[${index}].employeeId`, issues);
  const validFrom = stringField(value.validFrom, `rateRecords[${index}].validFrom`, issues);
  const hourlyCost = finiteNumber(
    value.hourlyCost,
    `rateRecords[${index}].hourlyCost`,
    issues,
    true,
  );
  if (hourlyCost > DOMAIN_LIMITS.maxHourlyCost)
    issues.push(`rateRecords[${index}].hourlyCost must be at most ${DOMAIN_LIMITS.maxHourlyCost}`);
  if (validFrom !== '' && !validDate(validFrom))
    issues.push(`rateRecords[${index}].validFrom must be a real YYYY-MM-DD date`);
  return { id, employeeId, validFrom, hourlyCost };
}

function parseProject(value: unknown, index: number, issues: string[]): Project | undefined {
  if (!isRecord(value)) {
    issues.push(`projects[${index}] must be an object`);
    return undefined;
  }
  const id = stringField(value.id, `projects[${index}].id`, issues);
  const name = stringField(value.name, `projects[${index}].name`, issues);
  const startDate = stringField(value.startDate, `projects[${index}].startDate`, issues);
  const endDate = stringField(value.endDate, `projects[${index}].endDate`, issues);
  if (startDate !== '' && !validDate(startDate))
    issues.push(`projects[${index}].startDate must be a real YYYY-MM-DD date`);
  if (endDate !== '' && !validDate(endDate))
    issues.push(`projects[${index}].endDate must be a real YYYY-MM-DD date`);
  if (validDate(startDate) && validDate(endDate) && startDate > endDate)
    issues.push(`projects[${index}] endDate must not precede startDate`);
  return { id, name, startDate, endDate };
}

function parseItem(value: unknown, index: number, issues: string[]): BreakdownItem | undefined {
  if (!isRecord(value)) {
    issues.push(`breakdownItems[${index}] must be an object`);
    return undefined;
  }
  const id = stringField(value.id, `breakdownItems[${index}].id`, issues);
  const projectId = stringField(value.projectId, `breakdownItems[${index}].projectId`, issues);
  let parentId: string | null = null;
  if (value.parentId !== null && typeof value.parentId !== 'string') {
    issues.push(`breakdownItems[${index}].parentId must be a string or null`);
  } else if (typeof value.parentId === 'string') parentId = value.parentId;
  const name = stringField(value.name, `breakdownItems[${index}].name`, issues);
  return { id, projectId, parentId, name };
}

function parseAllocation(value: unknown, index: number, issues: string[]): Allocation | undefined {
  if (!isRecord(value)) {
    issues.push(`allocations[${index}] must be an object`);
    return undefined;
  }
  const id = stringField(value.id, `allocations[${index}].id`, issues);
  const breakdownItemId = stringField(
    value.breakdownItemId,
    `allocations[${index}].breakdownItemId`,
    issues,
  );
  const employeeId = stringField(value.employeeId, `allocations[${index}].employeeId`, issues);
  const month = stringField(value.month, `allocations[${index}].month`, issues);
  const amount = finiteNumber(value.amount, `allocations[${index}].amount`, issues, true);
  if (amount > DOMAIN_LIMITS.maxAllocationPm)
    issues.push(
      `allocations[${index}].amount must be at most ${DOMAIN_LIMITS.maxAllocationPm} person-months`,
    );
  if (month !== '' && !validMonth(month))
    issues.push(`allocations[${index}].month must be YYYY-MM`);
  let editSequence: number | undefined;
  if (value.editSequence !== undefined) {
    if (
      typeof value.editSequence !== 'number' ||
      !Number.isSafeInteger(value.editSequence) ||
      value.editSequence < 0
    ) {
      issues.push(`allocations[${index}].editSequence must be a non-negative integer`);
    } else editSequence = value.editSequence;
  }
  let editedBy: string | undefined;
  if (value.editedBy !== undefined) {
    if (typeof value.editedBy !== 'string' || value.editedBy.length === 0)
      issues.push(`allocations[${index}].editedBy must be a non-empty string`);
    else editedBy = value.editedBy;
  }
  if (editSequence === undefined && editedBy !== undefined)
    issues.push(`allocations[${index}] editedBy requires editSequence`);
  if (editSequence !== undefined && editedBy === undefined)
    issues.push(`allocations[${index}] editSequence requires editedBy`);
  const parsed: Allocation = { id, breakdownItemId, employeeId, month, amount };
  if (editSequence !== undefined) parsed.editSequence = editSequence;
  if (editedBy !== undefined) parsed.editedBy = editedBy;
  return parsed;
}

function parseMeta(value: unknown, issues: string[]): SeedData['meta'] {
  if (!isRecord(value)) {
    issues.push('meta must be an object');
    return { name: '', version: '', gridHorizon: { from: '', to: '' }, note: '' };
  }
  const name = stringField(value.name, 'meta.name', issues);
  const version = stringField(value.version, 'meta.version', issues);
  const note = stringField(value.note, 'meta.note', issues);
  const horizonValue = value.gridHorizon;
  let from = '';
  let to = '';
  if (!isRecord(horizonValue)) issues.push('meta.gridHorizon must be an object');
  else {
    from = stringField(horizonValue.from, 'meta.gridHorizon.from', issues);
    to = stringField(horizonValue.to, 'meta.gridHorizon.to', issues);
    if (!validMonth(from)) issues.push('meta.gridHorizon.from must be YYYY-MM');
    if (!validMonth(to)) issues.push('meta.gridHorizon.to must be YYYY-MM');
    if (validMonth(from) && validMonth(to) && from > to)
      issues.push('meta.gridHorizon.to must not precede from');
  }
  return { name, version, gridHorizon: { from, to }, note };
}

/** Validate the complete seed boundary, preserving all supplied records. */
export function validatePlanningData(input: unknown): PlanningData {
  if (!isRecord(input)) throw new DomainValidationError('Planning data must be an object');
  const seed = validateSeedShape(input);
  const issues: string[] = [];
  const revision = finiteNumber(input.revision, 'revision', issues);
  const editSequence = finiteNumber(input.editSequence, 'editSequence', issues);
  if (!Number.isSafeInteger(revision) || revision < 0)
    issues.push('revision must be a non-negative integer');
  if (!Number.isSafeInteger(editSequence) || editSequence < 0)
    issues.push('editSequence must be a non-negative integer');
  const highestAllocationSequence = seed.allocations.reduce(
    (highest, allocation) => Math.max(highest, allocation.editSequence ?? 0),
    0,
  );
  if (Number.isSafeInteger(editSequence) && editSequence < highestAllocationSequence)
    issues.push('editSequence must be at least the highest allocation editSequence');
  if (issues.length > 0) throw new DomainValidationError(issues);
  return { ...seed, revision, editSequence };
}

/** Validate and parse untrusted seed JSON at the application boundary. */
export function parseSeed(input: unknown): SeedData {
  if (!isRecord(input)) throw new DomainValidationError('Seed data must be an object');
  const data = validateSeedShape(input);
  return data;
}

function validateSeedShape(input: Record<string, unknown>): SeedData {
  const issues: string[] = [];
  const meta = parseMeta(input.meta, issues);
  const employees = Array.isArray(input.employees)
    ? input.employees
        .map((value, index) => parseEmployee(value, index, issues))
        .filter((value): value is Employee => value !== undefined)
    : [];
  if (!Array.isArray(input.employees)) issues.push('employees must be an array');
  const rates = Array.isArray(input.rateRecords)
    ? input.rateRecords
        .map((value, index) => parseRate(value, index, issues))
        .filter((value): value is RateRecord => value !== undefined)
    : [];
  if (!Array.isArray(input.rateRecords)) issues.push('rateRecords must be an array');
  const projects = Array.isArray(input.projects)
    ? input.projects
        .map((value, index) => parseProject(value, index, issues))
        .filter((value): value is Project => value !== undefined)
    : [];
  if (!Array.isArray(input.projects)) issues.push('projects must be an array');
  const items = Array.isArray(input.breakdownItems)
    ? input.breakdownItems
        .map((value, index) => parseItem(value, index, issues))
        .filter((value): value is BreakdownItem => value !== undefined)
    : [];
  if (!Array.isArray(input.breakdownItems)) issues.push('breakdownItems must be an array');
  const allocations = Array.isArray(input.allocations)
    ? input.allocations
        .map((value, index) => parseAllocation(value, index, issues))
        .filter((value): value is Allocation => value !== undefined)
    : [];
  if (!Array.isArray(input.allocations)) issues.push('allocations must be an array');
  ensureUnique(
    employees.map((value) => value.id),
    'employee id',
    issues,
  );
  ensureUnique(
    rates.map((value) => value.id),
    'rate id',
    issues,
  );
  ensureUnique(
    projects.map((value) => value.id),
    'project id',
    issues,
  );
  ensureUnique(
    items.map((value) => value.id),
    'breakdown item id',
    issues,
  );
  ensureUnique(
    allocations.map((value) => value.id),
    'allocation id',
    issues,
  );
  const employeeIds = new Set(employees.map((value) => value.id));
  const projectIds = new Set(projects.map((value) => value.id));
  const itemById = new Map(items.map((value) => [value.id, value]));
  rates.forEach((rate) => {
    if (!employeeIds.has(rate.employeeId))
      issues.push(`Rate '${rate.id}' references missing employee '${rate.employeeId}'`);
  });
  const rateKeys = new Set<string>();
  rates.forEach((rate) => {
    const key = `${rate.employeeId}|${rate.validFrom}`;
    if (rateKeys.has(key)) issues.push(`Duplicate rate effective date '${key}'`);
    rateKeys.add(key);
  });
  items.forEach((item) => {
    if (!projectIds.has(item.projectId))
      issues.push(`Breakdown item '${item.id}' references missing project '${item.projectId}'`);
    if (item.parentId !== null) {
      const parent = itemById.get(item.parentId);
      if (parent === undefined)
        issues.push(`Breakdown item '${item.id}' references missing parent '${item.parentId}'`);
      else if (parent.projectId !== item.projectId)
        issues.push(`Breakdown item '${item.id}' crosses project boundary`);
    }
  });
  items.forEach((item) => {
    const visited = new Set<string>();
    let current: BreakdownItem | undefined = item;
    let depth = 0;
    while (current !== undefined && current.parentId !== null) {
      if (visited.has(current.id)) {
        issues.push(`Breakdown cycle includes '${current.id}'`);
        break;
      }
      visited.add(current.id);
      depth += 1;
      // depth counts parent edges; three edges would place this item at level four.
      if (depth >= 3)
        issues.push(`Breakdown item '${item.id}' exceeds the three-level depth limit`);
      current = itemById.get(current.parentId);
    }
  });
  const allocationKeys = new Set<string>();
  allocations.forEach((allocation) => {
    if (!employeeIds.has(allocation.employeeId))
      issues.push(
        `Allocation '${allocation.id}' references missing employee '${allocation.employeeId}'`,
      );
    const item = itemById.get(allocation.breakdownItemId);
    if (item === undefined)
      issues.push(
        `Allocation '${allocation.id}' references missing breakdown item '${allocation.breakdownItemId}'`,
      );
    else if (items.some((child) => child.parentId === item.id))
      issues.push(`Allocation '${allocation.id}' references non-leaf item '${item.id}'`);
    const key = `${allocation.breakdownItemId}|${allocation.employeeId}|${allocation.month}`;
    if (allocationKeys.has(key)) issues.push(`Duplicate allocation cell '${key}'`);
    allocationKeys.add(key);
    if (allocation.editedBy !== undefined && !employeeIds.has(allocation.editedBy))
      issues.push(
        `Allocation '${allocation.id}' editedBy references missing employee '${allocation.editedBy}'`,
      );
  });
  if (issues.length === 0) validateDatasetDisplaySafety(employees, rates, allocations, issues);
  if (issues.length > 0) throw new DomainValidationError(issues);
  return { meta, employees, rateRecords: rates, projects, breakdownItems: items, allocations };
}

