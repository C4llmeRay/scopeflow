/**
 * Writing a classification into the app's own records.
 *
 * Findings become damage records tagged `ai_photo`, which is what makes the
 * acceptance rate measurable: keeping one counts as accepting the model's
 * advice, deleting it counts as rejecting it.
 *
 * Two things are deliberately conservative. A caption is only written when the
 * contractor has not written one — theirs always wins. And a finding for a
 * material already recorded in the room is skipped rather than duplicated, so
 * confirming what a human already knew is not mistaken for adding to it.
 */

import { listDamages, saveDamage } from '../../db/damages';
import { getPhoto, setPhotoCaption } from '../../db/photos';
import type { LocalDatabase } from '../../db/types';
import { ALLOWED_MATERIALS } from './prompts';
import { cleanPhotoClassification, cleanVoiceExtraction } from './resolve';

export interface AppliedClassification {
  damagesAdded: number;
  /** Findings skipped because the contractor already recorded that material. */
  alreadyKnown: number;
  captionWritten: boolean;
  noDamageVisible: boolean;
}

export async function applyPhotoClassification(
  db: LocalDatabase,
  photoId: string,
  raw: unknown,
  makeId: () => string,
  companyId: string,
  now: number = Date.now(),
): Promise<AppliedClassification | null> {
  const photo = await getPhoto(db, photoId);
  if (!photo || photo.deletedAt !== null) return null;

  const cleaned = cleanPhotoClassification(raw, ALLOWED_MATERIALS);

  const result: AppliedClassification = {
    damagesAdded: 0,
    alreadyKnown: 0,
    captionWritten: false,
    noDamageVisible: cleaned.noDamageVisible,
  };

  // The contractor's own caption is never overwritten.
  if (!photo.caption?.trim() && cleaned.caption) {
    await setPhotoCaption(db, photoId, cleaned.caption, now);
    result.captionWritten = true;
  }

  // A finding can only become a damage record against a room. An untagged
  // photo still gets its caption; its findings wait until it is sorted.
  if (!photo.roomId) return result;

  const existing = await listDamages(db, photo.roomId);
  const known = new Set(existing.map((damage) => damage.material.toLowerCase()));

  for (const finding of cleaned.damages) {
    if (known.has(finding.material.toLowerCase())) {
      result.alreadyKnown++;
      continue;
    }

    await saveDamage(
      db,
      {
        id: makeId(),
        companyId,
        roomId: photo.roomId,
        photoId,
        material: finding.material,
        // Category and class describe the loss, so they are only taken from a
        // photo when nothing has recorded them yet.
        waterCategory: existing[0]?.waterCategory ?? cleaned.waterCategory,
        waterClass: existing[0]?.waterClass ?? cleaned.waterClass,
        affectedHeightIn: finding.affectedHeightIn,
        notes: finding.observation || null,
        source: 'ai_photo',
        aiConfidence: finding.confidence,
      },
      now,
    );

    known.add(finding.material.toLowerCase());
    result.damagesAdded++;
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Voice                                                                      */
/* -------------------------------------------------------------------------- */

export interface AppliedExtraction {
  damagesAdded: number;
  alreadyKnown: number;
  /** Things said that were not damage — access notes, reminders. */
  notes: string[];
}

/**
 * Turns a transcript into damage records.
 *
 * Same conservatism as a photo: a material the contractor already recorded is
 * confirmed, not duplicated, and the room's existing category and class win
 * over anything heard in the recording. Side notes are handed back for the UI
 * to show rather than written anywhere — a reminder about a lockbox code is
 * not damage and should not end up in a scope.
 */
export async function applyVoiceExtraction(
  db: LocalDatabase,
  voiceNoteId: string,
  raw: unknown,
  makeId: () => string,
  companyId: string,
  now: number = Date.now(),
): Promise<AppliedExtraction | null> {
  const { getVoiceNote } = await import('../../db/voice-notes');
  const note = await getVoiceNote(db, voiceNoteId);
  if (!note || note.deletedAt !== null) return null;

  const cleaned = cleanVoiceExtraction(raw, ALLOWED_MATERIALS);
  const result: AppliedExtraction = {
    damagesAdded: 0,
    alreadyKnown: 0,
    notes: cleaned.notes,
  };

  // A note tagged to the whole job has no room to attach damage to. Its side
  // notes still come back.
  if (!note.roomId) return result;

  const existing = await listDamages(db, note.roomId);
  const known = new Set(existing.map((damage) => damage.material.toLowerCase()));

  for (const finding of cleaned.damages) {
    if (known.has(finding.material.toLowerCase())) {
      result.alreadyKnown++;
      continue;
    }

    await saveDamage(
      db,
      {
        id: makeId(),
        companyId,
        roomId: note.roomId,
        material: finding.material,
        waterCategory: existing[0]?.waterCategory ?? cleaned.waterCategory,
        waterClass: existing[0]?.waterClass ?? cleaned.waterClass,
        affectedHeightIn: finding.affectedHeightIn,
        notes: finding.observation || null,
        source: 'ai_voice',
        aiConfidence: finding.confidence,
      },
      now,
    );

    known.add(finding.material.toLowerCase());
    result.damagesAdded++;
  }

  return result;
}
