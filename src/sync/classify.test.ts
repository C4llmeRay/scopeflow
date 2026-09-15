import { describe, expect, it } from 'vitest';

import { classifyPushError } from './classify';

describe('classifyPushError — retry these', () => {
  it('treats a thrown network error as transient', () => {
    expect(classifyPushError(new TypeError('Network request failed'))).toEqual({
      kind: 'transient',
      message: 'Network request failed',
    });
  });

  it('treats rate limiting as transient', () => {
    expect(classifyPushError({ status: 429, message: 'Too many requests' }).kind).toBe('transient');
  });

  it('treats server errors as transient', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyPushError({ status, message: 'upstream' }).kind).toBe('transient');
    }
  });

  it('treats connection and resource SQLSTATEs as transient', () => {
    expect(classifyPushError({ code: '08006', message: 'connection failure' }).kind).toBe('transient');
    expect(classifyPushError({ code: '53300', message: 'too many connections' }).kind).toBe('transient');
    expect(classifyPushError({ code: '57P01', message: 'admin shutdown' }).kind).toBe('transient');
    expect(classifyPushError({ code: '40001', message: 'serialization failure' }).kind).toBe('transient');
  });

  it('falls back to transient for something unrecognisable', () => {
    expect(classifyPushError('who knows').kind).toBe('transient');
    expect(classifyPushError(null).kind).toBe('transient');
    expect(classifyPushError(undefined).kind).toBe('transient');
  });
});

describe('classifyPushError — do not retry these', () => {
  it('treats an RLS refusal as permanent', () => {
    const result = classifyPushError({
      code: '42501',
      message: 'new row violates row-level security policy for table "jobs"',
      status: 403,
    });
    expect(result.kind).toBe('permanent');
    expect(result.message).toMatch(/row-level security/);
  });

  it('treats constraint violations as permanent', () => {
    expect(classifyPushError({ code: '23503', message: 'foreign key violation' }).kind).toBe('permanent');
    expect(classifyPushError({ code: '23514', message: 'check constraint' }).kind).toBe('permanent');
    expect(classifyPushError({ code: '23502', message: 'null value in column' }).kind).toBe('permanent');
  });

  it('treats a malformed request as permanent', () => {
    expect(classifyPushError({ code: 'PGRST204', message: 'column not found', status: 400 }).kind)
      .toBe('permanent');
  });

  it('treats a 404 as permanent', () => {
    expect(classifyPushError({ status: 404, code: '', message: 'not found' }).kind).toBe('permanent');
  });
});

describe('classifyPushError — messages', () => {
  it('prefers message, then details, then a synthesised fallback', () => {
    expect(classifyPushError({ code: '23505', message: 'duplicate key' }).message).toBe('duplicate key');
    expect(classifyPushError({ code: '23505', details: 'Key (id) exists' }).message).toBe('Key (id) exists');
    expect(classifyPushError({ code: '23505' }).message).toBe('push failed (23505)');
  });
});
