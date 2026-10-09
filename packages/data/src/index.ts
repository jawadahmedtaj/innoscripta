import type { AppServices, PlanningData, SeedData, Session, Currency } from '@baseline/contracts';
import {
  parseSeed,
  validatePlanningData,
  createBreakdownItem,
  renameBreakdownItem,
  moveBreakdownItem,
  deleteBreakdownItem,
} from '@baseline/domain';

export const DATA_KEY = 'baseline.planning.v1';
export const SESSION_KEY = 'baseline.session.v1';
export interface StorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}
export interface DataOptions {
  seed: unknown;
  storage: StorageAdapter;
  /** Browser Web Locks serialize transactions across tabs; tests inject a deterministic lock. */
  withLock?: <T>(work: () => T | Promise<T>) => Promise<T>;
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  newId?: () => string;
}
export interface ManagedServices extends AppServices {
  dispose: () => void;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}
function initialData(seed: SeedData): PlanningData {
  return { ...seed, revision: 0, editSequence: 0 };
}
function parseSession(raw: string | null, data: PlanningData): Session {
  const fallback = { activeUser: data.employees[0]?.id ?? '', currency: 'EUR' as const };
  if (raw === null) return fallback;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('activeUser' in value) ||
    typeof value.activeUser !== 'string' ||
    !data.employees.some((employee) => employee.id === value.activeUser) ||
    !('currency' in value) ||
    (value.currency !== 'EUR' && value.currency !== 'USD' && value.currency !== 'GBP')
  )
    throw new Error('Saved session is invalid. Reset the session key to restore defaults.');
  return { activeUser: value.activeUser, currency: value.currency };
}

export async function createServices(options: DataOptions): Promise<ManagedServices> {
  const { storage } = options;
  const seed = parseSeed(options.seed);
  const withLock =
    options.withLock ?? (async <T>(work: () => T | Promise<T>): Promise<T> => work());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const readData = (): PlanningData => {
    const raw = storage.getItem(DATA_KEY);
    if (raw === null)
      throw new Error('Saved planning data was removed. Reload to initialize the seed.');
    const value: unknown = JSON.parse(raw);
    return validatePlanningData(value);
  };
  let snapshot = freeze(
    await withLock(() => {
      if (storage.getItem(DATA_KEY) === null)
        storage.setItem(DATA_KEY, JSON.stringify(initialData(seed)));
      return readData();
    }),
  );
  let session = freeze(parseSession(storage.getItem(SESSION_KEY), snapshot));
  let externalError: Error | null = null;
  const listeners = new Set<() => void>();
  const sessionListeners = new Set<() => void>();
  let queue = Promise.resolve();
  let disposed = false;

  const transaction = (update: (latest: PlanningData) => PlanningData): Promise<void> => {
    const pending = queue.then(() =>
      withLock(() => {
        if (disposed) throw new Error('This application session has closed.');
        const current = readData();
        const result = update(current);
        const validated = validatePlanningData({ ...result, revision: current.revision + 1 });
        // Commit persistence before publishing: failed/quota-exceeded writes leave the UI unchanged.
        storage.setItem(DATA_KEY, JSON.stringify(validated));
        snapshot = freeze(validated);
        externalError = null;
        listeners.forEach((listener) => listener());
      }),
    );
    queue = pending.catch(() => undefined);
    return pending;
  };
  const publishSession = (next: Session): void => {
    if (disposed) throw new Error('This application session has closed.');
    storage.setItem(SESSION_KEY, JSON.stringify(next));
    session = freeze(next);
    sessionListeners.forEach((listener) => listener());
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== DATA_KEY && event.key !== SESSION_KEY && event.key !== null) return;
    try {
      if (event.key === DATA_KEY || event.key === null) {
        snapshot = freeze(readData());
        externalError = null;
      }
      if (event.key === SESSION_KEY || event.key === null)
        session = freeze(parseSession(storage.getItem(SESSION_KEY), snapshot));
    } catch (error: unknown) {
      externalError = error instanceof Error ? error : new Error('Saved data is invalid.');
    }
    listeners.forEach((listener) => listener());
    sessionListeners.forEach((listener) => listener());
  };
  options.events?.addEventListener('storage', onStorage);
  return {
    planning: {
      getSnapshot: () => {
        if (externalError) throw externalError;
        return snapshot;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      people: {
        saveRate: (input) =>
          transaction((current) => {
            const existing =
              input.id === undefined
                ? undefined
                : current.rateRecords.find((rate) => rate.id === input.id);
            if (input.id !== undefined && !existing)
              throw new Error(
                'The rate no longer exists. Reopen the employee to review current history.',
              );
            if (existing && existing.employeeId !== input.employeeId)
              throw new Error('A rate cannot be transferred to another employee.');
            const rate = { ...input, id: input.id ?? `rate-${newId()}` };
            return {
              ...current,
              rateRecords: existing
                ? current.rateRecords.map((value) => (value.id === rate.id ? rate : value))
                : [...current.rateRecords, rate],
            };
          }),
        removeRate: (id) =>
          transaction((current) => {
            if (!current.rateRecords.some((rate) => rate.id === id))
              throw new Error('This rate no longer exists.');
            return {
              ...current,
              rateRecords: current.rateRecords.filter((rate) => rate.id !== id),
            };
          }),
      },
      delivery: {
        createItem: (input) =>
          transaction((current) => ({
            ...current,
            breakdownItems: createBreakdownItem(
              current.breakdownItems,
              { ...input, id: `wbs-${newId()}` },
              current.allocations,
            ),
          })),
        renameItem: (id, name) =>
          transaction((current) => ({
            ...current,
            breakdownItems: renameBreakdownItem(current.breakdownItems, id, name),
          })),
        moveItem: (id, parentId) =>
          transaction((current) => ({
            ...current,
            breakdownItems: moveBreakdownItem(
              current.breakdownItems,
              id,
              parentId,
              current.allocations,
            ),
          })),
        deleteItem: (id) =>
          transaction((current) => {
            const result = deleteBreakdownItem(current.breakdownItems, current.allocations, id);
            return { ...current, breakdownItems: result.items, allocations: result.allocations };
          }),
        setAllocation: (input) =>
          transaction((current) => {
            const existing = current.allocations.find(
              (value) =>
                value.breakdownItemId === input.breakdownItemId &&
                value.employeeId === input.employeeId &&
                value.month === input.month,
            );
            const sequence = current.editSequence + 1;
            const allocation = {
              ...input,
              id: existing?.id ?? `alloc-${newId()}`,
              editSequence: sequence,
              editedBy: session.activeUser,
            };
            return {
              ...current,
              editSequence: sequence,
              allocations: existing
                ? current.allocations.map((value) =>
                    value.id === allocation.id ? allocation : value,
                  )
                : [...current.allocations, allocation],
            };
          }),
      },
    },
    session: {
      getSnapshot: () => session,
      subscribe: (listener) => {
        sessionListeners.add(listener);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      setActiveUser: (id) => {
        if (!snapshot.employees.some((employee) => employee.id === id))
          throw new Error('Select an existing employee as the active user.');
        publishSession({ ...session, activeUser: id });
      },
      setCurrency: (currency: Currency) => {
        if (!['EUR', 'USD', 'GBP'].includes(currency))
          throw new Error('Unsupported display currency.');
        publishSession({ ...session, currency });
      },
    },
    dispose: () => {
      disposed = true;
      options.events?.removeEventListener('storage', onStorage);
      listeners.clear();
      sessionListeners.clear();
    },
  };
}

export async function createBrowserServices(seedUrl: string): Promise<ManagedServices> {
  // Do not fetch/reseed persisted data at startup: initialize from the fixture only on first use.
  const raw = localStorage.getItem(DATA_KEY);
  let seed: unknown;
  if (raw !== null) seed = JSON.parse(raw);
  else {
    const response = await fetch(seedUrl);
    if (!response.ok) throw new Error(`Seed data could not be loaded (${response.status}).`);
    seed = await response.json();
  }
  return createServices({
    seed,
    storage: localStorage,
    events: window,
    ...(navigator.locks
      ? {
          withLock: async <T>(work: () => T | Promise<T>): Promise<T> =>
            await navigator.locks.request(DATA_KEY, work),
        }
      : {}),
  });
}
