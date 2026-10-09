import { Component } from 'react';
import type { ReactNode } from 'react';
import { message } from './index';

export class ApplicationBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: message(error) };
  }
  render() {
    if (this.state.error)
      return (
        <div className="panel fatal" role="alert">
          <h1>Baseline needs attention</h1>
          <p>{this.state.error}</p>
          <p>
            Your saved data has been preserved. Check browser storage and follow the recovery
            instructions in the README.
          </p>
          <button onClick={() => location.reload()}>Reload application</button>
        </div>
      );
    return this.props.children;
  }
}
