import seedJson from '../../../data/baseline-seed.json';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StorageAdapter } from './index';
import { DATA_KEY, SESSION_KEY, createServices } from './index';
import type { PlanningData, SeedData } from '@baseline/contracts';
import { descendants, parseSeed } from '@baseline/domain';

const seed: SeedData = parseSeed(seedJson);

class MemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, string>();
  private writes = 0;
  public failNextWrite = false;

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Storage quota exceeded');
    }
    this.values.set(key, value);
    this.writes += 1;
  }

  public writeCount(): number {
    return this.writes;
  }
}

class StorageEvents {
  private readonly listeners = new Set<EventListenerOrEventListenerObject>();
  public added = 0;
  public removed = 0;

  public readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'> = {
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject): void => {
      this.listeners.add(listener);
      this.added += 1;
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject): void => {
      this.listeners.delete(listener);
      this.removed += 1;
    },
  };

  public emit(key: string | null): void {
    const event = { key } as unknown as StorageEvent;
    this.listeners.forEach((listener) => {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    });
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

function createLock(): <T>(work: () => T | Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return async <T>(work: () => T | Promise<T>): Promise<T> => {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

function nextId(id: string): () => string {
  let count = 0;
  return () => `${id}-${(count += 1)}`;
}

function initialSnapshot(storage: MemoryStorage): PlanningData {
  const raw = storage.getItem(DATA_KEY);
  if (raw === null) throw new Error('Expected the seed to be persisted');
  return JSON.parse(raw) as PlanningData;
}

describe('data service persistence boundary', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('initializes the actual fixture once and preserves edits when recreated', async () => {
    expect(seed.employees).toHaveLength(60);
    expect(seed.rateRecords).toHaveLength(150);
    expect(seed.projects).toHaveLength(4);
    expect(seed.breakdownItems).toHaveLength(90);
    expect(seed.allocations).toHaveLength(720);

    const first = await createServices({ seed, storage, newId: nextId('first') });
    await first.planning.people.saveRate({
      employeeId: 'emp-001',
      validFrom: '2027-01-01',
      hourlyCost: 123,
    });
    first.dispose();

    const alteredSeed: SeedData = { ...seed, rateRecords: seed.rateRecords.slice(0, 1) };
    const recreated = await createServices({
      seed: alteredSeed,
      storage,
      newId: nextId('recreated'),
    });
    expect(recreated.planning.getSnapshot().rateRecords).toHaveLength(151);
    expect(
      recreated.planning
        .getSnapshot()
        .rateRecords.some((rate) => rate.validFrom === '2027-01-01' && rate.hourlyCost === 123),
    ).toBe(true);
    expect(storage.writeCount()).toBe(2);
    recreated.dispose();
  });

  it('serializes commands from two service instances and reads the latest committed revision', async () => {
    const withLock = createLock();
    const first = await createServices({ seed, storage, withLock, newId: nextId('first') });
    const second = await createServices({ seed, storage, withLock, newId: nextId('second') });

    await Promise.all([
      first.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-01-01',
        hourlyCost: 101,
      }),
      second.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-02-01',
        hourlyCost: 102,
      }),
    ]);

    const persisted = initialSnapshot(storage);
    expect(persisted.revision).toBe(2);
    expect(persisted.rateRecords.filter((rate) => rate.validFrom >= '2027-01-01')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ validFrom: '2027-01-01', hourlyCost: 101 }),
        expect.objectContaining({ validFrom: '2027-02-01', hourlyCost: 102 }),
      ]),
    );
    expect(first.planning.getSnapshot().revision).toBe(1);
    expect(second.planning.getSnapshot().revision).toBe(2);

    second.dispose();
    first.dispose();
  });

  it('saves, corrects and removes rates while refusing invalid dates, amounts and duplicate effective dates', async () => {
    const services = await createServices({ seed, storage, newId: nextId('rate') });
    await services.planning.people.saveRate({
      employeeId: 'emp-001',
      validFrom: '2027-01-01',
      hourlyCost: 120,
    });
    const created = services.planning
      .getSnapshot()
      .rateRecords.find((rate) => rate.validFrom === '2027-01-01');
    expect(created).toBeDefined();
    if (created === undefined) throw new Error('Expected created rate');

    await services.planning.people.saveRate({ ...created, hourlyCost: 121 });
    expect(
      services.planning.getSnapshot().rateRecords.find((rate) => rate.id === created.id)
        ?.hourlyCost,
    ).toBe(121);
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2026-03-12',
        hourlyCost: 100,
      }),
    ).rejects.toThrow(/Duplicate rate effective date/);
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-02-30',
        hourlyCost: 100,
      }),
    ).rejects.toThrow(/real YYYY-MM-DD date/);
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-02-01',
        hourlyCost: -1,
      }),
    ).rejects.toThrow(/non-negative/);
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-02-01',
        hourlyCost: Number.NaN,
      }),
    ).rejects.toThrow(/finite/);
    await services.planning.people.removeRate(created.id);
    expect(services.planning.getSnapshot().rateRecords.some((rate) => rate.id === created.id)).toBe(
      false,
    );
    services.dispose();
  });

  it('rejects invalid allocation references, parent allocations, negative values and non-finite values', async () => {
    const services = await createServices({ seed, storage, newId: nextId('allocation') });
    const parentId = seed.breakdownItems.find((item) => item.id === 'wbs-001')?.id;
    if (parentId === undefined) throw new Error('Expected a known parent item');

    await expect(
      services.planning.delivery.setAllocation({
        breakdownItemId: 'missing',
        employeeId: 'emp-001',
        month: '2026-03',
        amount: 0.1,
      }),
    ).rejects.toThrow(/missing breakdown item/);
    await expect(
      services.planning.delivery.setAllocation({
        breakdownItemId: 'wbs-012',
        employeeId: 'missing',
        month: '2026-03',
        amount: 0.1,
      }),
    ).rejects.toThrow(/missing employee/);
    await expect(
      services.planning.delivery.setAllocation({
        breakdownItemId: parentId,
        employeeId: 'emp-001',
        month: '2026-03',
        amount: 0.1,
      }),
    ).rejects.toThrow(/non-leaf/);
    await expect(
      services.planning.delivery.setAllocation({
        breakdownItemId: 'wbs-012',
        employeeId: 'emp-001',
        month: '2026-03',
        amount: -0.1,
      }),
    ).rejects.toThrow(/non-negative/);
    await expect(
      services.planning.delivery.setAllocation({
        breakdownItemId: 'wbs-012',
        employeeId: 'emp-001',
        month: '2026-03',
        amount: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/finite/);
    services.dispose();
  });

  it('updates an allocation in place and records deterministic edit ordering', async () => {
    const services = await createServices({ seed, storage, newId: nextId('allocation') });
    const original = services.planning
      .getSnapshot()
      .allocations.find((allocation) => allocation.id === 'alloc-001');
    if (original === undefined) throw new Error('Expected mandatory reference allocation');
    await services.planning.delivery.setAllocation({
      breakdownItemId: original.breakdownItemId,
      employeeId: original.employeeId,
      month: original.month,
      amount: 0.75,
    });
    const updated = services.planning
      .getSnapshot()
      .allocations.find((allocation) => allocation.id === original.id);
    expect(updated).toEqual(
      expect.objectContaining({
        id: original.id,
        amount: 0.75,
        editSequence: 1,
        editedBy: 'emp-001',
      }),
    );
    expect(services.planning.getSnapshot().allocations).toHaveLength(720);
    services.dispose();
  });

  it('cascades tree deletion and leaves no dangling allocation references', async () => {
    const services = await createServices({ seed, storage, newId: nextId('tree') });
    const subtree = new Set(['wbs-001', ...descendants(seed.breakdownItems, 'wbs-001').map(item => item.id)]);
    await services.planning.delivery.deleteItem('wbs-001');
    const snapshot = services.planning.getSnapshot();
    expect(snapshot.breakdownItems.some((item) => item.id === 'wbs-001')).toBe(false);
    expect(snapshot.allocations.some((allocation) => subtree.has(allocation.breakdownItemId))).toBe(
      false,
    );
    const itemIds = new Set(snapshot.breakdownItems.map((item) => item.id));
    expect(
      snapshot.allocations.every((allocation) => itemIds.has(allocation.breakdownItemId)),
    ).toBe(true);
    services.dispose();
  });

  it('cleans subscriptions and storage listeners on unsubscribe and dispose', async () => {
    const events = new StorageEvents();
    const services = await createServices({
      seed,
      storage,
      events: events.target,
      newId: nextId('listeners'),
    });
    let planningCalls = 0;
    let sessionCalls = 0;
    const unsubscribePlanning = services.planning.subscribe(() => {
      planningCalls += 1;
    });
    const unsubscribeSession = services.session.subscribe(() => {
      sessionCalls += 1;
    });
    expect(events.added).toBe(1);
    await services.planning.people.saveRate({
      employeeId: 'emp-001',
      validFrom: '2027-01-01',
      hourlyCost: 99,
    });
    services.session.setCurrency('USD');
    expect(planningCalls).toBe(1);
    expect(sessionCalls).toBe(1);
    unsubscribePlanning();
    unsubscribeSession();
    await services.planning.people.removeRate(
      services.planning.getSnapshot().rateRecords.at(-1)?.id ?? 'missing',
    );
    services.session.setCurrency('GBP');
    expect(planningCalls).toBe(1);
    expect(sessionCalls).toBe(1);
    events.emit(DATA_KEY);
    expect(planningCalls).toBe(1);
    services.dispose();
    expect(events.removed).toBe(1);
    expect(events.listenerCount()).toBe(0);
    events.emit(SESSION_KEY);
    expect(planningCalls).toBe(1);
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-03-01',
        hourlyCost: 99,
      }),
    ).rejects.toThrow(/session has closed/);
    expect(() => services.session.setCurrency('EUR')).toThrow(/session has closed/);
    expect(() => services.session.setActiveUser('emp-001')).toThrow(/session has closed/);
  });

  it('keeps the in-memory snapshot unchanged when persistence fails', async () => {
    const events = new StorageEvents();
    const services = await createServices({
      seed,
      storage,
      events: events.target,
      newId: nextId('atomic'),
    });
    let calls = 0;
    services.planning.subscribe(() => {
      calls += 1;
    });
    const before = services.planning.getSnapshot();
    storage.failNextWrite = true;
    await expect(
      services.planning.people.saveRate({
        employeeId: 'emp-001',
        validFrom: '2027-01-01',
        hourlyCost: 99,
      }),
    ).rejects.toThrow(/quota/);
    expect(services.planning.getSnapshot()).toBe(before);
    expect(services.planning.getSnapshot().rateRecords).toHaveLength(150);
    expect(calls).toBe(0);
    await services.planning.people.saveRate({
      employeeId: 'emp-001',
      validFrom: '2027-01-01',
      hourlyCost: 99,
    });
    expect(services.planning.getSnapshot().rateRecords).toHaveLength(151);
    expect(calls).toBe(1);
    services.dispose();
  });
});
