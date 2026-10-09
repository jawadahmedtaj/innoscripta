import React, { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { AppServices, RemoteModule } from '@baseline/contracts';
import { message } from '@baseline/platform';

export type RemoteLoader = (name: 'people' | 'delivery', url: string) => Promise<RemoteModule>;
class RemoteBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: message(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Remote render failed', error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="error" role="alert">
          This remote encountered an error: {this.state.error}{' '}
          <button onClick={this.props.onRetry}>Retry panel</button>
        </div>
      );
    return this.props.children;
  }
}

export function RemotePanel({
  name,
  url,
  services,
  loader,
}: {
  name: 'people' | 'delivery';
  url: string;
  services: AppServices;
  loader: RemoteLoader;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ remote: RemoteModule | null; error: string | null }>({
    remote: null,
    error: null,
  });
  useEffect(() => {
    let disposed = false;
    setState({ remote: null, error: null });
    void loader(name, url).then(
      (remote) => {
        if (!disposed)
          setState(
            remote.reactIdentity !== React
              ? {
                  remote: null,
                  error: 'React singleton mismatch. Check compatible shared dependency versions.',
                }
              : { remote, error: null },
          );
      },
      (error: unknown) => {
        if (!disposed) setState({ remote: null, error: message(error) });
      },
    );
    return () => {
      disposed = true;
    };
  }, [name, url, loader, attempt]);
  const RemoteApp = state.remote?.default;
  return (
    <section className="remote-panel" aria-label={`${name} remote`}>
      {state.error ? (
        <div className="panel error" role="alert">
          <h2>{name === 'people' ? 'People' : 'Delivery'} is unavailable</h2>
          <p>{state.error}</p>
          <p>
            Shell and the other application remain available. Correct the container configuration or
            restore the remote, then retry.
          </p>
          <button onClick={() => setAttempt((value) => value + 1)}>Retry {name}</button>
        </div>
      ) : RemoteApp ? (
        <RemoteBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
          <RemoteApp services={services} />
        </RemoteBoundary>
      ) : (
        <div className="panel" role="status">
          Loading {name}…
        </div>
      )}
      <div className="remote-status">
        {name} · {url} {RemoteApp && '· shared React verified'}
      </div>
    </section>
  );
}
