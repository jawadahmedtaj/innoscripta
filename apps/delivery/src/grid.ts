import type { AllocationUnit, Currency, Employee, PlanningData } from '@baseline/contracts';
import { fromPm, leafIds, precisionForUnit, reconcile } from '@baseline/domain';

export interface GridProjectionInput {
  data: PlanningData;
  itemId: string | null;
  /** Required only for the project-total view, where itemId is null. */
  projectId?: string;
  employees: readonly Employee[];
  months: readonly string[];
  unit: AllocationUnit;
  currency: Currency;
}

export interface GridProjection {
  cellValues: ReadonlyMap<string, number>;
  rowTotals: ReadonlyMap<string, number>;
  columnTotals: ReadonlyMap<string, number>;
  grandTotal: number | undefined;
  totalsNote: string;
}

function cellId(employeeId: string, month: string): string {
  return `${employeeId}:${month}`;
}

/**
 * Rounds one complete grid scope once. Totals are then sums of those displayed
 * cells, so filtering the table never changes the reconciliation scope.
 */
export function projectGrid(input: GridProjectionInput): GridProjection {
  const precision = precisionForUnit(input.unit);
  const itemProjectId =
    input.itemId === null
      ? input.projectId
      : input.data.breakdownItems.find((candidate) => candidate.id === input.itemId)?.projectId;
  const project = input.data.breakdownItems.filter((item) => item.projectId === itemProjectId);
  const projectLeafIds = new Set(
    project
      .filter((item) => !project.some((candidate) => candidate.parentId === item.id))
      .map((item) => item.id),
  );
  const selectedLeafIds =
    input.itemId === null
      ? projectLeafIds
      : new Set(leafIds(input.data.breakdownItems, input.itemId));
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const projectAllocations = input.data.allocations.filter((allocation) =>
    projectLeafIds.has(allocation.breakdownItemId),
  );
  const raw = projectAllocations.flatMap((allocation) => {
    const employee = employeeById.get(allocation.employeeId);
    return employee === undefined
      ? []
      : [
          {
            id: allocation.id,
            employeeId: allocation.employeeId,
            month: allocation.month,
            breakdownItemId: allocation.breakdownItemId,
            value: fromPm(
              allocation.amount,
              input.unit,
              employee,
              input.data.rateRecords,
              allocation.month,
              input.currency,
            ),
          },
        ];
  });
  const scale = 10 ** precision;
  const reconciled = reconcile(
    raw.map(({ id, value }) => ({ id, value })),
    precision,
  );
  const allocationTicks = new Map(
    raw.map(({ id }) => [id, Math.round((reconciled[id] ?? 0) * scale)]),
  );
  const cellTicks = new Map<string, number>();
  input.employees.forEach((employee) =>
    input.months.forEach((month) => {
      const ticks = projectAllocations.reduce((sum, allocation) => {
        if (
          !selectedLeafIds.has(allocation.breakdownItemId) ||
          allocation.employeeId !== employee.id ||
          allocation.month !== month
        )
          return sum;
        return sum + (allocationTicks.get(allocation.id) ?? 0);
      }, 0);
      cellTicks.set(cellId(employee.id, month), ticks);
    }),
  );
  const cellValues = new Map([...cellTicks.entries()].map(([id, ticks]) => [id, ticks / scale]));
  const rowTotals = new Map<string, number>();
  input.employees.forEach((employee) => {
    rowTotals.set(
      employee.id,
      input.months.reduce(
        (sum, month) => sum + (cellTicks.get(cellId(employee.id, month)) ?? 0),
        0,
      ) / scale,
    );
  });
  const columnTotals = new Map<string, number>();
  input.months.forEach((month) => {
    columnTotals.set(
      month,
      input.employees.reduce(
        (sum, employee) => sum + (cellTicks.get(cellId(employee.id, month)) ?? 0),
        0,
      ) / scale,
    );
  });
  const grandTicks = [...cellTicks.values()].reduce((sum, ticks) => sum + ticks, 0);
  const grandTotal = input.unit === 'percent' ? undefined : grandTicks / scale;
  return {
    cellValues,
    rowTotals,
    columnTotals,
    grandTotal,
    totalsNote:
      input.unit === 'percent'
        ? 'Percentage cells are each a person’s share of that person’s monthly capacity; aggregate percentages are intentionally omitted.'
        : `Displayed ${input.unit} cells and totals share one ${precision}-decimal allocation reconciliation across ${projectLeafIds.size} project leaves, all people, and all months.`,
  };
}

export function gridCellId(employeeId: string, month: string): string {
  return cellId(employeeId, month);
}
