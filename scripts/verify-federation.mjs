import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { JSDOM, VirtualConsole } from 'jsdom';

const nativeFetch = globalThis.fetch;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function startServer(environment = {}) {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    env: { ...process.env, PORT: '0', PEOPLE_REMOTE_URL: '/people/remoteEntry.js', DELIVERY_REMOTE_URL: '/delivery/remoteEntry.js', ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10_000);
    const ready = (chunk) => {
      output += String(chunk);
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://localhost:${match[1]}`);
      }
    };
    child.stdout.on('data', ready);
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${output}`));
    });
  });
  return {
    origin,
    async close() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    },
  };
}

function makeStorage(seed = new Map()) {
  const values = new Map(seed);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    copy() {
      return new Map(values);
    },
  };
}

function installBrowserAdapters(window, storage) {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  window.fetch = (input, init) => {
    const address =
      typeof input === 'string' ? new URL(input, window.location.href).href : input.url;
    return nativeFetch(address, init);
  };
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}

async function openPage(origin, route, storage) {
  const runtimeErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!/Could not parse CSS stylesheet|Could not load the link/.test(error.message))
      runtimeErrors.push(error.message);
  });
  virtualConsole.on('error', (...args) => runtimeErrors.push(args.map(String).join(' ')));
  const dom = await JSDOM.fromURL(`${origin}${route}`, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      installBrowserAdapters(window, storage);
    },
  });
  return { dom, runtimeErrors };
}

async function waitFor(dom, predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(
    `Timed out waiting for ${label}. Body: ${(dom.window.document.body.textContent ?? '').slice(0, 500)}`,
  );
}

function bodyText(dom) {
  return dom.window.document.body.textContent ?? '';
}

function button(dom, matcher) {
  const match = [...dom.window.document.querySelectorAll('button')].find((candidate) =>
    matcher.test(candidate.getAttribute('aria-label') ?? candidate.textContent ?? ''),
  );
  assert.ok(match, `Button ${matcher} was not found`);
  return match;
}

function click(dom, matcher) {
  button(dom, matcher).dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

function setInput(dom, input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value',
  )?.set;
  assert.ok(setter, 'HTML input value setter is unavailable');
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function select(dom, label, value) {
  const element = [...dom.window.document.querySelectorAll('select')].find((candidate) =>
    (candidate.parentElement?.textContent ?? '').includes(label),
  );
  assert.ok(element, `Select ${label} was not found`);
  element.value = value;
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

async function closePage(page, expectedErrors = []) {
  page.dom.window.close();
  const unexpectedErrors = page.runtimeErrors.filter(
    (error) => !expectedErrors.some((expectedError) => expectedError.test(error)),
  );
  assert.deepEqual(unexpectedErrors, [], `JSDOM runtime errors: ${unexpectedErrors.join(' | ')}`);
}

async function assertRemoteExecuted(page, name) {
  await waitFor(
    page.dom,
    () =>
      typeof page.dom.window[name] === 'object' && typeof page.dom.window[name]?.get === 'function',
    `${name} Module Federation container`,
  );
}

async function standalonePersistence(server) {
  const storage = makeStorage();
  const first = await openPage(server.origin, '/people/', storage);
  await waitFor(
    first.dom,
    () => bodyText(first.dom).includes('People & rates'),
    'standalone People',
  );
  await assertRemoteExecuted(first, 'people');
  click(first.dom, /^Add rate$/);
  await waitFor(
    first.dom,
    () => first.dom.window.document.querySelector('dialog')?.open === true,
    'add-rate dialog',
  );
  const dialog = first.dom.window.document.querySelector('dialog');
  assert.ok(dialog, 'Add-rate dialog missing');
  const inputs = [...dialog.querySelectorAll('input')];
  assert.equal(inputs.length, 2);
  setInput(first.dom, inputs[0], '2027-01-01');
  setInput(first.dom, inputs[1], '123');
  click(first.dom, /^Save rate$/);
  await waitFor(first.dom, () => bodyText(first.dom).includes('123.00'), 'saved standalone rate');
  const persisted = storage.copy();
  await closePage(first);

  const second = await openPage(server.origin, '/people/', makeStorage(persisted));
  await waitFor(
    second.dom,
    () => bodyText(second.dom).includes('123.00'),
    'persisted standalone rate after refresh',
  );
  await assertRemoteExecuted(second, 'people');
  await closePage(second);
}

async function hosted(server) {
  const page = await openPage(server.origin, '/', makeStorage());
  await waitFor(page.dom, () => bodyText(page.dom).includes('Staffing plan'), 'hosted Delivery');
  await assertRemoteExecuted(page, 'delivery');
  click(page.dom, /^Compare both$/);
  await waitFor(page.dom, () => bodyText(page.dom).includes('People & rates'), 'hosted People');
  await assertRemoteExecuted(page, 'people');
  const statuses = [...page.dom.window.document.querySelectorAll('.remote-status')].filter((node) =>
    (node.textContent ?? '').includes('shared React verified'),
  );
  assert.equal(statuses.length, 2, 'Both hosted remotes must verify the shared React identity');

  select(page.dom, 'Active user', 'emp-002');
  await waitFor(
    page.dom,
    () =>
      bodyText(page.dom).includes('Editing as Lena Okafor') &&
      bodyText(page.dom).includes('Active user: emp-002'),
    'active user propagation',
  );
  select(page.dom, 'Display currency', 'USD');
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('display USD') && bodyText(page.dom).includes('$8,668.00'),
    'display currency propagation',
  );

  click(page.dom, /^Correct rate from 2026-03-12$/);
  await waitFor(
    page.dom,
    () => page.dom.window.document.querySelector('dialog')?.open === true,
    'rate correction dialog',
  );
  const rateDialog = page.dom.window.document.querySelector('dialog');
  assert.ok(rateDialog, 'Rate correction dialog missing');
  const costInput = rateDialog.querySelector('input[type="number"]');
  assert.ok(costInput, 'Rate correction cost input missing');
  setInput(page.dom, costInput, '100');
  click(page.dom, /^Save rate$/);
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('$8,976.00'),
    'live Delivery repricing after People rate edit',
  );
  await closePage(page);
}

async function standaloneDelivery(server) {
  const page = await openPage(server.origin, '/delivery/', makeStorage());
  await waitFor(page.dom, () => bodyText(page.dom).includes('Staffing plan') && bodyText(page.dom).includes('€7,880.00'), 'standalone Delivery and the seed reference');
  await assertRemoteExecuted(page, 'delivery');
  assert.match(bodyText(page.dom), /Standalone remote/);
  await closePage(page);
}

async function failure(server) {
  const page = await openPage(server.origin, '/', makeStorage());
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('Delivery is unavailable'),
    'failed Delivery panel',
  );
  click(page.dom, /^People$/);
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('People & rates'),
    'People after Delivery failure',
  );
  assert.match(bodyText(page.dom), /Delivery is unavailable/);
  await closePage(page, [/Could not load script: .*missing\/delivery\.js/]);
}

async function relocated(server) {
  const page = await openPage(server.origin, '/', makeStorage());
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('Staffing plan'),
    'relocated hosted Delivery',
  );
  await assertRemoteExecuted(page, 'delivery');
  click(page.dom, /^Compare both$/);
  await waitFor(
    page.dom,
    () => bodyText(page.dom).includes('People & rates'),
    'relocated hosted People',
  );
  await assertRemoteExecuted(page, 'people');
  await closePage(page);
}

const defaultServer = await startServer();
try {
  await standalonePersistence(defaultServer);
  await standaloneDelivery(defaultServer);
  await hosted(defaultServer);
} finally {
  await defaultServer.close();
}

const failedServer = await startServer({ DELIVERY_REMOTE_URL: '/missing/delivery.js' });
try {
  await failure(failedServer);
} finally {
  await failedServer.close();
}

const relocatedServer = await startServer({
  PEOPLE_REMOTE_URL: '/alternate/people/remoteEntry.js',
  DELIVERY_REMOTE_URL: '/alternate/delivery/remoteEntry.js',
});
try {
  await relocated(relocatedServer);
} finally {
  await relocatedServer.close();
}

console.log(
  'Federation smoke verified: standalone remotes, hosted real containers, shared React, live rate propagation, persistence, failure isolation, and relocated runtime URLs.',
);
