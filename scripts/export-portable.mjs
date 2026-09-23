/**
 * Rewrites the web export (`dist/`) so it runs from any folder on any host,
 * for publishing the demo somewhere that is not the root of its own domain —
 * a claude.ai artifact, a subfolder of a static site.
 *
 * Expo's export assumes it is served from `/`: bundles live under `/_expo/`
 * and assets under `/assets/`, all absolute. This copies `dist/` to
 * `dist-portable/`, renames `_expo` (some hosts reserve names starting with
 * `_`), makes every path relative, and adds a loader that pins relative URLs
 * to the page's folder before resetting the route to `/` for expo-router.
 *
 *   npm run export:portable
 *
 * It runs its own export with EXPO_PUBLIC_EPHEMERAL_DB=1: the hosted demo keeps
 * its database in memory, and the worker is patched below so it no longer needs
 * the persistent file pool. Its output is not for `npm run serve:web`.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = 'dist-ephemeral';
const out = 'dist-portable';
const BUNDLES = 'app';

const built = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', src], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_EPHEMERAL_DB: '1' },
});
if (built.status !== 0) process.exit(built.status ?? 1);

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
renameSync(join(out, '_expo'), join(out, BUNDLES));
rmSync(join(out, 'metadata.json'), { force: true });

const jsDir = join(out, BUNDLES, 'static', 'js', 'web');
let entry = '';
for (const file of readdirSync(jsDir)) {
  const path = join(jsDir, file);
  let code = readFileSync(path, 'utf8');
  if (file.startsWith('worker-')) {
    // Resolved against the worker's own URL, four folders down.
    code = code.replaceAll('"/assets/', '"../../../../assets/');
    code = skipPersistentPool(code);
  } else {
    // Split-bundle paths become full URLs built from the page's folder at
    // runtime. Relative paths are not enough: expo-sqlite resolves its worker
    // against location.href, which the loader has reset to '/'. These strings
    // sit in object literals in the module table, so an expression is valid.
    code = code.replaceAll(
      '"/_expo/static/',
      `(typeof document<"u"?document.baseURI:"")+"${BUNDLES}/static/`,
    );
    // Image URIs resolve against the document, whose base the loader pins.
    code = code.replaceAll('"/assets/', '"assets/');
  }
  writeFileSync(path, code);
  if (file.startsWith('entry-')) entry = file;
}

/**
 * expo-sqlite's worker opens a pool of persistent files on startup, even for an
 * in-memory database, and the pool is exclusive to one page per site. A second
 * copy of the page — an embedder mounting it twice — then fails to start at all.
 * The in-memory database needs only the memory VFS, so skip the pool.
 */
function skipPersistentPool(code) {
  const pool =
    /if\(null==\w+&&\(\w+=await \w+\.AccessHandlePoolVFS\.create\(\w+,\w+\),null==\w+\)\)throw new Error\('Failed to initialize AccessHandlePoolVFS'\);if\(\w+\.vfs_register\(\w+,!0\),/;
  const check = /if\(null==\w+\|\|null==(\w+)\)throw new Error\('Invalid VFS state'\)/;
  if (!pool.test(code) || !check.test(code)) {
    throw new Error('expo-sqlite worker changed shape; update skipPersistentPool');
  }
  return code
    .replace(pool, 'if(')
    .replace(check, "if(null==$1)throw new Error('Invalid VFS state')");
}

const loader = `<script>
  // Relative URLs keep resolving against this folder after the route reset.
  (function () {
    var base = document.createElement('base');
    base.href = location.href.replace(/[^/]*([?#].*)?$/, '');
    document.head.appendChild(base);
    history.replaceState(null, '', '/');
  })();
</script>`;

const html = readFileSync(join(out, 'index.html'), 'utf8')
  .replace('<head>', `<head>\n    ${loader}`)
  .replace(/src="\/_expo\/static\/js\/web\/[^"]+"/, `src="${BUNDLES}/static/js/web/${entry}"`);
writeFileSync(join(out, 'index.html'), html);

console.log(`Portable build in ${out}/ (entry ${entry})`);
