import { useState } from 'react';
import type { AppServices, RuntimeConfig } from '@baseline/contracts';
import { SessionControls } from '../../../packages/platform/src/SessionControls';
import { usePlanning } from '@baseline/platform';
import { RemotePanel } from './RemotePanel';
import type { RemoteLoader } from './RemotePanel';

export default function ShellApp({
  services,
  config,
  loader,
}: {
  services: AppServices;
  config: RuntimeConfig;
  loader: RemoteLoader;
}) {
  const [view, setView] = useState<'people' | 'delivery' | 'compare'>('delivery');
  const data = usePlanning(services);
  return (
    <>
      <header className="shell-header">
        <div>
          <h1>Baseline</h1>
          <small>PLANNING SUITE</small>
        </div>
        <SessionControls services={services} />
      </header>
      <nav className="shell-nav" aria-label="Applications">
        <button aria-pressed={view === 'delivery'} onClick={() => setView('delivery')}>
          Delivery
        </button>
        <button aria-pressed={view === 'people'} onClick={() => setView('people')}>
          People
        </button>
        <button aria-pressed={view === 'compare'} onClick={() => setView('compare')}>
          Compare both
        </button>
        <span className="muted">
          {data.employees.length} people · {data.projects.length} projects · saved locally
        </span>
      </nav>
      <main className={`workspace ${view === 'compare' ? 'compare' : ''}`}>
        <div hidden={view === 'delivery'}>
          <RemotePanel name="people" url={config.peopleUrl} services={services} loader={loader} />
        </div>
        <div hidden={view === 'people'}>
          <RemotePanel
            name="delivery"
            url={config.deliveryUrl}
            services={services}
            loader={loader}
          />
        </div>
      </main>
    </>
  );
}
