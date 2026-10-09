import type { Allocation, BreakdownItem } from '@baseline/contracts';
import {
  assertFiniteResult,
  assertSupportedPm,
  DomainValidationError,
  type DeleteTreeResult,
} from './shared';

export type { DeleteTreeResult } from './shared';

function childrenOf(items: readonly BreakdownItem[], parentId: string | null): BreakdownItem[] {
  return items.filter((item) => item.parentId === parentId);
}

export function descendants(items: readonly BreakdownItem[], itemId: string): BreakdownItem[] {
  if (!items.some((item) => item.id === itemId)) {
    throw new DomainValidationError(`Unknown breakdown item '${itemId}'`);
  }
  const result: BreakdownItem[] = [];
  const visit = (parentId: string, path: ReadonlySet<string>): void => {
    childrenOf(items, parentId).forEach((child) => {
      if (path.has(child.id)) {
        throw new DomainValidationError(`Breakdown cycle includes '${child.id}'`);
      }
      result.push(child);
      visit(child.id, new Set([...path, child.id]));
    });
  };
  visit(itemId, new Set([itemId]));
  return result;
}

export function leafIds(items: readonly BreakdownItem[], itemId: string): string[] {
  if (!items.some((item) => item.id === itemId)) {
    throw new DomainValidationError(`Unknown breakdown item '${itemId}'`);
  }
  const result: string[] = [];
  const visit = (id: string, path: ReadonlySet<string>): void => {
    if (path.has(id)) throw new DomainValidationError(`Breakdown cycle includes '${id}'`);
    const nextPath = new Set([...path, id]);
    const children = childrenOf(items, id);
    if (children.length === 0) result.push(id);
    else children.forEach((child) => visit(child.id, nextPath));
  };
  visit(itemId, new Set());
  return result;
}

function depthOf(items: readonly BreakdownItem[], id: string): number {
  let depth = 1;
  let current = items.find((item) => item.id === id);
  const seen = new Set<string>();
  while (current?.parentId !== null && current !== undefined) {
    if (seen.has(current.id)) throw new DomainValidationError('Breakdown tree contains a cycle');
    seen.add(current.id);
    depth += 1;
    const parentId = current.parentId;
    const parent = items.find((item) => item.id === parentId);
    if (parent === undefined) {
      throw new DomainValidationError(
        `Breakdown item '${current.id}' references missing parent '${parentId}'`,
      );
    }
    current = parent;
  }
  return depth;
}

function checkNewParent(
  items: readonly BreakdownItem[],
  moving: BreakdownItem,
  parentId: string | null,
  allocations: readonly Allocation[],
): void {
  if (parentId === moving.id) {
    throw new DomainValidationError('An item cannot be moved beneath itself');
  }
  if (parentId === null) return;
  const parent = items.find((item) => item.id === parentId);
  if (parent === undefined) throw new DomainValidationError(`Unknown parent '${parentId}'`);
  if (parent.projectId !== moving.projectId) {
    throw new DomainValidationError('Moving items between projects is not supported');
  }
  if (descendants(items, moving.id).some((item) => item.id === parentId)) {
    throw new DomainValidationError('An item cannot be moved beneath its descendant');
  }
  if (allocations.some((allocation) => allocation.breakdownItemId === parentId)) {
    throw new DomainValidationError(
      'Cannot add children beneath an allocated leaf; move or clear its allocation first',
    );
  }
  const subtreeDepth =
    Math.max(
      0,
      ...descendants(items, moving.id).map(
        (item) => depthOf(items, item.id) - depthOf(items, moving.id),
      ),
    ) + 1;
  if (depthOf(items, parentId) + subtreeDepth > 3) {
    throw new DomainValidationError('Breakdown depth cannot exceed three levels');
  }
}

export function createBreakdownItem(
  items: readonly BreakdownItem[],
  input: BreakdownItem,
  allocations: readonly Allocation[] = [],
): BreakdownItem[] {
  if (input.id.trim().length === 0 || input.projectId.trim().length === 0) {
    throw new DomainValidationError('Breakdown item id and projectId cannot be empty');
  }
  if (input.name.trim().length === 0) {
    throw new DomainValidationError('Breakdown item name cannot be empty');
  }
  if (items.some((item) => item.id === input.id)) {
    throw new DomainValidationError(`Breakdown item '${input.id}' already exists`);
  }
  if (input.parentId !== null) {
    const parent = items.find((item) => item.id === input.parentId);
    if (parent === undefined) throw new DomainValidationError(`Unknown parent '${input.parentId}'`);
    if (parent.projectId !== input.projectId) {
      throw new DomainValidationError('Parent and item must belong to the same project');
    }
    if (allocations.some((allocation) => allocation.breakdownItemId === parent.id)) {
      throw new DomainValidationError(
        'Cannot add children beneath an allocated leaf; move or clear its allocation first',
      );
    }
  }
  if (input.parentId !== null && depthOf([...items, input], input.id) > 3) {
    throw new DomainValidationError('Breakdown depth cannot exceed three levels');
  }
  return [...items, input];
}

export function renameBreakdownItem(
  items: readonly BreakdownItem[],
  id: string,
  name: string,
): BreakdownItem[] {
  if (!items.some((item) => item.id === id)) {
    throw new DomainValidationError(`Unknown breakdown item '${id}'`);
  }
  if (name.trim().length === 0) {
    throw new DomainValidationError('Breakdown item name cannot be empty');
  }
  return items.map((item) => (item.id === id ? { ...item, name: name.trim() } : item));
}

export function moveBreakdownItem(
  items: readonly BreakdownItem[],
  id: string,
  parentId: string | null,
  allocations: readonly Allocation[] = [],
): BreakdownItem[] {
  const moving = items.find((item) => item.id === id);
  if (moving === undefined) throw new DomainValidationError(`Unknown breakdown item '${id}'`);
  checkNewParent(items, moving, parentId, allocations);
  const updated = items.map((item) => (item.id === id ? { ...item, parentId } : item));
  if (
    depthOf(updated, id) > 3 ||
    descendants(updated, id).some((item) => depthOf(updated, item.id) > 3)
  ) {
    throw new DomainValidationError('Breakdown depth cannot exceed three levels');
  }
  return updated;
}

export function deleteBreakdownItem(
  items: readonly BreakdownItem[],
  allocations: readonly Allocation[],
  id: string,
): DeleteTreeResult {
  if (!items.some((item) => item.id === id)) {
    throw new DomainValidationError(`Unknown breakdown item '${id}'`);
  }
  const removed = new Set([id, ...descendants(items, id).map((item) => item.id)]);
  return {
    items: items.filter((item) => !removed.has(item.id)),
    allocations: allocations.filter((allocation) => !removed.has(allocation.breakdownItemId)),
  };
}

export function aggregateAllocation(
  items: readonly BreakdownItem[],
  allocations: readonly Allocation[],
  itemId: string,
  employeeId: string,
  month: string,
): number {
  const leaves = leafIds(items, itemId);
  const leafSet = new Set(leaves);
  const total = allocations.reduce((sum, allocation) => {
    if (
      leafSet.has(allocation.breakdownItemId) &&
      allocation.employeeId === employeeId &&
      allocation.month === month
    ) {
      assertSupportedPm(allocation.amount);
      return sum + allocation.amount;
    }
    return sum;
  }, 0);
  return assertFiniteResult(total, 'Aggregated allocation');
}

