import type { AppServices, Currency } from '@baseline/contracts';
import { useState } from 'react';
import { message, usePlanning, useSession } from './index';

export function SessionControls({ services }: { services: AppServices }) {
  const data = usePlanning(services);
  const session = useSession(services);
  const [error, setError] = useState('');
  const update = (action: () => void): void => {
    try {
      action();
      setError('');
    } catch (cause: unknown) {
      setError(message(cause));
    }
  };
  return (
    <div className="toolbar">
      <label>
        Active user
        <select
          value={session.activeUser}
          onChange={(event) => update(() => services.session.setActiveUser(event.target.value))}
        >
          {data.employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Display currency
        <select
          value={session.currency}
          onChange={(event) =>
            update(() => services.session.setCurrency(event.target.value as Currency))
          }
        >
          <option value="EUR">EUR · base currency</option>
          <option value="USD">USD · illustrative FX</option>
          <option value="GBP">GBP · illustrative FX</option>
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
