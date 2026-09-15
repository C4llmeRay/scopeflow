/**
 * Who is signed in, for code that is not a React component.
 *
 * The sync engine, the AI queue and the repositories all need the company id
 * and none of them can call a hook. A module-level value set once by the auth
 * provider is the honest way to do that: a context would force every background
 * worker to become a component, and passing it through forty call sites would
 * be noise.
 *
 * Two readers on purpose. `currentCompanyId()` throws, because any UI path that
 * needs a company when nobody is signed in is a bug — the screens are gated.
 * `peekCompanyId()` returns null, for background work that fires on a timer and
 * may genuinely run before sign-in resolves.
 */

let companyId: string | null = null;
let userId: string | null = null;

export class NotSignedIn extends Error {
  constructor() {
    super('Nobody is signed in.');
    this.name = 'NotSignedIn';
  }
}

export function setCurrentIdentity(next: { companyId: string; userId: string } | null): void {
  companyId = next?.companyId ?? null;
  userId = next?.userId ?? null;
}

/** For screens, which only render once somebody is signed in. */
export function currentCompanyId(): string {
  if (!companyId) throw new NotSignedIn();
  return companyId;
}

/** For background work, which may run before sign-in resolves. */
export const peekCompanyId = (): string | null => companyId;
export const peekUserId = (): string | null => userId;
export const isSignedIn = (): boolean => companyId !== null;
