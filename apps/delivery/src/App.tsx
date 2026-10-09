import React, { useMemo, useState } from 'react';
import type {
  AllocationUnit,
  BreakdownItem,
  Currency,
  Employee,
  RemoteProps,
} from '@baseline/contracts';
import {
  currencyMultiplier,
  descendants as domainDescendants,
  fromPm,
  gridMonths as domainGridMonths,
  leafIds as domainLeafIds,
  monthlyCapacity,
  priceMonth,
  toPm,
} from '@baseline/domain';
import { projectGrid } from './grid';
import {
  ReferencePanel,
  StaffingTable,
  TreeNode,
  UNIT_LABELS,
  costPerPm,
  employeeRates,
  tree,
} from './components';
import './styles.css';
import { formatNumber, message, usePlanning, useSession } from '@baseline/platform';
import { Modal } from '../../../packages/platform/src/Modal';

type Month = string;
function unitPrecision(unit: AllocationUnit): number {
  return unit === 'percent' ? 1 : 2;
}

function capacityHours(employee: Employee, month: Month): number {
  return monthlyCapacity(employee, month).capacityHours;
}

function leaves(items: readonly BreakdownItem[], id: string): BreakdownItem[] {
  return domainLeafIds(items, id).flatMap((leafId) => {
    const item = items.find((candidate) => candidate.id === leafId);
    return item === undefined ? [] : [item];
  });
}

function projectLeaves(items: readonly BreakdownItem[], projectId: string): BreakdownItem[] {
  const projectItems = items.filter((item) => item.projectId === projectId);
  return projectItems.filter(
    (item) => !projectItems.some((candidate) => candidate.parentId === item.id),
  );
}

export default function DeliveryApp({ services }: RemoteProps): React.ReactElement {
  const snapshot = usePlanning(services);
  const session = useSession(services);
  const [projectId, setProjectId] = useState('prj-1');
  const [selectedId, setSelectedId] = useState('wbs-012');
  const [projectTotal, setProjectTotal] = useState(false);
  const [unit, setUnit] = useState<AllocationUnit>('pm');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<
    'create' | 'rename' | 'move' | 'delete' | 'allocation' | null
  >(null);
  const [draftName, setDraftName] = useState('');
  const [draftParent, setDraftParent] = useState<string>('');
  const [draftEmployee, setDraftEmployee] = useState('emp-001');
  const [draftMonth, setDraftMonth] = useState('2026-03');
  const [draftItemId, setDraftItemId] = useState('');
  const [draftCurrency, setDraftCurrency] = useState<Currency>(session.currency);
  const [draftValue, setDraftValue] = useState('0');
  const [draftUnit, setDraftUnit] = useState<AllocationUnit>('pm');
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const months = useMemo(() => domainGridMonths(snapshot), [snapshot]);
  const projects = snapshot.projects;
  const projectTree = useMemo(
    () => tree(snapshot.breakdownItems, projectId),
    [snapshot.breakdownItems, projectId],
  );
  const selected = projectTotal
    ? undefined
    : (snapshot.breakdownItems.find(
        (item) => item.id === selectedId && item.projectId === projectId,
      ) ?? projectTree[0]);
  const leafItems = projectTotal
    ? projectLeaves(snapshot.breakdownItems, projectId)
    : selected
      ? leaves(snapshot.breakdownItems, selected.id)
      : [];
  const leafIds = leafItems.map((item) => item.id);
  const selectedIsLeaf =
    selected !== undefined &&
    snapshot.breakdownItems.every((item) => item.parentId !== selected.id);
  const employeeRows = snapshot.employees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(search.toLowerCase()) ||
      employee.role.toLowerCase().includes(search.toLowerCase()),
  );
  const hiddenEmployees = snapshot.employees.filter(
    (employee) => !employeeRows.some((visible) => visible.id === employee.id),
  );
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedRates = snapshot.rateRecords;
  const projection = useMemo(
    () =>
      projectGrid({
        data: snapshot,
        itemId: projectTotal ? null : (selected?.id ?? null),
        projectId,
        employees: snapshot.employees,
        months,
        unit,
        currency: session.currency,
      }),
    [months, projectId, projectTotal, selected, session.currency, snapshot, unit],
  );
  const closeDialog = (): void => setDialog(null);

  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await action();
      setNotice(success);
      setDialog(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  const selectProject = (id: string): void => {
    setProjectId(id);
    setSelectedId('');
    setProjectTotal(true);
  };

  const openAllocation = (
    itemId: string,
    employeeId: string,
    month: Month,
    requestedUnit: AllocationUnit = unit,
  ): void => {
    const employee = snapshot.employees.find((candidate) => candidate.id === employeeId);
    if (employee === undefined) return;
    const existing = snapshot.allocations.find(
      (allocation) =>
        allocation.employeeId === employeeId &&
        allocation.month === month &&
        allocation.breakdownItemId === itemId,
    );
    const canonicalPm = existing?.amount ?? 0;
    setDraftItemId(itemId);
    setDraftEmployee(employeeId);
    setDraftMonth(month);
    setDraftCurrency(session.currency);
    setDraftUnit(requestedUnit);
    const displayValue = fromPm(
      canonicalPm,
      requestedUnit,
      employee,
      selectedRates,
      month,
      session.currency,
    ).toFixed(unitPrecision(requestedUnit));
    setDraftValue(displayValue);
    setDraftDirty(false);
    setDialog('allocation');
    setError('');
  };

  const saveAllocation = (): void => {
    const employee = snapshot.employees.find((candidate) => candidate.id === draftEmployee);
    const draftItem = snapshot.breakdownItems.find((item) => item.id === draftItemId);
    const draftItemIsLeaf =
      draftItem !== undefined &&
      snapshot.breakdownItems.every((item) => item.parentId !== draftItem.id);
    if (!employee || !draftItem || !draftItemIsLeaf) {
      setError('Only a selected leaf can receive an allocation.');
      return;
    }
    if (!draftDirty) {
      setDialog(null);
      setError('');
      return;
    }
    if (draftValue.trim() === '') {
      setError('Enter a value or cancel without saving.');
      return;
    }
    const entered = Number(draftValue);
    if (!Number.isFinite(entered) || entered < 0) {
      setError('Enter a finite, non-negative amount.');
      return;
    }
    try {
      const amount = toPm(entered, draftUnit, employee, selectedRates, draftMonth, draftCurrency);
      void run(
        () =>
          services.planning.delivery.setAllocation({
            breakdownItemId: draftItem.id,
            employeeId: draftEmployee,
            month: draftMonth,
            amount,
          }),
        'Allocation saved.',
      );
    } catch (cause) {
      setError(message(cause));
    }
  };

  const referenceEmployee = snapshot.employees.find((employee) => employee.id === 'emp-001');
  const referenceRates = referenceEmployee
    ? employeeRates(referenceEmployee.id, snapshot.rateRecords)
    : [];
  const referenceAllocation = snapshot.allocations.find(
    (allocation) => allocation.id === 'alloc-001',
  );
  const referenceItem = snapshot.breakdownItems.find((item) => item.id === 'wbs-012');
  const referenceAvailable =
    referenceAllocation !== undefined &&
    referenceItem !== undefined &&
    referenceEmployee !== undefined;
  const referencePm = referenceAllocation?.amount ?? 0;
  const referenceCapacity = referenceEmployee ? capacityHours(referenceEmployee, '2026-03') : 0;
  const referencePricing = referenceEmployee
    ? priceMonth(referenceEmployee, referenceRates, '2026-03')
    : { month: '2026-03', capacityHours: 0, costPerPm: 0, missingWorkingDays: 22, segments: [] };
  const referenceCost =
    referencePm * referencePricing.costPerPm * currencyMultiplier(session.currency);
  const referenceHours = referenceEmployee
    ? fromPm(referencePm, 'hours', referenceEmployee, referenceRates, '2026-03', session.currency)
    : 0;
  const referencePercent = referenceEmployee
    ? fromPm(referencePm, 'percent', referenceEmployee, referenceRates, '2026-03', session.currency)
    : 0;
  const referenceSegmentText = referencePricing.segments
    .map((segment) => {
      const dailyHours = referencePricing.capacityHours === 0 ? 0 : referenceHours / 22;
      const segmentHours = dailyHours * segment.workingDays;
      const segmentCost = segmentHours * segment.hourlyCost;
      return `${segment.workingDays} days × ${formatNumber(dailyHours, 2)} h/day × €${formatNumber(segment.hourlyCost, 2)} = €${formatNumber(segmentCost, 2)}`;
    })
    .join(' + ');
  const draftEmployeeRecord =
    snapshot.employees.find((employee) => employee.id === draftEmployee) ?? snapshot.employees[0];
  const draftPricing =
    draftEmployeeRecord === undefined
      ? undefined
      : costPerPm(draftEmployeeRecord, selectedRates, draftMonth);
  const costUnavailable =
    draftPricing === undefined || draftPricing.missing || draftPricing.cost <= 0;

  return (
    <section className="delivery-app">
      <header className="panel page-header">
        <div>
          <p className="eyebrow">Delivery workspace</p>
          <h1>Staffing plan</h1>
          <p className="muted">
            Select a work package, then edit one canonical person-month value per employee and
            month.
          </p>
          <p className="badge">Active user: {session.activeUser}</p>
        </div>
        <div className="header-controls">
          <label className="field">
            Project
            <select value={projectId} onChange={(event) => selectProject(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Unit
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value as AllocationUnit)}
            >
              {(Object.keys(UNIT_LABELS) as AllocationUnit[]).map((key) => (
                <option key={key} value={key}>
                  {UNIT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="layout-two">
        <aside className="panel tree-panel" aria-label="Breakdown tree">
          <div className="toolbar">
            <div>
              <h2>Work breakdown</h2>
              <p className="muted">Three levels beneath a project.</p>
            </div>
            <button
              type="button"
              className="button"
              onClick={() => {
                setDraftName('');
                setDraftParent(selectedIsLeaf ? (selected?.parentId ?? '') : (selected?.id ?? ''));
                setDialog('create');
              }}
            >
              + Add
            </button>
          </div>
          <button
            type="button"
            className={projectTotal ? 'tree-node selected' : 'tree-node'}
            aria-label="Project total"
            onClick={() => {
              setProjectTotal(true);
              setSelectedId('');
            }}
          >
            Project total <span className="muted">all leaves</span>
          </button>
          <ul className="tree">
            {projectTree.map((item) => (
              <TreeNode
                key={item.id}
                item={item}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setProjectTotal(false);
                }}
              />
            ))}
          </ul>
          {selected && (
            <div className="tree-actions">
              <strong>{selected.name}</strong>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setDraftName(selected.name);
                    setDialog('rename');
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setDraftParent(selected.parentId ?? '');
                    setDialog('move');
                  }}
                >
                  Move
                </button>
                <button type="button" className="button danger" onClick={() => setDialog('delete')}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </aside>
        <section className="panel grid-panel" aria-label="Staffing grid">
          <div className="toolbar">
            <div>
              <h2>{selected?.name ?? selectedProject?.name ?? 'Select a work package'}</h2>
              <p className="muted">
                {selectedIsLeaf
                  ? 'Editable leaf allocations.'
                  : `${leafItems.length} leaf assignments aggregated; values are derived.`}
              </p>
            </div>
            <label className="field search-field">
              Search people
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or role"
              />
            </label>
          </div>
          <StaffingTable
            snapshot={snapshot}
            projects={projects}
            selectedRates={selectedRates}
            employeeRows={employeeRows}
            hiddenEmployees={hiddenEmployees}
            months={months}
            leafIds={leafIds}
            selectedIsLeaf={selectedIsLeaf}
            unit={unit}
            currency={session.currency}
            projection={projection}
            onEdit={(employeeId, month) => openAllocation(selected?.id ?? '', employeeId, month)}
          />
          <p className="muted totals-note">{projection.totalsNote}</p>
          {employeeRows.length === 0 && (
            <p className="muted empty-state">No people match this search.</p>
          )}
        </section>
      </section>
      <ReferencePanel
        available={referenceAvailable}
        currency={session.currency}
        pm={referencePm}
        percent={referencePercent}
        hours={referenceHours}
        capacityHours={referenceCapacity}
        cost={referenceCost}
        pricing={referencePricing}
        segmentText={referenceSegmentText}
        onOpen={() => {
          selectProject('prj-1');
          setProjectTotal(false);
          setSelectedId('wbs-012');
          openAllocation('wbs-012', 'emp-001', '2026-03', unit);
        }}
      />
      {dialog === 'allocation' && (
        <Modal title="Edit allocation" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveAllocation();
            }}
          >
            <p className="muted">
              {draftEmployeeRecord?.name} · {draftMonth}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              {UNIT_LABELS[draftUnit]}
              {draftUnit === 'cost' ? ` (${draftCurrency})` : ''}
              <input
                type="number"
                min="0"
                step="any"
                value={draftValue}
                onChange={(event) => {
                  setDraftValue(event.target.value);
                  setDraftDirty(true);
                }}
                autoFocus
              />
            </label>
            {draftUnit === 'cost' && costUnavailable && (
              <p className="error">
                Cost input is disabled because this month has missing working days or no priced
                working days. Edit hours, PM, or percentage instead.
              </p>
            )}
            <div className="button-row">
              <button
                className="button"
                type="submit"
                disabled={saving || (draftUnit === 'cost' && costUnavailable)}
              >
                {saving ? 'Saving…' : 'Save allocation'}
              </button>
              <button className="button secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'create' && (
        <Modal title="Add breakdown item" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draftName.trim()) {
                setError('Name is required.');
                return;
              }
              void run(
                () =>
                  services.planning.delivery.createItem({
                    projectId,
                    parentId: draftParent || null,
                    name: draftName.trim(),
                  }),
                'Breakdown item created.',
              );
            }}
          >
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              Name
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                autoFocus
              />
            </label>
            <label className="field">
              Parent
              <select value={draftParent} onChange={(event) => setDraftParent(event.target.value)}>
                <option value="">Project root</option>
                {snapshot.breakdownItems
                  .filter((item) => item.projectId === projectId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">
              Adding below an allocated leaf is refused by the domain service so no effort can
              disappear.
            </p>
            <div className="button-row">
              <button className="button" type="submit" disabled={saving}>
                Create
              </button>
              <button className="button secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'rename' && selected && (
        <Modal title="Rename breakdown item" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draftName.trim()) {
                setError('Name is required.');
                return;
              }
              void run(
                () => services.planning.delivery.renameItem(selected.id, draftName.trim()),
                'Breakdown item renamed.',
              );
            }}
          >
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              Name
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="button-row">
              <button className="button" type="submit" disabled={saving}>
                Save name
              </button>
              <button className="button secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'move' && selected && (
        <Modal title="Move breakdown item" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => services.planning.delivery.moveItem(selected.id, draftParent || null),
                'Breakdown item moved.',
              );
            }}
          >
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              New parent
              <select value={draftParent} onChange={(event) => setDraftParent(event.target.value)}>
                <option value="">Project root</option>
                {snapshot.breakdownItems
                  .filter(
                    (item) =>
                      item.projectId === projectId &&
                      item.id !== selected.id &&
                      !domainDescendants(snapshot.breakdownItems, selected.id).some(
                        (descendant) => descendant.id === item.id,
                      ),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">
              The service rejects cycles, cross-project moves, and depth beyond three levels.
            </p>
            <div className="button-row">
              <button className="button" type="submit" disabled={saving}>
                Move
              </button>
              <button className="button secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'delete' && selected && (
        <Modal title={`Delete ${selected.name}?`} onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => services.planning.delivery.deleteItem(selected.id),
                'Breakdown item and all descendants deleted.',
              );
            }}
          >
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <p>
              This cascades to descendants and their allocations atomically. This action cannot be
              undone from the UI.
            </p>
            <div className="button-row">
              <button className="button danger" type="submit" disabled={saving}>
                Delete item
              </button>
              <button className="button secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export const reactIdentity: unknown = React;
