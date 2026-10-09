import seed from '../../data/baseline-seed.json';
import { createServices } from '@baseline/data';
import type { ManagedServices, StorageAdapter } from '@baseline/data';

/** Minimal deterministic slice of the supplied seed; all IDs and numerical reference preserved. */
export const fixture = {
  ...seed,
  employees: seed.employees.slice(0, 2),
  rateRecords: seed.rateRecords.filter(
    (rate) => rate.employeeId === 'emp-001' || rate.employeeId === 'emp-002',
  ),
  projects: seed.projects.slice(0, 2),
  breakdownItems: [
    ...seed.breakdownItems.filter((item) => ['wbs-001', 'wbs-004', 'wbs-012'].includes(item.id)),
    { id: 'other-leaf', projectId: 'prj-2', parentId: null, name: 'Other assignment' },
  ],
  allocations: [
    seed.allocations[0]!,
    {
      id: 'other-allocation',
      breakdownItemId: 'other-leaf',
      employeeId: 'emp-001',
      month: '2026-03',
      amount: 0.4,
    },
  ],
};
export function memoryStorage(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
export function testServices(storage = memoryStorage()): Promise<ManagedServices> {
  let id = 0;
  return createServices({ seed: fixture, storage, newId: () => `test-${++id}` });
}
export function installDialog(): void {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}
