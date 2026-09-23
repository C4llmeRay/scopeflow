/**
 * Taking the database in a browser.
 *
 * expo-sqlite on web keeps its files in the origin private file system and holds
 * an exclusive access handle on each one. Two things break that:
 *
 *   * A reload. The old page's worker is torn down a beat after the new page
 *     starts, so the new page asks for handles that are still held, fails, and
 *     — because the failure leaves expo-sqlite's worker half-initialised — cannot
 *     recover without another reload.
 *   * A second tab, which would fight the first for the same files.
 *
 * So: one tab at a time, by a Web Lock held for the life of the page, and no
 * opening until every file can actually be opened.
 */

const LOCK_NAME = 'scopeflow-database';
const WAIT_MS = 8_000;
const POLL_MS = 150;

/** Runs in a throwaway worker: sync access handles only exist in workers. */
const PROBE = `
const busy = async (dir) => {
  for await (const [, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      if (await busy(handle)) return true;
      continue;
    }
    try {
      const access = await handle.createSyncAccessHandle();
      access.close();
    } catch (error) {
      if (error && error.name === 'NoModificationAllowedError') return true;
    }
  }
  return false;
};
onmessage = async () => {
  try { postMessage(await busy(await navigator.storage.getDirectory())); }
  catch { postMessage(false); }
};
`;

function filesAreBusy(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    worker.onmessage = (event) => resolve(Boolean(event.data));
    worker.postMessage(null);
  });
}

async function waitForFreeFiles(): Promise<void> {
  if (typeof Worker === 'undefined' || !navigator.storage?.getDirectory) return;

  const url = URL.createObjectURL(new Blob([PROBE], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    const deadline = Date.now() + WAIT_MS;
    while ((await filesAreBusy(worker)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

let claimed: Promise<void> | null = null;

export function claimDatabase(): Promise<void> {
  claimed ??= (async () => {
    if (navigator.locks) {
      await new Promise<void>((acquired) => {
        void navigator.locks.request(LOCK_NAME, () => {
          acquired();
          // Never settles: the lock is released when this page goes away.
          return new Promise<void>(() => {});
        });
      });
    }
    await waitForFreeFiles();
  })();
  return claimed;
}
