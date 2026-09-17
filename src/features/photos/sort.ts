/**
 * Working through a pile of untagged photos.
 *
 * Capture mode lets a contractor shoot without stopping to say which room they
 * are in — that is the point of it, and it means a job routinely ends with
 * forty photos tagged "Untagged". This is the other half of that bargain.
 *
 * The rules here are about not losing somebody's place. Sorting happens in a
 * truck, one-handed, interrupted — so the queue is stable, the position after
 * an assignment is predictable, and a mistake is reversible. Getting that
 * wrong makes the feature worse than useless: a sorter that jumps around
 * costs more attention than tagging each photo by hand.
 */

export interface SortablePhoto {
  id: string;
  roomId: string | null;
  takenAt: number | null;
  createdAt: number;
}

/**
 * The photos still needing a room, oldest first.
 *
 * Oldest first because it follows the walk. A contractor sorting in the truck
 * is replaying the inspection in their head — front door, hallway, the bedroom
 * with the ceiling stain — and any other order fights that memory.
 *
 * `takenAt` can be null when the camera gave no timestamp, so createdAt is the
 * tiebreak and the id is the final one, which keeps the order stable across
 * reloads rather than letting equal keys shuffle.
 */
export function sortQueue<T extends SortablePhoto>(photos: readonly T[]): T[] {
  return photos
    .filter((photo) => photo.roomId === null)
    .slice()
    .sort((a, b) => {
      const at = a.takenAt ?? a.createdAt;
      const bt = b.takenAt ?? b.createdAt;
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Where to stand after assigning the photo at `index` from a queue of `length`.
 *
 * The assigned photo leaves the queue, so everything after it shifts down by
 * one and staying put is what shows the next photo. The exception is the last
 * one: staying put would be past the end, so it steps back.
 *
 * Returns -1 when the queue is now empty, which the screen reads as "done".
 */
export function indexAfterAssign(index: number, length: number): number {
  const remaining = length - 1;
  if (remaining <= 0) return -1;
  return index >= remaining ? remaining - 1 : index;
}

/** Where to stand after skipping — the photo stays, so move past it. */
export function indexAfterSkip(index: number, length: number): number {
  if (length === 0) return -1;
  return (index + 1) % length;
}

export interface SortProgress {
  done: number;
  total: number;
  /** For the header. "12 of 40 sorted". */
  label: string;
}

/**
 * Progress counted against the whole job, not the queue.
 *
 * Counting the queue down to zero would show "3 left" whether the job has four
 * photos or four hundred, which tells a contractor nothing about whether to
 * start now or after lunch.
 */
export function sortProgress(totalPhotos: number, untaggedCount: number): SortProgress {
  const done = Math.max(0, totalPhotos - untaggedCount);
  return {
    done,
    total: totalPhotos,
    label:
      totalPhotos === 0
        ? 'No photos yet'
        : untaggedCount === 0
          ? `All ${totalPhotos} sorted`
          : `${done} of ${totalPhotos} sorted`,
  };
}

/**
 * The room to offer first.
 *
 * Consecutive photos are nearly always the same room — somebody shoots the
 * water line, the baseboard and the floor of one bathroom in a row. Offering
 * the previous choice first turns three taps into one, and it is the single
 * thing that makes bulk sorting bearable.
 */
export function suggestRoomId(
  lastAssignedRoomId: string | null,
  roomIds: readonly string[],
): string | null {
  if (lastAssignedRoomId && roomIds.includes(lastAssignedRoomId)) return lastAssignedRoomId;
  return null;
}
