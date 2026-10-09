import { useSyncExternalStore } from 'react';
import type { AppServices, RuntimeConfig } from '@baseline/contracts';

export function usePlanning(services: AppServices) {
  return useSyncExternalStore(services.planning.subscribe, services.planning.getSnapshot);
}
export function useSession(services: AppServices) {
  return useSyncExternalStore(services.session.subscribe, services.session.getSnapshot);
}
export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`Runtime configuration could not be loaded (${response.status}).`);
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('peopleUrl' in value) ||
    typeof value.peopleUrl !== 'string' ||
    !('deliveryUrl' in value) ||
    typeof value.deliveryUrl !== 'string' ||
    !('seedUrl' in value) ||
    typeof value.seedUrl !== 'string'
  )
    throw new Error('Invalid runtime configuration.');
  for (const entry of [value.peopleUrl, value.deliveryUrl, value.seedUrl]) {
    if (!entry.trim() || !['http:', 'https:'].includes(new URL(entry, location.href).protocol))
      throw new Error('Runtime URLs must use HTTP or HTTPS.');
  }
  return { peopleUrl: value.peopleUrl, deliveryUrl: value.deliveryUrl, seedUrl: value.seedUrl };
}
