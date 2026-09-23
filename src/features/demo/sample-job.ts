/**
 * A fully walked water loss, created in one tap, for showing ScopeFlow to
 * somebody who has never seen it.
 *
 * Built through the same repositories the screens use — no rows are written by
 * hand — so the sample exercises the real measurement engine, the real scope
 * template and the real AI resolver. Nothing in it is a canned total: every
 * number on the estimate is derived from the rooms below, exactly as it would
 * be for a job walked on site.
 *
 * Left deliberately unfinished in three places, because those are the moments
 * worth demonstrating live: one photo is untagged (sorting), a few AI
 * suggestions wait for a tap (accepting), and no version is frozen (sending).
 */

import { computeRoom } from '../../core/measure';
import { saveCompany, getCompany } from '../../db/companies';
import { saveDamage, type WaterCategory, type WaterClass } from '../../db/damages';
import { saveJob } from '../../db/jobs';
import { applyScopeToRoom, saveLineItem } from '../../db/line-items';
import { saveOpening } from '../../db/openings';
import { capturePhoto } from '../../db/photos';
import { listPriceItems, seedPriceListIfEmpty } from '../../db/price-items';
import { patchRecord } from '../../db/repository';
import { saveRoom } from '../../db/rooms';
import type { LocalDatabase } from '../../db/types';
import { saveVoiceNote, setTranscript } from '../../db/voice-notes';
import type { OpeningKind } from '../../core/measure';
import { resolveScopeSuggestion } from '../ai/resolve';
import { demoScopeSuggestion } from '../ai/demo';
import { isProfileComplete } from '../settings/company-form';
import { buildScope } from '../scope/templates';
import { SAMPLE_PHOTOS } from './sample-photos';

const MINUTE = 60_000;

/** Feet and inches to the integer inches the whole app stores. */
const ft = (feet: number, inches = 0): number => feet * 12 + inches;

interface SampleRoom {
  name: string;
  level: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  flooringType: string;
  floodCutHeightIn: number;
  openings: { kind: OpeningKind; widthIn: number; heightIn: number; count?: number }[];
  damage: {
    materials: string[];
    category: WaterCategory;
    waterClass: WaterClass;
    heightIn: number;
    moisturePct: number;
  };
  photos: { uri: string; caption: string }[];
  voice: string;
  /**
   * Whether to leave demo-AI suggestions waiting on this room. Only one room
   * gets them, so another is left for "Suggest what I missed" live.
   */
  suggest: boolean;
}

const ROOMS: readonly SampleRoom[] = [
  {
    name: 'Family room',
    level: 'Basement',
    lengthIn: ft(18),
    widthIn: ft(14, 6),
    heightIn: ft(8),
    flooringType: 'Carpet',
    floodCutHeightIn: 24,
    openings: [
      { kind: 'door', widthIn: 32, heightIn: 80 },
      { kind: 'window', widthIn: 32, heightIn: 20, count: 2 },
      { kind: 'archway', widthIn: 48, heightIn: 84 },
    ],
    damage: {
      materials: ['Carpet', 'Carpet pad', 'Drywall', 'Insulation', 'Baseboard'],
      category: 'cat_2',
      waterClass: 'class_3',
      heightIn: 14,
      moisturePct: 38,
    },
    photos: [
      { uri: SAMPLE_PHOTOS.familyWall, caption: 'Tide line on the north wall, about 14" up' },
      { uri: SAMPLE_PHOTOS.familyCarpet, caption: 'Carpet and pad saturated wall to wall' },
      { uri: SAMPLE_PHOTOS.familyMeter, caption: 'Drywall reading 38% at 12" above the floor' },
    ],
    voice:
      'Family room. Water came in from the laundry side. Carpet and pad are soaked wall to wall, ' +
      'drywall is wicking up to about fourteen inches, so a two foot flood cut. Insulation behind ' +
      'it will be wet. Homeowner says the furniture is already out.',
    suggest: true,
  },
  {
    name: 'Bedroom',
    level: 'Basement',
    lengthIn: ft(12),
    widthIn: ft(11),
    heightIn: ft(8),
    flooringType: 'Carpet',
    floodCutHeightIn: 24,
    openings: [
      { kind: 'door', widthIn: 30, heightIn: 80 },
      { kind: 'door', widthIn: 60, heightIn: 80 },
      { kind: 'window', widthIn: 36, heightIn: 20 },
    ],
    damage: {
      materials: ['Carpet', 'Carpet pad', 'Drywall', 'Baseboard'],
      category: 'cat_2',
      waterClass: 'class_2',
      heightIn: 8,
      moisturePct: 24,
    },
    photos: [{ uri: SAMPLE_PHOTOS.bedroomWall, caption: 'Closet wall, wicking to about 8"' }],
    voice:
      'Bedroom. Carpet is wet along the closet side, maybe two thirds of the room. Drywall wicking ' +
      'about eight inches. Closet has bifold doors, those look fine.',
    suggest: false,
  },
  {
    name: 'Laundry',
    level: 'Basement',
    lengthIn: ft(9),
    widthIn: ft(7),
    heightIn: ft(8),
    flooringType: 'Vinyl plank',
    floodCutHeightIn: 24,
    openings: [{ kind: 'door', widthIn: 30, heightIn: 80 }],
    damage: {
      materials: ['Vinyl plank', 'Drywall', 'Baseboard'],
      category: 'cat_2',
      waterClass: 'class_3',
      heightIn: 16,
      moisturePct: 41,
    },
    photos: [
      { uri: SAMPLE_PHOTOS.laundrySource, caption: 'Source: failed washer supply line, shut off' },
    ],
    voice:
      'Laundry is the source. Washer supply line let go, it is shut off now. Vinyl plank is ' +
      'floating, drywall wet to about sixteen inches. Washer discharge, so category two.',
    suggest: false,
  },
];

export interface SampleJobResult {
  jobId: string;
  /** False when a real profile already existed and was left alone. */
  createdProfile: boolean;
}

/**
 * Creates the sample job and returns its id. Safe to run more than once — each
 * run is a new job, and an existing company profile or price list is never
 * overwritten.
 */
export async function createSampleJob(
  db: LocalDatabase,
  companyId: string,
  makeId: () => string,
  now: number = Date.now(),
): Promise<SampleJobResult> {
  // The inspection "started" an hour and a half ago, so time-to-estimate reads
  // like a real walk-through rather than zero seconds.
  let clock = now - 95 * MINUTE;
  const tick = (minutes: number) => (clock += minutes * MINUTE);

  let createdProfile = false;
  const company = await getCompany(db, companyId);
  if (!isProfileComplete(company)) {
    await saveCompany(db, {
      id: companyId,
      name: 'Summit Restoration & Drying',
      licenseNo: 'RC-0042817',
      phone: '(614) 555-0142',
      email: 'estimates@summit-restoration.example',
      addressLine1: '2200 Industrial Pkwy, Suite 4',
      city: 'Columbus',
      state: 'OH',
      postalCode: '43215',
      defaultOpPct: 20,
      defaultTaxPct: 7.5,
      defaultTaxBase: 'materials',
    });
    createdProfile = true;
  }

  await seedPriceListIfEmpty(db, companyId, makeId, clock);
  const priceItems = await listPriceItems(db, companyId);

  const jobId = makeId();
  await saveJob(
    db,
    {
      id: jobId,
      companyId,
      peril: 'water',
      claimNo: 'SMP-24-118305',
      policyNo: 'HO3-5520981',
      carrier: 'Sample Mutual (demo carrier)',
      adjusterName: 'Dana Whitfield',
      adjusterEmail: 'dana.whitfield@carrier.example',
      dateOfLoss: new Date(now - 2 * 86_400_000).toISOString().slice(0, 10),
      propertyAddress1: '1418 Maple Avenue',
      propertyCity: 'Columbus',
      propertyState: 'OH',
      propertyPostal: '43214',
      yearBuilt: 2009,
      homeownerName: 'Jordan Ellis',
      homeownerPhone: '(614) 555-0187',
      homeownerEmail: 'jordan.ellis@home.example',
      deductibleCents: 100_000,
      opPct: 20,
      taxPct: 7.5,
      taxBase: 'materials',
    },
    clock,
  );

  let sortOrder = 0;
  for (const spec of ROOMS) {
    const roomId = makeId();
    await saveRoom(
      db,
      {
        id: roomId,
        companyId,
        jobId,
        name: spec.name,
        level: spec.level,
        lengthIn: spec.lengthIn,
        widthIn: spec.widthIn,
        heightIn: spec.heightIn,
        flooringType: spec.flooringType,
        floodCutHeightIn: spec.floodCutHeightIn,
        sortOrder: sortOrder++,
      },
      tick(4),
    );

    for (const opening of spec.openings) {
      await saveOpening(
        db,
        {
          id: makeId(),
          companyId,
          roomId,
          kind: opening.kind,
          widthIn: opening.widthIn,
          heightIn: opening.heightIn,
          count: opening.count ?? 1,
        },
        tick(0.5),
      );
    }

    let firstPhotoId: string | null = null;
    for (const photo of spec.photos) {
      const photoId = makeId();
      firstPhotoId ??= photoId;
      const takenAt = tick(1);
      await capturePhoto(
        db,
        {
          id: photoId,
          companyId,
          jobId,
          roomId,
          localUri: photo.uri,
          localThumbUri: photo.uri,
          takenAt,
          gpsLat: 39.9981,
          gpsLng: -83.0152,
          caption: photo.caption,
        },
        takenAt,
      );
    }

    const noteId = makeId();
    const spokenAt = tick(2);
    await saveVoiceNote(
      db,
      { id: noteId, companyId, jobId, roomId, localUri: '', durationMs: 18_000 + spec.voice.length * 40 },
      spokenAt,
    );
    await setTranscript(db, noteId, spec.voice, spokenAt);

    for (const material of spec.damage.materials) {
      await saveDamage(
        db,
        {
          id: makeId(),
          companyId,
          roomId,
          material,
          photoId: firstPhotoId,
          waterCategory: spec.damage.category,
          waterClass: spec.damage.waterClass,
          affectedHeightIn: material === 'Drywall' ? spec.damage.heightIn : null,
          moisturePct: material === 'Drywall' ? spec.damage.moisturePct : null,
          // Read out of the voice note — how most of a real sheet gets filled.
          source: 'ai_voice',
          aiConfidence: 0.9,
        },
        tick(0.5),
      );
    }

    const quantities = computeRoom({
      lengthIn: spec.lengthIn,
      widthIn: spec.widthIn,
      heightIn: spec.heightIn,
      openings: spec.openings.map((o) => ({ ...o, count: o.count ?? 1 })),
      floodCutHeightIn: spec.floodCutHeightIn,
    });

    const lines = buildScope({
      quantities,
      materials: spec.damage.materials,
      waterCategory: spec.damage.category,
      waterClass: spec.damage.waterClass,
      floodCutHeightIn: spec.floodCutHeightIn,
    });
    const { created } = await applyScopeToRoom(
      db,
      { companyId, jobId, roomId },
      lines,
      priceItems,
      makeId,
      tick(1),
    );

    // Carpet laid when the basement was finished, so it depreciates.
    for (const line of created) {
      if (line.code === 'FCC-CPT') {
        await patchRecord(db, 'line_items', line.id, { age_years: 7 }, clock);
      }
    }

    if (spec.suggest) {
      const suggestion = demoScopeSuggestion(
        {
          roomName: spec.name,
          quantities,
          materials: spec.damage.materials,
          waterCategory: spec.damage.category,
          waterClass: spec.damage.waterClass,
          floodCutHeightIn: spec.floodCutHeightIn,
          alreadyScoped: created.map((line) => line.code),
        },
        priceItems.map((item) => item.code),
      );
      const resolved = resolveScopeSuggestion(suggestion, priceItems, quantities);

      let added = 0;
      for (const line of resolved.lines) {
        await saveLineItem(
          db,
          {
            id: makeId(),
            companyId,
            jobId,
            roomId,
            priceItemId: line.priceItemId,
            code: line.code,
            description: line.description,
            unit: line.unit,
            qty: line.qty,
            wastePct: line.wastePct,
            materialUnitCents: line.materialUnitCents,
            laborUnitCents: line.laborUnitCents,
            usefulLifeYears: line.usefulLifeYears,
            origin: 'ai',
            status: 'suggested',
            aiConfidence: line.confidence,
            note: line.reason,
            sortOrder: 900 + added++,
          },
          tick(0.2),
        );
      }
    }
  }

  // One shot taken on the way through, not yet tagged to a room.
  const hallwayAt = tick(1);
  await capturePhoto(
    db,
    {
      id: makeId(),
      companyId,
      jobId,
      localUri: SAMPLE_PHOTOS.untagged,
      localThumbUri: SAMPLE_PHOTOS.untagged,
      takenAt: hallwayAt,
      gpsLat: 39.9981,
      gpsLng: -83.0152,
    },
    hallwayAt,
  );

  return { jobId, createdProfile };
}
