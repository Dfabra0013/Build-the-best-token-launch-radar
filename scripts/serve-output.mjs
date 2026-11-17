import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] || process.env.MAKEFUN_OUTPUT_DIR || 'out');
const port = Number(process.env.PORT || 4175);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

if (!existsSync(root) || !statSync(root).isDirectory()) {
  throw new Error(`No output directory at ${root}. Generate artifacts first with node main.ts.`);
}

createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://preview.local').pathname;
  if (pathname === '/') {
    response.writeHead(302, { location: '/dashboard/' });
    response.end();
    return;
  }
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const absolute = resolve(root, relative.endsWith('/') ? `${relative}index.html` : relative);
  if (!absolute.startsWith(`${root}/`) || !existsSync(absolute) || !statSync(absolute).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': mime[extname(absolute).toLowerCase()] || 'application/octet-stream'
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(absolute).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`Signal Atlas presentation server: http://0.0.0.0:${port}/dashboard/`);
});
