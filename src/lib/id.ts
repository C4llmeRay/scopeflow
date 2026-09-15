import * as Crypto from 'expo-crypto';

/**
 * Client-generated record IDs.
 *
 * Every record gets its UUID on the phone, before it has ever seen the network.
 * That is what makes a push an idempotent upsert, what lets a room reference a
 * job that has not synced yet, and what makes retrying a push that actually
 * succeeded harmless.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
