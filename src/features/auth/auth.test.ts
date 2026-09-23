import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { saveCompany } from '../../db/companies';
import { saveJob } from '../../db/jobs';
import { savePriceItem } from '../../db/price-items';
import { saveRoom } from '../../db/rooms';
import { APP_SCHEMA } from '../../db/schema';
import type { RunResult, SqlParam, SqliteAdapter } from '../../db/sqlite-adapter';
import type { LocalDatabase } from '../../db/types';
import { SqliteOutboxStore } from '../../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../../sync/uploads';
import { adoptLocalData, hasOrphanedData, PLACEHOLDER_COMPANY_ID } from './adopt';
import {
  currentCompanyId,
  isSignedIn,
  NotSignedIn,
  peekCompanyId,
  setCurrentIdentity,
} from './current';
import {
  canSignInWithPassword,
  checkAuthForm,
  describeAuthError,
  describePasswordError,
  isCompleteOtp,
  isPlausibleEmail,
  normalizeEmail,
  normalizeOtp,
  OTP_LENGTH,
} from './session';

/* -------------------------------------------------------------------------- */

describe('the signed-in identity', () => {
  beforeEach(() => setCurrentIdentity(null));

  it('starts empty', () => {
    expect(isSignedIn()).toBe(false);
    expect(peekCompanyId()).toBeNull();
  });

  it('throws for screen code that asks before sign-in, because that is a bug', () => {
    expect(() => currentCompanyId()).toThrow(NotSignedIn);
  });

  it('returns null for background work, which may legitimately run early', () => {
    expect(peekCompanyId()).toBeNull();
  });

  it('remembers who signed in', () => {
    setCurrentIdentity({ companyId: 'co-real', userId: 'user-1' });
    expect(currentCompanyId()).toBe('co-real');
    expect(peekCompanyId()).toBe('co-real');
    expect(isSignedIn()).toBe(true);
  });

  it('forgets on sign out', () => {
    setCurrentIdentity({ companyId: 'co-real', userId: 'user-1' });
    setCurrentIdentity(null);
    expect(isSignedIn()).toBe(false);
    expect(() => currentCompanyId()).toThrow(NotSignedIn);
  });
});

/* -------------------------------------------------------------------------- */

describe('email', () => {
  it('accepts the addresses people actually have', () => {
    for (const email of ['a@b.co', 'jobs+claims@mail.harbor.test', 'first.last@sub.domain.org']) {
      expect(isPlausibleEmail(email), email).toBe(true);
    }
  });

  it('catches a missing @ or domain', () => {
    for (const email of ['nope', 'a@b', 'a b@c.com', '']) {
      expect(isPlausibleEmail(email), email).toBe(false);
    }
  });

  it('normalises what a phone keyboard produces', () => {
    expect(normalizeEmail('  Office@Harbor.TEST ')).toBe('office@harbor.test');
  });
});

describe('the code', () => {
  it('keeps only digits, however it was pasted', () => {
    expect(normalizeOtp('123 456')).toBe('123456');
    expect(normalizeOtp('123-456')).toBe('123456');
    expect(normalizeOtp('  1 2 3 4 5 6  ')).toBe('123456');
  });

  it('never grows past the code length', () => {
    expect(normalizeOtp('1234567890')).toHaveLength(OTP_LENGTH);
  });

  it('knows when it is complete', () => {
    expect(isCompleteOtp('12345')).toBe(false);
    expect(isCompleteOtp('123456')).toBe(true);
    expect(isCompleteOtp('123 456')).toBe(true);
  });
});

describe('checkAuthForm', () => {
  it('does not turn the field red before anything is typed', () => {
    expect(checkAuthForm({ email: '', code: '', step: 'email' }).emailError).toBeNull();
  });

  it('will not send a code to a malformed address', () => {
    const checks = checkAuthForm({ email: 'nope', code: '', step: 'email' });
    expect(checks.canSendCode).toBe(false);
    expect(checks.emailError).toMatch(/email address/);
  });

  it('sends once the address looks real', () => {
    expect(checkAuthForm({ email: 'a@b.co', code: '', step: 'email' }).canSendCode).toBe(true);
  });

  it('verifies only with a full code', () => {
    expect(checkAuthForm({ email: 'a@b.co', code: '12345', step: 'code' }).canVerify).toBe(false);
    expect(checkAuthForm({ email: 'a@b.co', code: '123456', step: 'code' }).canVerify).toBe(true);
  });
});

describe('describeAuthError', () => {
  it('turns an expired token into something to do about it', () => {
    expect(describeAuthError(new Error('Token has expired or is invalid'))).toMatch(
      /send a new one/,
    );
  });

  it('explains rate limiting in plain words', () => {
    expect(describeAuthError(new Error('For security purposes... rate limit'))).toMatch(
      /Wait a minute/,
    );
  });

  it('says signing in is the one thing that needs signal', () => {
    expect(describeAuthError(new TypeError('Network request failed'))).toMatch(
      /everything else works without it/,
    );
  });

  it('falls back to the original rather than swallowing it', () => {
    expect(describeAuthError(new Error('Something very specific'))).toBe('Something very specific');
  });

  it('survives a non-Error', () => {
    expect(describeAuthError(null)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */

function nodeAdapter(): SqliteAdapter {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      return { changes: Number(db.prepare(sql).run(...params).changes) };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('begin');
      try {
        const r = await fn();
        db.exec('commit');
        return r;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
}

async function makeDb(): Promise<LocalDatabase> {
  const adapter = nodeAdapter();
  await adapter.exec(APP_SCHEMA);
  return {
    adapter,
    outbox: await SqliteOutboxStore.create(adapter),
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
}

const REAL = '11111111-2222-3333-4444-555555555555';

/** A contractor who has been testing before there was any sign-in. */
async function seedPreAuthWork(db: LocalDatabase) {
  await saveCompany(
    db,
    {
      id: PLACEHOLDER_COMPANY_ID,
      name: 'Harbor Restoration LLC',
      licenseNo: 'TX-RC-118244',
      phone: '(512) 555-0142',
      estimateTerms: 'My own terms.',
    },
    1_000,
  );
  await saveJob(db, { id: 'job-1', companyId: PLACEHOLDER_COMPANY_ID }, 1_000);
  await saveRoom(
    db,
    {
      id: 'room-1', companyId: PLACEHOLDER_COMPANY_ID, jobId: 'job-1',
      name: 'Master Bedroom', lengthIn: 144, widthIn: 168, heightIn: 96,
    },
    1_000,
  );
  await savePriceItem(
    db,
    {
      id: 'p-1', companyId: PLACEHOLDER_COMPANY_ID, code: 'FCC-CPT',
      description: 'Carpet', unit: 'SF', materialCostCents: 320,
    },
    1_000,
  );
}

describe('adopting work done before signing in', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
    await seedPreAuthWork(db);
  });

  it('sees that there is something to adopt', async () => {
    expect(await hasOrphanedData(db)).toBe(true);
  });

  it('re-files every row under the real company', async () => {
    const result = await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);

    expect(result.rowsMoved).toBeGreaterThan(0);
    expect(await hasOrphanedData(db)).toBe(false);

    for (const table of ['jobs', 'rooms', 'price_items']) {
      const [row] = await db.adapter.all<{ n: number }>(
        `select count(*) as n from ${table} where company_id = ?`,
        [REAL],
      );
      expect(row.n, table).toBeGreaterThan(0);
    }
  });

  it('carries across the profile they had already filled in', async () => {
    const result = await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    expect(result.profileCarried).toBe(true);

    const { getCompany } = await import('../../db/companies');
    const company = await getCompany(db, REAL);
    expect(company).toMatchObject({
      name: 'Harbor Restoration LLC',
      licenseNo: 'TX-RC-118244',
      estimateTerms: 'My own terms.',
    });
  });

  it('rewrites the tenant inside queued pushes, which RLS would otherwise refuse', async () => {
    const before = (await db.outbox.all()).filter(
      (e) => e.payload.company_id === PLACEHOLDER_COMPANY_ID,
    );
    expect(before.length).toBeGreaterThan(0);

    const result = await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    expect(result.queueEntriesRewritten).toBeGreaterThan(0);

    const after = await db.outbox.all();
    expect(after.filter((e) => e.payload.company_id === PLACEHOLDER_COMPANY_ID)).toHaveLength(0);
    expect(after.filter((e) => e.payload.company_id === REAL).length).toBeGreaterThan(0);
  });

  it('leaves queued payloads otherwise intact', async () => {
    await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    const room = (await db.outbox.all()).find((e) => e.entityId === 'room-1');
    expect(room?.payload).toMatchObject({ name: 'Master Bedroom', length_in: 144 });
  });

  it('removes the placeholder company so it cannot be used again', async () => {
    await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    const { getCompany } = await import('../../db/companies');
    expect(await getCompany(db, PLACEHOLDER_COMPANY_ID)).toBeNull();
  });

  it('does nothing the second time, so a repeat sign-in is harmless', async () => {
    await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    const second = await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 3_000);

    expect(second.rowsMoved).toBe(0);
    expect(second.profileCarried).toBe(false);
  });

  it('never writes over a real profile that already has a name', async () => {
    await saveCompany(db, { id: REAL, name: 'The Signed-In Name' }, 1_500);
    const result = await adoptLocalData(db, REAL, PLACEHOLDER_COMPANY_ID, 2_000);

    expect(result.profileCarried).toBe(false);
    const { getCompany } = await import('../../db/companies');
    expect((await getCompany(db, REAL))?.name).toBe('The Signed-In Name');
    // The rows still move, even though the profile did not.
    expect(result.rowsMoved).toBeGreaterThan(0);
  });

  it('refuses to adopt onto itself', async () => {
    const result = await adoptLocalData(db, PLACEHOLDER_COMPANY_ID, PLACEHOLDER_COMPANY_ID, 2_000);
    expect(result).toEqual({ rowsMoved: 0, queueEntriesRewritten: 0, profileCarried: false });
    expect(await hasOrphanedData(db)).toBe(true);
  });

  it('is fine on a fresh install with nothing to adopt', async () => {
    const empty = await makeDb();
    const result = await adoptLocalData(empty, REAL, PLACEHOLDER_COMPANY_ID, 2_000);
    expect(result.rowsMoved).toBe(0);
    expect(await hasOrphanedData(empty)).toBe(false);
  });
});

describe('password sign-in', () => {
  it('needs a plausible email and some password', () => {
    expect(canSignInWithPassword('a@b.co', 'x')).toBe(true);
    expect(canSignInWithPassword(' A@B.co ', 'x')).toBe(true);
    expect(canSignInWithPassword('a@b.co', '')).toBe(false);
    expect(canSignInWithPassword('nope', 'secret')).toBe(false);
  });

  it('says plainly when the credentials are wrong', () => {
    expect(describePasswordError(new Error('Invalid login credentials'))).toBe(
      'That email and password do not match an account.',
    );
  });

  it('says how to fix an unconfirmed dashboard account', () => {
    expect(describePasswordError(new Error('Email not confirmed'))).toMatch(/Auto Confirm User/);
  });

  it('falls back to the general wording for everything else', () => {
    expect(describePasswordError(new Error('Failed to fetch'))).toMatch(/No connection/);
  });
});
