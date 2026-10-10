import React from 'react';
import type {
  Allocation,
  AllocationUnit,
  BreakdownItem,
  Currency,
  Employee,
  PlanningData,
  Project,
  RateRecord,
} from '@baseline/contracts';
import { getCapacity as domainGetCapacity, priceMonth } from '@baseline/domain';
import type { MonthPricing } from '@baseline/domain';
import { formatNumber } from '@baseline/platform';
import type { GridProjection } from './grid';
import { gridCellId } from './grid';

export type Month = string;
export type TreeItem = BreakdownItem & { children: TreeItem[] };

export const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: '€', USD: '$', GBP: '£' };
export const UNIT_LABELS: Record<AllocationUnit, string> = {
  pm: 'Person-months',
  hours: 'Hours',
  percent: 'Percentage',
  cost: 'Cost',
};

export function tree(items: readonly BreakdownItem[], projectId: string): TreeItem[] {
  const make = (item: BreakdownItem): TreeItem => ({
    ...item,
    children: items.filter((candidate) => candidate.parentId === item.id).map(make),
  });
  return items.filter((item) => item.projectId === projectId && item.parentId === null).map(make);
}

/** Include the complete path and ID so duplicate fixture names remain selectable. */
export function treeOptionLabel(items: readonly BreakdownItem[], itemId: string): string {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(itemId);
  while (current !== undefined) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    path.push(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return `${path.reverse().join(' / ')} · ${itemId}`;
}

export function displayName(employee: Employee): string {
  return employee.name.length > 20 ? employee.name.slice(0, 19) + '…' : employee.name;
}

export function employeeRates(employeeId: string, rates: readonly RateRecord[]): RateRecord[] {
  return rates
    .filter((rate) => rate.employeeId === employeeId)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

export function costPerPm(
  employee: Employee,
  rates: readonly RateRecord[],
  month: Month,
): { cost: number; missing: boolean } {
  const pricing = priceMonth(employee, rates, month);
  return { cost: pricing.costPerPm, missing: pricing.missingWorkingDays > 0 };
}

function allocationFor(
  allocations: readonly Allocation[],
  itemIds: readonly string[],
  employeeId: string,
  month: Month,
): number {
  return allocations.reduce(
    (sum, allocation) =>
      itemIds.includes(allocation.breakdownItemId) &&
      allocation.employeeId === employeeId &&
      allocation.month === month
        ? sum + allocation.amount
        : sum,
    0,
  );
}

function contributorLabel(
  allocation: Allocation | undefined,
  items: readonly BreakdownItem[],
  projects: readonly Project[],
): string {
  if (allocation === undefined) return '';
  const item = items.find((candidate) => candidate.id === allocation.breakdownItemId);
  const project =
    item === undefined ? undefined : projects.find((candidate) => candidate.id === item.projectId);
  const provenance =
    allocation.editSequence === undefined ? 'seed convention' : `edit ${allocation.editSequence}`;
  return `${project?.name ?? 'Unknown project'} · ${item?.name ?? allocation.breakdownItemId} · ${allocation.id} · ${provenance}`;
}

export function TreeNode({
  item,
  selectedId,
  onSelect,
}: {
  item: TreeItem;
  selectedId: string;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <li>
      <button
        className={item.id === selectedId ? 'tree-node selected' : 'tree-node'}
        type="button"
        onClick={() => onSelect(item.id)}
        aria-label={item.name}
        aria-current={item.id === selectedId ? 'true' : undefined}
      >
        {item.name}{' '}
        <span className="muted">
          {item.children.length ? `(${item.children.length})` : '· leaf'}
        </span>
      </button>
      {item.children.length > 0 && (
        <ul>
          {item.children.map((child) => (
            <TreeNode key={child.id} item={child} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface StaffingTableProps {
  snapshot: PlanningData;
  projects: readonly Project[];
  selectedRates: readonly RateRecord[];
  employeeRows: readonly Employee[];
  hiddenEmployees: readonly Employee[];
  months: readonly Month[];
  leafIds: readonly string[];
  selectedIsLeaf: boolean;
  unit: AllocationUnit;
  currency: Currency;
  projection: GridProjection;
  onEdit: (employeeId: string, month: Month) => void;
}

export function StaffingTable(props: StaffingTableProps): React.ReactElement {
  const {
    snapshot,
    projects,
    selectedRates,
    employeeRows,
    hiddenEmployees,
    months,
    leafIds,
    selectedIsLeaf,
    unit,
    currency,
    projection,
    onEdit,
  } = props;
  return (
    <div className="table-scroll">
      <table className="staffing-table">
        <caption className="sr-only">{UNIT_LABELS[unit]} by employee and month</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            {months.map((month) => (
              <th scope="col" key={month}>
                {month}
              </th>
            ))}
            <th scope="col">{unit === 'percent' ? 'Total omitted' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          {employeeRows.map((employee) => (
            <tr key={employee.id}>
              <th scope="row">
                <span>{displayName(employee)}</span>
                <small>
                  {employee.role} · {employee.weeklyHours}h/wk
                </small>
              </th>
              {months.map((month) => {
                const pm = allocationFor(snapshot.allocations, leafIds, employee.id, month);
                const capacity = domainGetCapacity(snapshot.allocations, employee.id, month);
                const pricing = costPerPm(employee, selectedRates, month);
                const value = projection.cellValues.get(gridCellId(employee.id, month)) ?? 0;
                const label = `${employee.name}, ${month}, ${UNIT_LABELS[unit]}, ${formatNumber(value, unit === 'percent' ? 1 : 2)}${capacity.overCapacity ? ', over capacity' : ''}`;
                const provenance = contributorLabel(
                  capacity.latest,
                  snapshot.breakdownItems,
                  projects,
                );
                return (
                  <td
                    key={month}
                    className={capacity.overCapacity ? 'over-capacity' : undefined}
                    title={provenance || undefined}
                  >
                    {selectedIsLeaf ? (
                      <button
                        type="button"
                        className="cell-button"
                        aria-label={label}
                        onClick={() => onEdit(employee.id, month)}
                      >
                        {unit === 'cost' && <span>{CURRENCY_SYMBOL[currency]}</span>}
                        {formatNumber(value, unit === 'percent' ? 1 : 2)}
                      </button>
                    ) : (
                      <span aria-label={label}>
                        {formatNumber(value, unit === 'percent' ? 1 : 2)}
                      </span>
                    )}
                    {capacity.overCapacity && (
                      <span
                        className="over-capacity-flag"
                        aria-label={`Over capacity; latest contributor ${provenance}`}
                      >
                        ⚠
                      </span>
                    )}
                    {pricing.missing && pm > 0 && (
                      <span
                        className="missing-rate"
                        title="One or more working days has no cost rate"
                      >
                        !
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="total-cell">
                {unit === 'percent'
                  ? '—'
                  : formatNumber(projection.rowTotals.get(employee.id) ?? 0, 2)}
              </td>
            </tr>
          ))}
        </tbody>
        {unit !== 'percent' && (
          <tfoot>
            {hiddenEmployees.length > 0 && (
              <tr>
                <th scope="row">Other people ({hiddenEmployees.length})</th>
                {months.map((month) => (
                  <td key={month}>
                    {formatNumber(
                      hiddenEmployees.reduce(
                        (sum, employee) =>
                          sum + (projection.cellValues.get(gridCellId(employee.id, month)) ?? 0),
                        0,
                      ),
                      2,
                    )}
                  </td>
                ))}
                <td>
                  {formatNumber(
                    hiddenEmployees.reduce(
                      (sum, employee) => sum + (projection.rowTotals.get(employee.id) ?? 0),
                      0,
                    ),
                    2,
                  )}
                </td>
              </tr>
            )}
            <tr>
              <th scope="row">All people · reconciled</th>
              {months.map((month) => (
                <td key={month}>{formatNumber(projection.columnTotals.get(month) ?? 0, 2)}</td>
              ))}
              <td>{formatNumber(projection.grandTotal ?? 0, 2)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export interface ReferencePanelProps {
  available: boolean;
  currency: Currency;
  pm: number;
  percent: number;
  hours: number;
  capacityHours: number;
  cost: number;
  pricing: MonthPricing;
  segmentText: string;
  onOpen: () => void;
}

export function ReferencePanel(props: ReferencePanelProps): React.ReactElement {
  return (
    <section className="panel reference-panel">
      <div>
        <p className="eyebrow">Reference calculation</p>
        <h2>Adaeze Okafor · March 2026</h2>
        <p className="muted">
          Live values from alloc-001. March is preserved even though it sits before the advertised
          Apr 2026–Mar 2027 horizon.
        </p>
        {!props.available && (
          <p className="error">
            Reference assignment deleted; restore wbs-012 and alloc-001 to reopen it.
          </p>
        )}
      </div>
      <dl className="reference-stats">
        <div>
          <dt>Working days</dt>
          <dd>22</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{formatNumber(props.capacityHours, 2)} h</dd>
        </div>
        <div>
          <dt>Allocation</dt>
          <dd>
            {formatNumber(props.pm, 2)} PM · {formatNumber(props.percent, 1)}% ·{' '}
            {formatNumber(props.hours, 2)} h
          </dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>
            {CURRENCY_SYMBOL[props.currency]}
            {formatNumber(props.cost, 2)}
          </dd>
        </div>
      </dl>
      <p className="muted reference-detail">
        Current rate segments: {props.segmentText || 'no priced days'}
        {props.pricing.missingWorkingDays > 0
          ? `; ${props.pricing.missingWorkingDays} working days missing a rate`
          : ''}
        . Seed expectation: 8 × 4 h × €80 + 14 × 4 h × €95 = €7,880.00.
      </p>
      <button type="button" className="button" disabled={!props.available} onClick={props.onOpen}>
        Open reference cell
      </button>
    </section>
  );
}
