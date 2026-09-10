/*
 * A static server for the mock, so it can be opened the way any other is.
 *
 * The Meridian mock is one self-contained HTML file, so it will open straight
 * off the disk — but a `file://` page makes an evaluator go and turn on "Allow
 * access to file URLs" before the extension can touch it, which is a step that
 * has nothing to do with what is being evaluated and everything to do with how
 * the file happens to be stored. Over http it behaves exactly like the
 * assignment's own mock: `npm run mock`, open the URL, build into the tab.
 *
 * No dependency. `serve` and `http-server` would each do this, and neither is
 * worth an install and a lockfile entry for twenty lines that cannot fail.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 5174);
const page = fileURLToPath(new URL('./meridian/index.html', import.meta.url));

createServer(async (request, response) => {
  try {
    // One page, so every path serves it: a designer that routes with the
    // History API asks for URLs no file exists at.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await readFile(page));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end(String(error && error.message ? error.message : error));
  }
}).listen(PORT, () => {
  console.log(`Meridian Clinical mock on http://localhost:${PORT}/`);
  console.log('  Open it, click the extension icon, choose the spec, Build into this tab.');
});
