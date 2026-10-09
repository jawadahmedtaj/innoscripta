import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';

async function shellDigest() {
  const files = (await readdir('dist/shell')).filter((file) => file.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'Build Shell first');
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(await readFile(`dist/shell/${file}`));
  return hash.digest('hex');
}
async function withServer(env, check) {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://localhost:${match[1]}`);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${output}`));
    });
  });
  try {
    await check(await ready);
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
const before = await shellDigest();
await withServer(
  { PEOPLE_REMOTE_URL: '/people/remoteEntry.js', DELIVERY_REMOTE_URL: '/delivery/remoteEntry.js' },
  async (origin) => {
    const config = await (await fetch(`${origin}/runtime-config.json`)).json();
    assert.equal(config.peopleUrl, '/people/remoteEntry.js');
    for (const route of [
      '/',
      '/people/',
      '/delivery/',
      config.peopleUrl,
      config.deliveryUrl,
      config.seedUrl,
    ]) {
      assert.equal((await fetch(`${origin}${route}`)).status, 200, route);
    }
  },
);
await withServer(
  {
    PEOPLE_REMOTE_URL: '/alternate/people/remoteEntry.js',
    DELIVERY_REMOTE_URL: '/alternate/delivery/remoteEntry.js',
  },
  async (origin) => {
    const config = await (await fetch(`${origin}/runtime-config.json`)).json();
    assert.equal(config.peopleUrl, '/alternate/people/remoteEntry.js');
    assert.equal(config.deliveryUrl, '/alternate/delivery/remoteEntry.js');
    for (const remote of ['people', 'delivery']) {
      assert.equal(
        await (await fetch(`${origin}/${remote}/remoteEntry.js`)).text(),
        await (await fetch(`${origin}/alternate/${remote}/remoteEntry.js`)).text(),
      );
      // publicPath:auto derives subsequent chunk URLs from the relocated remoteEntry route.
      for (const file of (await readdir(`dist/${remote}`)).filter((file) =>
        /\.(js|css)$/.test(file),
      )) {
        assert.equal((await fetch(`${origin}/alternate/${remote}/${file}`)).status, 200);
      }
    }
  },
);
await withServer(
  { PEOPLE_REMOTE_URL: '/people/remoteEntry.js', DELIVERY_REMOTE_URL: '/missing/delivery.js' },
  async (origin) => {
    const response = await fetch(`${origin}/runtime-config.json`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const config = await response.json();
    assert.equal(config.deliveryUrl, '/missing/delivery.js');
    assert.equal((await fetch(`${origin}${config.deliveryUrl}`)).status, 404);
    assert.equal((await fetch(`${origin}/`)).status, 200);
    assert.equal((await fetch(`${origin}${config.peopleUrl}`)).status, 200);
  },
);
assert.equal(await shellDigest(), before);
console.log(
  `Runtime configuration verified: default, relocated and failed remote routes; unchanged Shell JS SHA-256 ${before}`,
);
