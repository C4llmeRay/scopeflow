import { describe, expect, it } from 'vitest';

import {
  appendStarter,
  buildExportManifest,
  composeTitle,
  isLabelled,
  labelProgress,
  manifestCsv,
  manifestText,
  safeFileStem,
  type LabelledPhoto,
} from './labels';

const photo = (over: Partial<LabelledPhoto> & { id: string }): LabelledPhoto => ({
  roomId: null,
  title: null,
  caption: null,
  takenAt: 0,
  ...over,
});

describe('composeTitle', () => {
  it('joins the room and what the photo shows', () => {
    expect(composeTitle('Kitchen', 'Water line')).toBe('Kitchen - Water line');
  });

  it('uses whichever half there is', () => {
    expect(composeTitle(null, 'Front of risk')).toBe('Front of risk');
    expect(composeTitle('Kitchen', null)).toBe('Kitchen');
    expect(composeTitle('  ', '')).toBeNull();
  });
});

describe('appendStarter', () => {
  it('starts an empty description', () => {
    expect(appendStarter('', 'Wet drywall.')).toBe('Wet drywall.');
  });

  it('adds a new sentence, closing the last one if it was left open', () => {
    expect(appendStarter('Wet drywall.', 'Baseboard detached.')).toBe(
      'Wet drywall. Baseboard detached.',
    );
    expect(appendStarter('Wet drywall', 'Baseboard detached.')).toBe(
      'Wet drywall. Baseboard detached.',
    );
  });
});

describe('labelling progress', () => {
  it('needs both a name and a description', () => {
    expect(isLabelled({ title: 'Kitchen', caption: 'Wet.' })).toBe(true);
    expect(isLabelled({ title: 'Kitchen', caption: ' ' })).toBe(false);
    expect(isLabelled({ title: null, caption: 'Wet.' })).toBe(false);
  });

  it('counts what is left', () => {
    expect(
      labelProgress([
        { title: 'A', caption: 'x' },
        { title: 'B', caption: null },
      ]),
    ).toEqual({ labelled: 1, total: 2, remaining: 1 });
  });
});

describe('safeFileStem', () => {
  it('removes what Windows refuses in a file name', () => {
    expect(safeFileStem('Kitchen: sink / cabinet? "wet"')).toBe('Kitchen sink cabinet wet');
  });

  it('never ends in a dot or space, and never comes back empty', () => {
    expect(safeFileStem('Hall...  ')).toBe('Hall');
    expect(safeFileStem('***')).toBe('Photo');
  });

  it('keeps names short enough for Explorer', () => {
    expect(safeFileStem('x'.repeat(200))).toHaveLength(80);
  });
});

describe('buildExportManifest', () => {
  const rooms = [
    { id: 'k', name: 'Kitchen', sortOrder: 1 },
    { id: 'b', name: 'Bedroom', sortOrder: 0 },
  ];

  it('puts general photos first, then rooms in order, then by time taken', () => {
    const entries = buildExportManifest(rooms, [
      photo({ id: '1', roomId: 'k', takenAt: 5, title: 'Kitchen - Overview', caption: 'Wide.' }),
      photo({ id: '2', roomId: 'b', takenAt: 9, title: 'Bedroom - Drywall' }),
      photo({ id: '3', roomId: null, takenAt: 20, title: 'Front of risk' }),
      photo({ id: '4', roomId: 'b', takenAt: 1, title: 'Bedroom - Overview' }),
    ]);

    expect(entries.map((e) => e.fileName)).toEqual([
      '001 Front of risk.jpg',
      '002 Bedroom - Overview.jpg',
      '003 Bedroom - Drywall.jpg',
      '004 Kitchen - Overview.jpg',
    ]);
    expect(entries[3]).toMatchObject({ roomName: 'Kitchen', description: 'Wide.' });
  });

  it('falls back to the room name, then to a number, when a photo has no name', () => {
    const entries = buildExportManifest(rooms, [
      photo({ id: '1', roomId: 'k', takenAt: 1 }),
      photo({ id: '2', roomId: null, takenAt: 0 }),
    ]);
    expect(entries.map((e) => e.title)).toEqual(['Photo 1', 'Kitchen']);
  });

  it('keeps duplicate names apart by their number', () => {
    const entries = buildExportManifest(rooms, [
      photo({ id: '1', roomId: 'k', takenAt: 1, title: 'Kitchen - Drywall' }),
      photo({ id: '2', roomId: 'k', takenAt: 2, title: 'Kitchen - Drywall' }),
    ]);
    expect(new Set(entries.map((e) => e.fileName)).size).toBe(2);
  });
});

describe('the photo list files', () => {
  const entries = buildExportManifest(
    [{ id: 'k', name: 'Kitchen', sortOrder: 0 }],
    [photo({ id: '1', roomId: 'k', title: 'Kitchen - Sink', caption: 'Leak at the "P" trap, wet cabinet' })],
  );

  it('quotes CSV cells that need it and opens cleanly in Excel', () => {
    const csv = manifestCsv(entries);
    expect(csv.startsWith('﻿No,File,Room,Title,Description\r\n')).toBe(true);
    expect(csv).toContain('"Leak at the ""P"" trap, wet cabinet"');
  });

  it('lists each photo for copying into Xactimate', () => {
    const text = manifestText('1418 Maple Avenue', entries);
    expect(text).toContain('1. 001 Kitchen - Sink.jpg');
    expect(text).toContain('Title: Kitchen - Sink');
    expect(text).toContain('Description: Leak at the "P" trap');
  });
});
