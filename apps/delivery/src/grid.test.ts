import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Currency, PlanningData } from '@baseline/contracts';
import { gridMonths, parseSeed } from '@baseline/domain';
import { gridCellId, projectGrid } from './grid';

function planningFixture(): PlanningData {
  const seed = parseSeed(
    JSON.parse(readFileSync(resolve(process.cwd(), 'data/baseline-seed.json'), 'utf8')) as unknown,
  );
  return { ...seed, revision: 0, editSequence: 0 };
}

describe('delivery grid projection', () => {
  it('reconciles full-scope cell values before deriving row and month totals', () => {
    const data = planningFixture();
    const employees = data.employees;
    const months = gridMonths(data);
    const projection = projectGrid({
      data,
      itemId: 'wbs-004',
      employees,
      months,
      unit: 'pm',
      currency: 'EUR' as Currency,
    });
    const cellSum = [...projection.cellValues.values()].reduce((sum, value) => sum + value, 0);
    const rowSum = [...projection.rowTotals.values()].reduce((sum, value) => sum + value, 0);
    const columnSum = [...projection.columnTotals.values()].reduce((sum, value) => sum + value, 0);
    expect(cellSum).toBeCloseTo(rowSum, 10);
    expect(cellSum).toBeCloseTo(columnSum, 10);
    expect(rowSum).toBeCloseTo(projection.grandTotal ?? 0, 10);
    expect(projection.cellValues.get(gridCellId('emp-001', '2026-03'))).toBe(0.5);
  });

  it('does not invent an aggregate denominator for percentage cells', () => {
    const data = planningFixture();
    const projection = projectGrid({
      data,
      itemId: 'wbs-004',
      employees: data.employees,
      months: gridMonths(data),
      unit: 'percent',
      currency: 'EUR',
    });
    expect(projection.grandTotal).toBeUndefined();
    expect(projection.totalsNote).toMatch(/aggregate percentages are intentionally omitted/);
  });

  it('uses one project-wide allocation reconciliation for parent and child views', () => {
    const data: PlanningData = {
      meta: {
        name: 'test',
        version: '1',
        gridHorizon: { from: '2026-03', to: '2026-03' },
        note: 'test',
      },
      employees: [{ id: 'emp-1', name: 'One', role: 'Engineer', weeklyHours: 40 }],
      rateRecords: [{ id: 'rate-1', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyCost: 80 }],
      projects: [
        { id: 'project-1', name: 'Test project', startDate: '2026-01-01', endDate: '2026-12-31' },
      ],
      breakdownItems: [
        { id: 'root', projectId: 'project-1', parentId: null, name: 'Root' },
        { id: 'leaf-a', projectId: 'project-1', parentId: 'root', name: 'A' },
        { id: 'leaf-b', projectId: 'project-1', parentId: 'root', name: 'B' },
      ],
      allocations: [
        {
          id: 'allocation-a',
          breakdownItemId: 'leaf-a',
          employeeId: 'emp-1',
          month: '2026-03',
          amount: 0.005,
        },
        {
          id: 'allocation-b',
          breakdownItemId: 'leaf-b',
          employeeId: 'emp-1',
          month: '2026-03',
          amount: 0.005,
        },
      ],
      revision: 0,
      editSequence: 0,
    };
    const parent = projectGrid({
      data,
      itemId: 'root',
      employees: data.employees,
      months: ['2026-03'],
      unit: 'pm',
      currency: 'EUR',
    });
    const childA = projectGrid({
      data,
      itemId: 'leaf-a',
      employees: data.employees,
      months: ['2026-03'],
      unit: 'pm',
      currency: 'EUR',
    });
    const childB = projectGrid({
      data,
      itemId: 'leaf-b',
      employees: data.employees,
      months: ['2026-03'],
      unit: 'pm',
      currency: 'EUR',
    });
    const parentValue = parent.cellValues.get(gridCellId('emp-1', '2026-03')) ?? 0;
    const childValue =
      (childA.cellValues.get(gridCellId('emp-1', '2026-03')) ?? 0) +
      (childB.cellValues.get(gridCellId('emp-1', '2026-03')) ?? 0);
    expect(parentValue).toBe(childValue);
    expect(parentValue).toBe(parent.rowTotals.get('emp-1'));
    expect(parentValue).toBe(parent.columnTotals.get('2026-03'));
    expect(parentValue).toBe(parent.grandTotal);
  });
});
