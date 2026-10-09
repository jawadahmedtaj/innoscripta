import React, { useState } from 'react';
import type { RateRecord, RemoteProps } from '@baseline/contracts';
import { currencyMultiplier, getCapacity, gridMonths, priceMonth } from '@baseline/domain';
import { formatNumber, message, usePlanning, useSession } from '@baseline/platform';
import { Modal } from '../../../packages/platform/src/Modal';

export const reactIdentity: unknown = React;

export default function PeopleApp({ services }: RemoteProps) {
  const data = usePlanning(services);
  const session = useSession(services);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('emp-001');
  const [editor, setEditor] = useState<{
    id?: string;
    validFrom: string;
    hourlyCost: string;
  } | null>(null);
  const [removing, setRemoving] = useState<RateRecord | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const employee = data.employees.find((value) => value.id === selectedId) ?? data.employees[0];
  const months = gridMonths(data);
  const visible = data.employees.filter((value) =>
    `${value.name} ${value.role}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const rates = data.rateRecords
    .filter((value) => value.employeeId === employee?.id)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const capacity = employee
    ? months.map((month) => ({ month, ...getCapacity(data.allocations, employee.id, month) }))
    : [];
  const overMonths = capacity.filter((value) => value.overCapacity);
  const activeUser = data.employees.find((value) => value.id === session.activeUser);
  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await action();
      setEditor(null);
      setRemoving(null);
      setNotice(success);
    } catch (cause: unknown) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };
  const save = (): void => {
    if (!editor || !employee) return;
    if (!editor.hourlyCost.trim() || !editor.validFrom) {
      setError('Enter an effective date and hourly cost. Empty amounts are not zero.');
      return;
    }
    const hourlyCost = Number(editor.hourlyCost);
    if (!Number.isFinite(hourlyCost) || hourlyCost < 0) {
      setError('Hourly cost must be a finite, non-negative number.');
      return;
    }
    void run(
      () =>
        services.planning.people.saveRate({
          ...(editor.id ? { id: editor.id } : {}),
          employeeId: employee.id,
          validFrom: editor.validFrom,
          hourlyCost,
        }),
      'Rate history saved. Open Delivery costs have refreshed.',
    );
  };
  return (
    <section aria-label="People application">
      <div className="toolbar">
        <div>
          <h2>People & rates</h2>
          <p className="muted">
            Editing as {activeUser?.name} · display {session.currency}
          </p>
        </div>
      </div>
      <div className="people-layout">
        <section className="panel" aria-label="Employee register">
          <label className="field">
            Search employees
            <input
              type="search"
              placeholder="Name or role"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p className="muted">{visible.length} employees · capacity includes every project</p>
          <div className="employee-list">
            <table>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Hours/week</th>
                  <th scope="col">Capacity</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((value) => {
                  const count = months.filter(
                    (month) => getCapacity(data.allocations, value.id, month).overCapacity,
                  ).length;
                  return (
                    <tr key={value.id} className={value.id === employee?.id ? 'selected' : ''}>
                      <td>
                        <button
                          aria-pressed={value.id === employee?.id}
                          onClick={() => {
                            setSelectedId(value.id);
                            setNotice('');
                            setError('');
                          }}
                        >
                          {value.name}
                        </button>
                        <div className="muted">{value.role}</div>
                      </td>
                      <td>{value.weeklyHours}</td>
                      <td>
                        {count ? (
                          <span className="badge warning">Over · {count} months</span>
                        ) : (
                          <span className="muted">Within capacity</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && <p>No employees match this search.</p>}
        </section>
        {employee ? (
          <section className="panel" aria-label="Employee details">
            <h2>{employee.name}</h2>
            <p className="muted">
              {employee.role} · {employee.weeklyHours} hours/week · {employee.id}
            </p>
            {overMonths.length > 0 ? (
              <p className="notice warning" role="status">
                Over capacity in {overMonths.length} months across all projects.
              </p>
            ) : (
              <p className="notice">Within capacity across all projects.</p>
            )}
            <details>
              <summary>Monthly capacity across projects</summary>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Allocated capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {capacity.map((value) => (
                    <tr key={value.month}>
                      <td>{value.month}</td>
                      <td>
                        {formatNumber(value.totalPm * 100, 1)}%{' '}
                        {value.overCapacity && <span className="badge warning">Over capacity</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                100% is this employee’s contracted monthly capacity. Exactly 100% is allowed.
              </p>
            </details>
            <div className="toolbar">
              <h3>Effective-dated cost rates</h3>
              <button
                onClick={() => {
                  setEditor({ validFrom: '', hourlyCost: '' });
                  setError('');
                }}
              >
                Add rate
              </button>
            </div>
            <p className="muted">
              Rate edits use base EUR per hour. Equivalent {session.currency} amounts use fixed
              illustrative FX.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Valid from</th>
                    <th>Until (exclusive)</th>
                    <th>EUR/h</th>
                    {session.currency !== 'EUR' && <th>{session.currency}/h</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((rate, index) => (
                    <tr key={rate.id}>
                      <td>{rate.validFrom}</td>
                      <td>{rates[index + 1]?.validFrom ?? 'No end date'}</td>
                      <td>{formatNumber(rate.hourlyCost, 2)}</td>
                      {session.currency !== 'EUR' && (
                        <td>
                          {formatNumber(rate.hourlyCost * currencyMultiplier(session.currency), 2)}
                        </td>
                      )}
                      <td>
                        <button
                          aria-label={`Correct rate from ${rate.validFrom}`}
                          onClick={() => {
                            setEditor({
                              id: rate.id,
                              validFrom: rate.validFrom,
                              hourlyCost: String(rate.hourlyCost),
                            });
                            setError('');
                          }}
                        >
                          Correct
                        </button>{' '}
                        <button
                          aria-label={`Remove rate from ${rate.validFrom}`}
                          onClick={() => {
                            setRemoving(rate);
                            setError('');
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rates.length === 0 && (
              <p className="notice warning">
                No cost rates. Allocations remain editable in hours, PM and percentage; their cost
                is zero and marked missing.
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {employee.id === 'emp-001' && (
              <p className="notice">
                March 2026 · one full person-month costs {session.currency}{' '}
                {formatNumber(
                  priceMonth(employee, rates, '2026-03').costPerPm *
                    currencyMultiplier(session.currency),
                  2,
                )}
                . Delivery’s reference allocation starts at 0.50 PM.
              </p>
            )}
          </section>
        ) : (
          <p className="panel">No employees are available.</p>
        )}
      </div>
      {editor && (
        <Modal title={editor.id ? 'Correct rate' : 'Add rate'} onClose={() => setEditor(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <p>
              For {employee?.name}. Retroactive corrections immediately reprice affected
              allocations.
            </p>
            <label className="field">
              Effective from
              <input
                type="date"
                required
                value={editor.validFrom}
                onChange={(event) => setEditor({ ...editor, validFrom: event.target.value })}
                autoFocus
              />
            </label>
            <label className="field">
              Hourly cost (EUR)
              <input
                type="number"
                min="0"
                step="any"
                required
                value={editor.hourlyCost}
                onChange={(event) => setEditor({ ...editor, hourlyCost: event.target.value })}
              />
            </label>
            <p className="muted">
              Each effective date must be unique for this employee. Zero is a valid rate.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="toolbar">
              <button className="primary" disabled={saving}>
                Save rate
              </button>
              <button type="button" onClick={() => setEditor(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="Remove rate" onClose={() => setRemoving(null)}>
          <p>
            Remove the rate effective {removing.validFrom}? The previous rate will continue until
            the next rate; earlier uncovered days cost zero and are flagged.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="toolbar">
            <button
              disabled={saving}
              onClick={() => {
                void run(
                  () => services.planning.people.removeRate(removing.id),
                  'Rate removed. Open Delivery costs have refreshed.',
                );
              }}
            >
              Confirm removal
            </button>
            <button onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
