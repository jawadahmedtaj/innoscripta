import React from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserServices } from '@baseline/data';
import type { AppServices, RuntimeConfig } from '@baseline/contracts';
import { loadRuntimeConfig, message } from './index';
import { ApplicationBoundary } from './ApplicationBoundary';
import './styles.css';

/** Both entry modes initialize only transport/session, then render the same exposed app. */
export async function bootstrap(
  render: (services: AppServices, config: RuntimeConfig) => ReactNode,
): Promise<void> {
  const target = document.getElementById('root');
  if (!target) throw new Error('Application root is missing.');
  const root = createRoot(target);
  root.render(
    <div className="panel fatal" role="status">
      Loading Baseline…
    </div>,
  );
  try {
    const config = await loadRuntimeConfig();
    const services = await createBrowserServices(config.seedUrl);
    // Back/forward-cache pages retain their service; disposing on persisted pagehide breaks restoration.
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) services.dispose();
    });
    root.render(
      <React.StrictMode>
        <ApplicationBoundary>{render(services, config)}</ApplicationBoundary>
      </React.StrictMode>,
    );
  } catch (error: unknown) {
    root.render(
      <div className="panel fatal" role="alert">
        <h1>Baseline could not start</h1>
        <p>{message(error)}</p>
        <p>
          Stored data has been preserved. Check runtime configuration or export and reset the local
          storage keys as described in the README.
        </p>
        <button onClick={() => location.reload()}>Retry startup</button>
      </div>,
    );
  }
}
