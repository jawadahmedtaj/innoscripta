import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Allocation, BreakdownItem, Employee, RateRecord } from '@baseline/contracts';
import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  aggregateAllocation,
  createBreakdownItem,
  deleteBreakdownItem,
  fromPm,
  getCapacity,
  gridMonths,
  leafIds,
  monthlyCapacity,
  moveBreakdownItem,
  parseSeed,
  priceMonth,
  reconcile,
  roundToPrecision,
  toPm,
  validatePlanningData,
  workingDays,
} from './index';

function seedFixture(): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/baseline-seed.json'), 'utf8'),
  ) as unknown;
}

const ada: Employee = { id: 'emp-001', name: 'Adaeze Okafor', role: 'Tech Lead', weeklyHours: 40 };
const adaRates: readonly RateRecord[] = [
  { id: 'old', employeeId: ada.id, validFrom: '2025-01-01', hourlyCost: 80 },
  { id: 'new', employeeId: ada.id, validFrom: '2026-03-12', hourlyCost: 95 },
];

describe('seed validation and calendar', () => {
  it('preserves and validates the supplied fixture, including the out-of-horizon reference month', () => {
    const seed = parseSeed(seedFixture());
    expect(seed.employees).toHaveLength(60);
    expect(seed.rateRecords).toHaveLength(150);
    expect(seed.projects).toHaveLength(4);
    expect(seed.breakdownItems).toHaveLength(90);
    expect(seed.allocations).toHaveLength(720);
    expect(seed.allocations.find((allocation) => allocation.id === 'alloc-001')?.month).toBe(
      '2026-03',
    );
    expect(gridMonths(seed)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    const planning = validatePlanningData({ ...seed, revision: 0, editSequence: 0 });
    expect(planning.revision).toBe(0);
  });

  it('rejects duplicate effective dates, cells, dangling references, and invalid hours', () => {
    const seed = parseSeed(seedFixture());
    expect(() => parseSeed({ ...seed, employees: [{ ...ada, weeklyHours: 37 }] })).toThrow(
      DomainValidationError,
    );
    const duplicateRate = {
      id: 'dup',
      employeeId: ada.id,
      validFrom: '2025-01-01',
      hourlyCost: 81,
    };
    expect(() => parseSeed({ ...seed, rateRecords: [...seed.rateRecords, duplicateRate] })).toThrow(
      /Duplicate rate effective date/,
    );
  });

  it('rejects malformed collection shapes and all cross-entity reference violations', () => {
    const seed = parseSeed(seedFixture());
    expect(() => parseSeed(null)).toThrow(/object/);
    expect(() => parseSeed({ ...seed, allocations: undefined })).toThrow(
      /allocations must be an array/,
    );
    expect(() =>
      parseSeed({ ...seed, employees: [...seed.employees, { ...seed.employees[0] }] }),
    ).toThrow(/Duplicate employee id/);
    expect(() =>
      parseSeed({
        ...seed,
        rateRecords: [
          ...seed.rateRecords,
          { id: 'bad-rate', employeeId: 'missing', validFrom: '2026-01-01', hourlyCost: 1 },
        ],
      }),
    ).toThrow(/missing employee/);
    expect(() =>
      parseSeed({
        ...seed,
        rateRecords: seed.rateRecords.map((rate) =>
          rate.id === 'rate-001' ? { ...rate, hourlyCost: -1 } : rate,
        ),
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      parseSeed({
        ...seed,
        rateRecords: seed.rateRecords.map((rate) =>
          rate.id === 'rate-001' ? { ...rate, hourlyCost: 1_000_001 } : rate,
        ),
      }),
    ).toThrow(/at most/);
    expect(() =>
      parseSeed({
        ...seed,
        allocations: seed.allocations.map((allocation) =>
          allocation.id === 'alloc-001' ? { ...allocation, amount: Number.NaN } : allocation,
        ),
      }),
    ).toThrow(/finite/);
    expect(() =>
      parseSeed({
        ...seed,
        allocations: seed.allocations.map((allocation) =>
          allocation.id === 'alloc-001' ? { ...allocation, amount: 401 } : allocation,
        ),
      }),
    ).toThrow(/at most/);
    expect(() =>
      parseSeed({
        ...seed,
        breakdownItems: seed.breakdownItems.map((item) =>
          item.id === 'wbs-004' ? { ...item, projectId: 'prj-2' } : item,
        ),
      }),
    ).toThrow(/crosses project boundary/);
    expect(() =>
      parseSeed({
        ...seed,
        breakdownItems: seed.breakdownItems.map((item) =>
          item.id === 'wbs-001' ? { ...item, parentId: 'wbs-012' } : item,
        ),
      }),
    ).toThrow(/cycle/);
    expect(() =>
      parseSeed({
        ...seed,
        breakdownItems: [
          ...seed.breakdownItems,
          { id: 'too-deep', projectId: 'prj-1', parentId: 'wbs-012', name: 'Too deep' },
        ],
        allocations: [],
      }),
    ).toThrow(/three-level/);
    expect(() =>
      parseSeed({
        ...seed,
        allocations: [...seed.allocations, { ...seed.allocations[0], id: 'duplicate-cell' }],
      }),
    ).toThrow(/Duplicate allocation cell/);
    expect(() =>
      parseSeed({
        ...seed,
        allocations: seed.allocations.map((allocation) =>
          allocation.id === 'alloc-001'
            ? { ...allocation, breakdownItemId: 'wbs-004' }
            : allocation,
        ),
      }),
    ).toThrow(/non-leaf/);
    expect(() =>
      parseSeed({
        ...seed,
        allocations: seed.allocations.map((allocation) =>
          allocation.id === 'alloc-001'
            ? { ...allocation, breakdownItemId: 'missing' }
            : allocation,
        ),
      }),
    ).toThrow(/missing breakdown item/);
    expect(() =>
      parseSeed({
        ...seed,
        projects: seed.projects.map((project) =>
          project.id === 'prj-1'
            ? { ...project, startDate: '2026-03-02', endDate: '2026-03-01' }
            : project,
        ),
      }),
    ).toThrow(/endDate/);
  });

  it('rejects datasets whose many individually valid cells overflow aggregate display reconciliation', () => {
    const seed = parseSeed(seedFixture());
    const extremeRates = seed.rateRecords.map((rate) => ({ ...rate, hourlyCost: 1_000_000 }));
    const extraItems = Array.from({ length: 2_000 }, (_, index) => ({
      id: `extreme-wbs-${index}`,
      projectId: 'prj-1',
      parentId: 'wbs-001',
      name: `Extreme cell ${index}`,
    }));
    const extraAllocations = extraItems.map((item, index) => ({
      id: `extreme-allocation-${index}`,
      breakdownItemId: item.id,
      employeeId: 'emp-001',
      month: '2026-03',
      amount: 400,
    }));
    expect(() =>
      parseSeed({
        ...seed,
        breakdownItems: [...seed.breakdownItems, ...extraItems],
        allocations: [...seed.allocations, ...extraAllocations],
        rateRecords: extremeRates,
      }),
    ).toThrow(/Dataset cost display reconciliation exceeds safe numeric precision/);
  });

  it('keeps persisted edit ordering metadata coherent', () => {
    const seed = parseSeed(seedFixture());
    const edited = {
      ...seed,
      revision: 1,
      editSequence: 4,
      allocations: [{ ...seed.allocations[0], editSequence: 5, editedBy: 'emp-001' }],
    };
    expect(() => validatePlanningData(edited)).toThrow(/at least the highest allocation/);
    expect(() =>
      validatePlanningData({
        ...edited,
        editSequence: 5,
        allocations: [{ ...seed.allocations[0], editedBy: 'emp-001' }],
      }),
    ).toThrow(/requires editSequence/);
    expect(() =>
      validatePlanningData({
        ...edited,
        editSequence: 5,
        allocations: [{ ...seed.allocations[0], editSequence: 5 }],
      }),
    ).toThrow(/requires editedBy/);
    expect(() =>
      validatePlanningData({
        ...edited,
        editSequence: 5,
        allocations: [{ ...seed.allocations[0], editSequence: 5, editedBy: 'missing' }],
      }),
    ).toThrow(/editedBy references missing employee/);
    expect(validatePlanningData({ ...edited, editSequence: 5 }).allocations[0]?.editedBy).toBe(
      'emp-001',
    );
  });

  it('uses date-only Monday-Friday arithmetic for normal, leap, and partial months', () => {
    expect(workingDays('2026-03')).toHaveLength(22);
    expect(workingDays('2024-02')).toHaveLength(21);
    expect(workingDays('2025-02')).toHaveLength(20);
    expect(monthlyCapacity({ ...ada, weeklyHours: 20 }, '2025-02').capacityHours).toBe(80);
    expect(monthlyCapacity({ ...ada, weeklyHours: 32 }, '2025-02').capacityHours).toBe(128);
    expect(() => workingDays('0099-02')).toThrow(/Invalid month/);
    expect(() => workingDays('0000-01')).toThrow(/Invalid month/);
  });
});

describe('effective rates, pricing, and units', () => {
  it('matches the mandatory March 2026 €7,880 reference exactly', () => {
    const pricing = priceMonth(ada, adaRates, '2026-03');
    expect(pricing.capacityHours).toBe(176);
    expect(pricing.missingWorkingDays).toBe(0);
    expect(pricing.segments).toEqual([
      { workingDays: 8, hourlyCost: 80, costPerPm: 5120, validFrom: '2025-01-01' },
      { workingDays: 14, hourlyCost: 95, costPerPm: 10640, validFrom: '2026-03-12' },
    ]);
    expect(pricing.costPerPm).toBe(15760);
    expect(fromPm(0.5, 'hours', ada, adaRates, '2026-03')).toBe(88);
    expect(fromPm(0.5, 'percent', ada, adaRates, '2026-03')).toBe(50);
    expect(fromPm(0.5, 'cost', ada, adaRates, '2026-03')).toBe(7880);
    expect(toPm(7880, 'cost', ada, adaRates, '2026-03')).toBe(0.5);
    expect(toPm(3940, 'cost', ada, adaRates, '2026-03')).toBe(0.25);
  });

  it('handles rate changes on boundaries, weekends, and multiple times in a month', () => {
    const rates: readonly RateRecord[] = [
      { id: 'a', employeeId: ada.id, validFrom: '2026-04-01', hourlyCost: 10 },
      { id: 'b', employeeId: ada.id, validFrom: '2026-04-11', hourlyCost: 20 },
      { id: 'c', employeeId: ada.id, validFrom: '2026-04-15', hourlyCost: 30 },
    ];
    const pricing = priceMonth(ada, rates, '2026-04');
    expect(pricing.segments.map((segment) => segment.workingDays)).toEqual([8, 2, 12]);
    expect(pricing.costPerPm).toBe(8 * 8 * 10 + 2 * 8 * 20 + 12 * 8 * 30);
    const firstDay = priceMonth(
      ada,
      [{ id: 'x', employeeId: ada.id, validFrom: '2026-04-01', hourlyCost: 12 }],
      '2026-04',
    );
    expect(firstDay.missingWorkingDays).toBe(0);
    const weekendChange = priceMonth(
      ada,
      [
        { id: 'x', employeeId: ada.id, validFrom: '2026-04-01', hourlyCost: 12 },
        { id: 'y', employeeId: ada.id, validFrom: '2026-04-11', hourlyCost: 18 },
      ],
      '2026-04',
    );
    expect(weekendChange.segments.map((segment) => segment.workingDays)).toEqual([8, 14]);
    const monthBoundary = priceMonth(
      ada,
      [
        { id: 'x', employeeId: ada.id, validFrom: '2026-04-01', hourlyCost: 12 },
        { id: 'y', employeeId: ada.id, validFrom: '2026-05-01', hourlyCost: 18 },
      ],
      '2026-05',
    );
    expect(monthBoundary.missingWorkingDays).toBe(0);
    expect(monthBoundary.segments).toEqual([
      { workingDays: 21, hourlyCost: 18, costPerPm: 21 * 8 * 18, validFrom: '2026-05-01' },
    ]);
    expect(
      priceMonth(
        ada,
        [{ id: 'y', employeeId: ada.id, validFrom: '2026-05-01', hourlyCost: 18 }],
        '2026-04',
      ).missingWorkingDays,
    ).toBe(22);
  });

  it('flags missing rates while pricing covered days normally', () => {
    const before = priceMonth(
      ada,
      [{ id: 'x', employeeId: ada.id, validFrom: '2026-03-12', hourlyCost: 10 }],
      '2026-03',
    );
    expect(before.missingWorkingDays).toBe(8);
    expect(before.costPerPm).toBe(14 * 8 * 10);
    const none = priceMonth(ada, [], '2026-03');
    expect(none.missingWorkingDays).toBe(22);
    expect(() => toPm(10, 'cost', ada, [], '2026-03')).toThrow(/incomplete cost-rate coverage/);
    expect(() =>
      toPm(
        10,
        'cost',
        ada,
        [{ id: 'x', employeeId: ada.id, validFrom: '2026-03-12', hourlyCost: 10 }],
        '2026-03',
      ),
    ).toThrow(/incomplete cost-rate coverage/);
  });

  it('round-trips all four units without mutating the canonical amount', () => {
    const units = ['pm', 'hours', 'percent', 'cost'] as const;
    units.forEach((unit) => {
      const display = fromPm(0.375, unit, ada, adaRates, '2026-03', 'USD');
      expect(toPm(display, unit, ada, adaRates, '2026-03', 'USD')).toBeCloseTo(0.375, 12);
    });
    let amount = 0.375;
    for (let pass = 0; pass < 10; pass += 1)
      for (const unit of units)
        amount = toPm(
          fromPm(amount, unit, ada, adaRates, '2026-03'),
          unit,
          ada,
          adaRates,
          '2026-03',
        );
    expect(amount).toBeCloseTo(0.375, 12);
  });

  it('rejects finite inputs whose converted or displayed values exceed safe numeric precision', () => {
    expect(() => fromPm(Number.MAX_VALUE, 'hours', ada, adaRates, '2026-03')).toThrow(/at most/);
    expect(() => fromPm(Number.MAX_VALUE, 'pm', ada, adaRates, '2026-03')).toThrow(/at most/);
    expect(() =>
      priceMonth(
        ada,
        [{ id: 'huge', employeeId: ada.id, validFrom: '2026-01-01', hourlyCost: Number.MAX_VALUE }],
        '2026-03',
      ),
    ).toThrow(/at most/);
    expect(() => reconcile([{ id: 'huge', value: Number.MAX_SAFE_INTEGER }], 2)).toThrow(
      /safe integer/,
    );
    expect(() => roundToPrecision(Number.MAX_SAFE_INTEGER, 2)).toThrow(/safe integer/);
  });
});

describe('reconciliation and tree invariants', () => {
  it('uses largest remainder and stable id ties', () => {
    expect(
      reconcile(
        [
          { id: 'b', value: 0.5 },
          { id: 'a', value: 0.5 },
          { id: 'c', value: 0.5 },
        ],
        0,
      ),
    ).toEqual({ a: 1, b: 1, c: 0 });
    const result = reconcile(
      [
        { id: 'a', value: 1.234 },
        { id: 'b', value: 2.234 },
      ],
      2,
    );
    expect((result.a ?? 0) + (result.b ?? 0)).toBeCloseTo(3.47, 12);
  });

  const tree: BreakdownItem[] = [
    { id: 'root', projectId: 'p1', parentId: null, name: 'Root' },
    { id: 'branch', projectId: 'p1', parentId: 'root', name: 'Branch' },
    { id: 'leaf-a', projectId: 'p1', parentId: 'branch', name: 'A' },
    { id: 'leaf-b', projectId: 'p1', parentId: 'branch', name: 'B' },
    { id: 'other', projectId: 'p2', parentId: null, name: 'Other' },
  ];
  const allocation: Allocation = {
    id: 'allocation',
    breakdownItemId: 'leaf-a',
    employeeId: ada.id,
    month: '2026-03',
    amount: 0.5,
  };

  it('aggregates each leaf once and protects tree moves and deletion', () => {
    expect(leafIds(tree, 'root')).toEqual(['leaf-a', 'leaf-b']);
    expect(aggregateAllocation(tree, [allocation], 'root', ada.id, '2026-03')).toBe(0.5);
    expect(() => moveBreakdownItem(tree, 'root', 'leaf-a')).toThrow(/descendant/);
    expect(() => moveBreakdownItem(tree, 'leaf-a', 'other')).toThrow(/project/);
    expect(() =>
      createBreakdownItem(
        tree,
        { id: 'child', projectId: 'p1', parentId: 'leaf-a', name: 'Child' },
        [allocation],
      ),
    ).toThrow(/allocated leaf/);
    const deleted = deleteBreakdownItem(tree, [allocation], 'branch');
    expect(deleted.items.map((item) => item.id)).toEqual(['root', 'other']);
    expect(deleted.allocations).toEqual([]);
  });
});

describe('cross-project capacity', () => {
  it('ignores zeroed-out assignments when identifying the latest contributor', () => {
    const allocations: Allocation[] = [
      {
        id: 'project-a-leaf',
        breakdownItemId: 'a',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0.6,
        editSequence: 2,
      },
      {
        id: 'project-b-leaf',
        breakdownItemId: 'b',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0.6,
        editSequence: 3,
      },
      {
        id: 'removed-effort',
        breakdownItemId: 'c',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0,
        editSequence: 4,
      },
    ];
    expect(getCapacity(allocations, ada.id, '2026-03')).toMatchObject({
      totalPm: 1.2,
      overCapacity: true,
      latest: allocations[1],
    });
    expect(getCapacity([allocations[2]!], ada.id, '2026-03').latest).toBeUndefined();
  });
  it('flags strictly above 100%, keeps exact capacity valid, and chooses latest edits', () => {
    const allocations: Allocation[] = [
      {
        id: 'a',
        breakdownItemId: 'x',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0.6,
        editSequence: 2,
      },
      {
        id: 'b',
        breakdownItemId: 'y',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0.4,
        editSequence: 3,
      },
      {
        id: 'c',
        breakdownItemId: 'z',
        employeeId: ada.id,
        month: '2026-03',
        amount: 0.1,
        editSequence: 4,
      },
    ];
    expect(getCapacity(allocations.slice(0, 2), ada.id, '2026-03')).toMatchObject({
      totalPm: 1,
      overCapacity: false,
      latest: allocations[1],
    });
    expect(getCapacity(allocations, ada.id, '2026-03')).toMatchObject({
      totalPm: 1.1,
      overCapacity: true,
      latest: allocations[2],
    });
    const seedStyleAllocations = allocations.map((allocation) => ({
      id: allocation.id,
      breakdownItemId: allocation.breakdownItemId,
      employeeId: allocation.employeeId,
      month: allocation.month,
      amount: allocation.amount,
    }));
    expect(getCapacity(seedStyleAllocations, ada.id, '2026-03').latest?.id).toBe('c');
  });
});
