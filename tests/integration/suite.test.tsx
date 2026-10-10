// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeopleApp from '../../apps/people/src/App';
import DeliveryApp from '../../apps/delivery/src/App';
import ShellApp from '../../apps/shell/src/App';
import type { RemoteLoader } from '../../apps/shell/src/RemotePanel';
import { Standalone } from '../../packages/platform/src/Standalone';
import { installDialog, memoryStorage, testServices } from './helpers';
import type { ManagedServices } from '@baseline/data';

beforeAll(installDialog);
const live: ManagedServices[] = [];
afterEach(() => {
  cleanup();
  live.splice(0).forEach((services) => services.dispose());
});
async function services(storage = memoryStorage()) {
  const value = await testServices(storage);
  live.push(value);
  return value;
}
const config = {
  peopleUrl: '/people/remoteEntry.js',
  deliveryUrl: '/delivery/remoteEntry.js',
  seedUrl: '/data/baseline-seed.json',
};
const loader: RemoteLoader = async (name) => ({
  default: name === 'people' ? PeopleApp : DeliveryApp,
  reactIdentity: React,
});

describe('standalone adapters and hosted integration', () => {
  it('runs People standalone, searches, and adds/corrects/removes rate history', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="People" App={PeopleApp} services={appServices} />);
    expect(screen.getByText('Standalone remote ·')).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'Adaeze');
    expect(screen.queryByRole('button', { name: 'Lena Okafor' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add rate' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Add rate' }));
    await user.type(dialog.getByLabelText('Effective from'), '2026-04-01');
    await user.type(dialog.getByLabelText('Hourly cost (EUR)'), '110');
    await user.click(dialog.getByRole('button', { name: 'Save rate' }));
    await waitFor(() =>
      expect(
        appServices.planning
          .getSnapshot()
          .rateRecords.some((rate) => rate.validFrom === '2026-04-01' && rate.hourlyCost === 110),
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Correct rate from 2026-04-01' }));
    dialog = within(screen.getByRole('dialog', { name: 'Correct rate' }));
    await user.clear(dialog.getByLabelText('Hourly cost (EUR)'));
    await user.type(dialog.getByLabelText('Hourly cost (EUR)'), '111');
    await user.click(dialog.getByRole('button', { name: 'Save rate' }));
    await screen.findByText('111.00');
    await user.click(screen.getByRole('button', { name: 'Remove rate from 2026-04-01' }));
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Correct rate from 2026-04-01' })).toBeNull(),
    );
  });

  it('runs Delivery standalone with the actual March reference and editable cost unit', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    expect(screen.getByRole('heading', { name: 'Staffing plan' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Unit'), 'cost');
    expect(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*7,880/ })).toBeTruthy();
  });

  it('disables cost entry when the selected month has no rate coverage', async () => {
    const appServices = await services();
    for (const rate of appServices.planning
      .getSnapshot()
      .rateRecords.filter((value) => value.employeeId === 'emp-001')) {
      await appServices.planning.people.removeRate(rate.id);
    }
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    await user.selectOptions(screen.getByLabelText('Unit'), 'cost');
    await user.click(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*0\.00/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit allocation' }));
    expect(dialog.getByRole('spinbutton')).toHaveProperty('disabled', true);
    expect(dialog.getByRole('button', { name: 'Save allocation' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(dialog.getByText(/Cost input is disabled/)).toBeTruthy();
  });

  it('pushes Shell session updates into both mounted apps and updates Delivery when People corrects a rate', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<ShellApp services={appServices} config={config} loader={loader} />);
    await user.click(screen.getByRole('button', { name: 'Compare both' }));
    await screen.findByRole('heading', { name: 'People & rates' });
    await screen.findByRole('heading', { name: 'Staffing plan' });
    await user.selectOptions(screen.getByLabelText('Unit'), 'cost');
    const before = screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*7,880/ });
    expect(before).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Active user'), 'emp-002');
    expect(screen.getByText(/Editing as Lena Okafor/)).toBeTruthy();
    expect(screen.getByText('Active user: emp-002')).toBeTruthy();
    expect(appServices.session.getSnapshot().activeUser).toBe('emp-002');
    await user.click(screen.getByRole('button', { name: 'Correct rate from 2026-03-12' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Correct rate' }));
    await user.clear(dialog.getByLabelText('Hourly cost (EUR)'));
    await user.type(dialog.getByLabelText('Hourly cost (EUR)'), '100');
    await user.click(dialog.getByRole('button', { name: 'Save rate' }));
    await screen.findByRole('button', { name: /Adaeze Okafor, 2026-03.*8,160/ });
    await user.selectOptions(screen.getByLabelText('Display currency'), 'USD');
    await screen.findByRole('button', { name: /Adaeze Okafor, 2026-03.*8,976/ });
    expect(screen.getByText(/Editing as Lena Okafor · display USD/)).toBeTruthy();
    expect(screen.getByText('USD/h')).toBeTruthy();
  });

  it('propagates allocation/capacity updates and preserves edits and ordering through reload', async () => {
    const storage = memoryStorage();
    const original = await services(storage);
    const view = render(<ShellApp services={original} config={config} loader={loader} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Compare both' }));
    await screen.findByRole('heading', { name: 'People & rates' });
    await act(() =>
      original.planning.delivery.setAllocation({
        breakdownItemId: 'wbs-012',
        employeeId: 'emp-001',
        month: '2026-03',
        amount: 0.7,
      }),
    );
    expect(screen.getByText('Over capacity in 1 months across all projects.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*over capacity/ }),
    ).toBeTruthy();
    const edited = original.planning
      .getSnapshot()
      .allocations.find((value) => value.id === 'alloc-001');
    expect(edited?.editSequence).toBe(1);
    view.unmount();
    original.dispose();
    const restored = await services(storage);
    render(<Standalone name="Delivery" App={DeliveryApp} services={restored} />);
    expect(
      screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*0.70.*over capacity/ }),
    ).toBeTruthy();
    expect(
      restored.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001'),
    ).toEqual(edited);
  });

  it('keeps Shell and People usable after Delivery fails, then retries successfully', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    let unavailable = true;
    const failingLoader = vi.fn<RemoteLoader>(async (name, url) => {
      if (name === 'delivery' && unavailable) throw new Error(`Remote unavailable at ${url}`);
      return loader(name, url);
    });
    render(<ShellApp services={appServices} config={config} loader={failingLoader} />);
    await screen.findByRole('heading', { name: 'Delivery is unavailable' });
    await user.click(screen.getByRole('button', { name: 'People' }));
    expect(screen.getByRole('heading', { name: 'People & rates' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'GBP');
    expect(appServices.session.getSnapshot().currency).toBe('GBP');
    unavailable = false;
    await user.click(screen.getByRole('button', { name: 'Delivery' }));
    await user.click(screen.getByRole('button', { name: 'Retry delivery' }));
    await screen.findByRole('heading', { name: 'Staffing plan' });
  });

  it('keeps canonical PM unchanged for a no-op rounded edit and inverts an explicit cost edit', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    await user.selectOptions(screen.getByLabelText('Unit'), 'hours');
    await user.click(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*88\.00/ }));
    let dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByRole('spinbutton') as HTMLInputElement).value).toBe('88.00');
    await user.click(dialog.getByRole('button', { name: 'Save allocation' }));
    expect(
      appServices.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001')
        ?.editSequence,
    ).toBeUndefined();
    await user.selectOptions(screen.getByLabelText('Unit'), 'cost');
    await user.click(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*7,880\.00/ }));
    dialog = within(screen.getByRole('dialog'));
    await user.clear(dialog.getByRole('spinbutton'));
    await user.type(dialog.getByRole('spinbutton'), '7880.00');
    await user.click(dialog.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() =>
      expect(
        appServices.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001')
          ?.amount,
      ).toBeCloseTo(0.5, 12),
    );
  });

  it('keeps a single-child parent read-only and clears a deleted project selection', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    await user.click(screen.getByRole('button', { name: /Discovery/ }));
    expect(screen.queryByRole('button', { name: /Adaeze Okafor, 2026-03/ })).toBeNull();
    const roots = appServices.planning
      .getSnapshot()
      .breakdownItems.filter((item) => item.projectId === 'prj-1' && item.parentId === null);
    for (const root of roots) await appServices.planning.delivery.deleteItem(root.id);
    expect(screen.getByText('No breakdown items in this project. Add one to begin.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Project'), 'prj-2');
    expect(screen.queryByRole('heading', { name: 'Ledger migration' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Reporting Platform' })).toBeTruthy();
  });

  it('labels tree parents with paths and refuses a rename whose target disappeared', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    const createDialog = within(screen.getByRole('dialog', { name: 'Add breakdown item' }));
    expect(
      createDialog.getByRole('option', { name: 'Ledger migration / Discovery · wbs-004' }),
    ).toBeTruthy();
    await user.click(createDialog.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Design' }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await act(() => appServices.planning.delivery.deleteItem('wbs-012'));
    expect(screen.getByRole('dialog', { name: 'Breakdown item no longer exists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
    expect(screen.getByText(/pending action was refused/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      appServices.planning.getSnapshot().breakdownItems.some((item) => item.id === 'wbs-012'),
    ).toBe(false);
    expect(
      appServices.planning.getSnapshot().breakdownItems.find((item) => item.id === 'wbs-001')?.name,
    ).toBe('Ledger migration');
  });

  it('refuses a delete whose dialog target disappeared instead of deleting the fallback selection', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    await user.click(screen.getByRole('button', { name: 'Design' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await act(() => appServices.planning.delivery.deleteItem('wbs-012'));
    expect(screen.getByRole('dialog', { name: 'Breakdown item no longer exists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete item' })).toBeNull();
    expect(
      appServices.planning.getSnapshot().breakdownItems.find((item) => item.id === 'wbs-001')?.name,
    ).toBe('Ledger migration');
  });

  it('distinguishes viewing a rounded value from explicitly editing that same rounded text', async () => {
    const appServices = await services();
    const user = userEvent.setup();
    await appServices.planning.delivery.setAllocation({
      breakdownItemId: 'wbs-012',
      employeeId: 'emp-001',
      month: '2026-03',
      amount: 1 / 3,
    });
    render(<Standalone name="Delivery" App={DeliveryApp} services={appServices} />);
    for (const unit of ['hours', 'percent', 'cost', 'pm'])
      await user.selectOptions(screen.getByLabelText('Unit'), unit);
    expect(
      appServices.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001')
        ?.amount,
    ).toBe(1 / 3);
    await user.click(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*0.33/ }));
    let dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Save allocation' }));
    expect(
      appServices.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001')
        ?.amount,
    ).toBe(1 / 3);
    await user.click(screen.getByRole('button', { name: /Adaeze Okafor, 2026-03.*0.33/ }));
    dialog = within(screen.getByRole('dialog'));
    await user.clear(dialog.getByRole('spinbutton'));
    await user.type(dialog.getByRole('spinbutton'), '0.33');
    await user.click(dialog.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() =>
      expect(
        appServices.planning.getSnapshot().allocations.find((value) => value.id === 'alloc-001')
          ?.amount,
      ).toBe(0.33),
    );
  });
});
