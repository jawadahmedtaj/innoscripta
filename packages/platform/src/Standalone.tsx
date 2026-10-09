import type { ComponentType } from 'react';
import type { AppServices, RemoteProps } from '@baseline/contracts';
import { SessionControls } from './SessionControls';

export function Standalone({
  name,
  App,
  services,
}: {
  name: string;
  App: ComponentType<RemoteProps>;
  services: AppServices;
}) {
  return (
    <>
      <header className="shell-header">
        <div>
          <h1>Baseline · {name}</h1>
          <small>
            Standalone remote · <a href="/">Open suite</a>
          </small>
        </div>
        <SessionControls services={services} />
      </header>
      <main>
        <App services={services} />
      </main>
    </>
  );
}
