import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { ExportJob, ExportPhoto } from './source';
import { buildXactimateZip } from './zip';

const bytes = (text: string) => new TextEncoder().encode(text);

const photo = (over: Partial<ExportPhoto> & { id: string }): ExportPhoto => ({
  roomId: null,
  title: null,
  caption: null,
  takenAt: 0,
  previewUri: null,
  load: async () => bytes(`jpeg-${over.id}`),
  ...over,
});

const job: ExportJob = {
  id: 'j1',
  title: '1418 Maple Avenue',
  rooms: [{ id: 'k', name: 'Kitchen', sortOrder: 0 }],
  photos: [
    photo({ id: 'a', roomId: 'k', takenAt: 2, title: 'Kitchen - Water line', caption: 'Line at 14 in.' }),
    photo({ id: 'b', takenAt: 1, title: 'Front of risk', caption: 'Front elevation.' }),
    photo({ id: 'c', roomId: 'k', takenAt: 3, title: 'Kitchen - Cabinets', load: null }),
  ],
};

describe('buildXactimateZip', () => {
  it('puts numbered, named photos and the photo list in a folder named after the job', async () => {
    const result = await buildXactimateZip(job);
    const files = unzipSync(result.zip);

    expect(result.fileName).toBe('1418 Maple Avenue - photos.zip');
    expect(Object.keys(files).sort()).toEqual([
      '1418 Maple Avenue/001 Front of risk.jpg',
      '1418 Maple Avenue/002 Kitchen - Water line.jpg',
      '1418 Maple Avenue/Photo list.csv',
      '1418 Maple Avenue/Photo list.txt',
    ]);
    expect(strFromU8(files['1418 Maple Avenue/002 Kitchen - Water line.jpg'])).toBe('jpeg-a');
    expect(strFromU8(files['1418 Maple Avenue/Photo list.txt'])).toContain('Description: Line at 14 in.');
  });

  it('reports a photo it could not reach instead of failing the export', async () => {
    const result = await buildXactimateZip(job);
    expect(result.missing.map((m) => m.photoId)).toEqual(['c']);
    // The list only names what is actually in the folder.
    const csv = strFromU8(unzipSync(result.zip)['1418 Maple Avenue/Photo list.csv']);
    expect(csv).not.toContain('Cabinets');
  });

  it('survives a download that fails', async () => {
    const broken: ExportJob = {
      ...job,
      photos: [photo({ id: 'x', load: async () => Promise.reject(new Error('offline')) })],
    };
    const progress: number[] = [];
    const result = await buildXactimateZip(broken, (done) => progress.push(done));
    expect(result.missing).toHaveLength(1);
    expect(progress).toEqual([1]);
  });
});
