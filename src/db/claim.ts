/**
 * Native builds own their database file outright; there is nothing to wait for.
 * The web build has to take turns — see claim.web.ts.
 */
export async function claimDatabase(): Promise<void> {}
