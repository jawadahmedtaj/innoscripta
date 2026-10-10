import type { RemoteModule } from '@baseline/contracts';

declare const __webpack_init_sharing__: (scope: string) => Promise<void>;
declare const __webpack_share_scopes__: { default: unknown };
interface Container {
  init: (scope: unknown) => Promise<void> | void;
  get: (name: string) => Promise<() => unknown>;
}
const loads = new Map<string, Promise<RemoteModule>>();
const initialized = new WeakSet<Container>();

function isContainer(value: unknown): value is Container {
  return (
    typeof value === 'object' &&
    value !== null &&
    'init' in value &&
    typeof value.init === 'function' &&
    'get' in value &&
    typeof value.get === 'function'
  );
}
function isRemote(value: unknown): value is RemoteModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'function' &&
    'reactIdentity' in value
  );
}
/** Native Module Federation container protocol; URLs are supplied only by runtime configuration. */
export function loadFederatedRemote(
  name: 'people' | 'delivery',
  url: string,
): Promise<RemoteModule> {
  const key = `${name}:${url}`;
  const cached = loads.get(key);
  if (cached) return cached;
  const promise = (async () => {
    await __webpack_init_sharing__('default');
    // An HTTP-200 script that does not expose a container must not reuse an older URL's global.
    Reflect.set(window, name, undefined);
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(url, location.href).href;
      script.async = true;
      const timeout = window.setTimeout(() => {
        script.remove();
        reject(new Error('Remote request timed out after 10 seconds.'));
      }, 10_000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(
          new Error(`Unable to load ${name} from ${url}. Check its runtime URL and availability.`),
        );
      };
      document.head.append(script);
    });
    const candidate: unknown = Reflect.get(window, name);
    if (!isContainer(candidate))
      throw new Error(`${name} did not expose a Module Federation container.`);
    if (!initialized.has(candidate)) {
      await candidate.init(__webpack_share_scopes__.default);
      initialized.add(candidate);
    }
    const factory = await candidate.get('./App');
    const remote: unknown = factory();
    if (!isRemote(remote))
      throw new Error(`${name} does not implement the published remote contract.`);
    return remote;
  })().catch((error: unknown) => {
    loads.delete(key);
    throw error;
  });
  loads.set(key, promise);
  return promise;
}
