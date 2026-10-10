// The same dependency-free server runs in the container and for local development.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8080);
const config = {
  peopleUrl: process.env.PEOPLE_REMOTE_URL ?? '/people/remoteEntry.js',
  deliveryUrl: process.env.DELIVERY_REMOTE_URL ?? '/delivery/remoteEntry.js',
  seedUrl: '/data/baseline-seed.json',
};
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      response.writeHead(200);
      response.end('ok');
      return;
    }
    if (url.pathname === '/runtime-config.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(config));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    // /alternate is a second route to the identical remote artifacts, used to prove runtime relocation.
    pathname = pathname.replace(/^\/alternate\//, '/');
    let filename;
    if (pathname === '/data/baseline-seed.json')
      filename = path.join(root, 'data/baseline-seed.json');
    else {
      const app = pathname.startsWith('/people/')
        ? 'people'
        : pathname.startsWith('/delivery/')
          ? 'delivery'
          : 'shell';
      const relative = app === 'shell' ? pathname : pathname.slice(app.length + 1);
      const appRoot = path.join(root, 'dist', app);
      filename = path.resolve(
        appRoot,
        `.${relative.endsWith('/') ? `${relative}index.html` : relative}`,
      );
      if (!filename.startsWith(`${appRoot}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
    }
    if (!(await stat(filename)).isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Cache-Control': /\.[a-f0-9]{16,}\.js$/.test(filename)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Asset not found');
  }
});
server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(
    `Baseline serving http://localhost:${listeningPort}; runtime remotes: ${JSON.stringify(config)}`,
  );
});
