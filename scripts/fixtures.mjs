import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = new Map([['/', 'tests/fixtures/player.html'], ['/frame', 'tests/fixtures/frame.html'], ['/demo.vtt', 'tests/fixtures/demo.vtt']]);
for (const port of [4173, 4174]) {
  createServer(async (req, res) => {
    const path = routes.get(new URL(req.url, 'http://localhost').pathname);
    if (!path) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', path.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'text/html; charset=utf-8'); res.end(await readFile(path)); }
    catch { res.writeHead(500).end(); }
  }).listen(port, '127.0.0.1', () => console.log(`Fixture: http://127.0.0.1:${port}`));
}
