/**
 * Not losing somebody's place in a pile of forty photos.
 *
 * The index arithmetic looks trivial and is the entire feature: get it wrong
 * and the sorter skips a photo, or shows the same one twice, or jumps to the
 * top after every tap. Any of those is worse than tagging by hand.
 */

import { describe, expect, it } from 'vitest';

import {
  indexAfterAssign,
  indexAfterSkip,
  sortProgress,
  sortQueue,
  suggestRoomId,
  type SortablePhoto,
} from './sort';

const photo = (over: Partial<SortablePhoto> & { id: string }): SortablePhoto => ({
  roomId: null,
  takenAt: null,
  createdAt: 0,
  ...over,
});

describe('sortQueue', () => {
  it('keeps only the photos that still need a room', () => {
    const queue = sortQueue([
      photo({ id: 'a', takenAt: 1 }),
      photo({ id: 'b', takenAt: 2, roomId: 'room-1' }),
      photo({ id: 'c', takenAt: 3 }),
    ]);
    expect(queue.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('runs oldest first, following the walk through the house', () => {
    const queue = sortQueue([
      photo({ id: 'c', takenAt: 300 }),
      photo({ id: 'a', takenAt: 100 }),
      photo({ id: 'b', takenAt: 200 }),
    ]);
    expect(queue.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to when the row was written if the camera gave no timestamp', () => {
    const queue = sortQueue([
      photo({ id: 'late', takenAt: null, createdAt: 900 }),
      photo({ id: 'early', takenAt: null, createdAt: 100 }),
    ]);
    expect(queue.map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('orders burst shots stably rather than letting them shuffle', () => {
    // Three frames in the same second is completely ordinary. Without the id
    // tiebreak the order can change between reloads, and the contractor loses
    // their place for no visible reason.
    const same = [
      photo({ id: 'c', takenAt: 500 }),
      photo({ id: 'a', takenAt: 500 }),
      photo({ id: 'b', takenAt: 500 }),
    ];
    expect(sortQueue(same).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortQueue(same.slice().reverse()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate what it was given', () => {
    const input = [photo({ id: 'b', takenAt: 2 }), photo({ id: 'a', takenAt: 1 })];
    sortQueue(input);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('indexAfterAssign', () => {
  it('stays put, because the assigned photo left and the next slid into place', () => {
    expect(indexAfterAssign(0, 5)).toBe(0);
    expect(indexAfterAssign(2, 5)).toBe(2);
  });

  it('steps back when the last one was assigned', () => {
    // Staying at 4 in a queue that is now 4 long would be past the end, and
    // the screen would render nothing at all.
    expect(indexAfterAssign(4, 5)).toBe(3);
  });

  it('reports an empty queue rather than an index', () => {
    expect(indexAfterAssign(0, 1)).toBe(-1);
  });
});

describe('indexAfterSkip', () => {
  it('moves past a photo that is staying in the queue', () => {
    expect(indexAfterSkip(0, 5)).toBe(1);
  });

  it('wraps, so skipping through the end comes back to the unsorted start', () => {
    // Skipping is for "I cannot tell which room this is" — those photos need
    // another look, so the queue is a loop, not a cliff.
    expect(indexAfterSkip(4, 5)).toBe(0);
  });

  it('reports an empty queue', () => {
    expect(indexAfterSkip(0, 0)).toBe(-1);
  });
});

describe('sortProgress', () => {
  it('counts against the whole job, not the queue', () => {
    expect(sortProgress(40, 28).label).toBe('12 of 40 sorted');
  });

  it('says so when there is nothing left', () => {
    expect(sortProgress(40, 0).label).toBe('All 40 sorted');
  });

  it('handles a job with no photos without dividing by anything', () => {
    expect(sortProgress(0, 0).label).toBe('No photos yet');
  });

  it('never reports negative progress if the counts disagree', () => {
    // The two numbers come from two queries and can briefly disagree mid-write.
    // "-3 of 5 sorted" is the kind of thing that makes an app look broken.
    expect(sortProgress(5, 8).done).toBe(0);
  });
});

describe('suggestRoomId', () => {
  it('offers the room the last photo went to', () => {
    // Consecutive photos are nearly always the same room, so this is the
    // difference between one tap and three.
    expect(suggestRoomId('room-2', ['room-1', 'room-2'])).toBe('room-2');
  });

  it('offers nothing when that room has since been deleted', () => {
    expect(suggestRoomId('room-9', ['room-1', 'room-2'])).toBeNull();
  });

  it('offers nothing at the start', () => {
    expect(suggestRoomId(null, ['room-1'])).toBeNull();
  });
});
