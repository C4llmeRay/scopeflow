import { describe, expect, it } from 'vitest';

import type { CompanyRecord } from '../../db/companies';
import {
  groupPhotosByRoom,
  photoLocation,
  photoStamp,
  renderPhotoReport,
  type PhotoReportInput,
  type ReportPhoto,
} from './photo-report';

const company: CompanyRecord = {
  id: 'co-1',
  name: 'Harbor Restoration LLC',
  licenseNo: 'TX-RC-118244',
  logoUrl: null,
  phone: '(512) 555-0142',
  email: 'office@harborrestoration.test',
  addressLine1: '4400 Shoal Creek Blvd',
  addressLine2: null,
  city: 'Austin',
  state: 'TX',
  postalCode: '78756',
  defaultOpPct: 20,
  defaultTaxPct: 8.25,
  defaultTaxBase: 'materials',
  aiJobCeilingCents: 500,
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  estimateTerms: null,
  createdAt: 0,
  updatedAt: 0,
};

const photo = (over: Partial<ReportPhoto> = {}): ReportPhoto => ({
  id: 'p1',
  roomId: 'room-1',
  src: 'data:image/jpeg;base64,AAAA',
  caption: 'Water line on the north wall',
  takenAt: 1_700_000_000_000,
  gpsLat: 30.2672,
  gpsLng: -97.7431,
  ...over,
});

const report = (over: Partial<PhotoReportInput> = {}): PhotoReportInput => ({
  company,
  job: {
    claimNo: 'CLM-2026-884120',
    carrier: 'Lone Star Mutual',
    dateOfLoss: '2026-09-11',
    propertyAddress1: '1812 Water Street',
    homeownerName: 'Marcus Oyelaran',
  },
  rooms: [
    { id: 'room-1', name: 'Master Bedroom' },
    { id: 'room-2', name: 'Hall Bathroom' },
  ],
  photos: [photo()],
  preparedAt: 1_700_000_000_000,
  ...over,
});

describe('photoStamp', () => {
  it('shows the date and time a photo was actually taken', () => {
    expect(photoStamp(photo())).toMatch(/Nov/);
    expect(photoStamp(photo())).toMatch(/\d{1,2}:\d{2}/);
  });

  it('says nothing when the capture time is missing', () => {
    expect(photoStamp(photo({ takenAt: null }))).toBe('');
    expect(photoStamp(photo({ takenAt: Number.NaN }))).toBe('');
  });
});

describe('photoLocation', () => {
  it('places the photo to about ten metres', () => {
    expect(photoLocation(photo())).toBe('30.2672, -97.7431');
  });

  it('says nothing without a fix', () => {
    expect(photoLocation(photo({ gpsLat: null }))).toBe('');
    expect(photoLocation(photo({ gpsLng: null }))).toBe('');
  });
});

describe('groupPhotosByRoom', () => {
  it('reads in the order the walk happened', () => {
    const groups = groupPhotosByRoom(
      report({
        // Deliberately out of order, with the timestamps giving a, b, c.
        photos: [
          photo({ id: 'c', takenAt: 3_000 }),
          photo({ id: 'a', takenAt: 1_000 }),
          photo({ id: 'b', takenAt: 2_000 }),
        ],
      }),
    );
    expect(groups[0].photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a room nobody photographed', () => {
    expect(groupPhotosByRoom(report()).map((g) => g.name)).toEqual(['Master Bedroom']);
  });

  it('keeps untagged photos in their own group at the end', () => {
    const groups = groupPhotosByRoom(
      report({ photos: [photo(), photo({ id: 'p2', roomId: null })] }),
    );
    expect(groups.map((g) => g.name)).toEqual(['Master Bedroom', 'Not tagged to a room']);
  });

  it('keeps a photo whose room is gone rather than losing it', () => {
    const groups = groupPhotosByRoom(report({ photos: [photo({ roomId: 'deleted' })] }));
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Not tagged to a room');
  });
});

describe('renderPhotoReport', () => {
  it('produces a complete standalone document', () => {
    const html = renderPhotoReport(report());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script/);
  });

  it('carries the claim facts and the photo count', () => {
    const html = renderPhotoReport(report({ photos: [photo(), photo({ id: 'p2' })] }));
    expect(html).toContain('CLM-2026-884120');
    expect(html).toContain('Photographs');
    expect(html).toContain('2 photographs');
  });

  it('embeds whatever source the caller supplied', () => {
    expect(renderPhotoReport(report())).toContain('data:image/jpeg;base64,AAAA');
    const hosted = renderPhotoReport(
      report({ photos: [photo({ src: 'https://example.test/a.jpg' })] }),
    );
    expect(hosted).toContain('https://example.test/a.jpg');
  });

  it('renders a placeholder rather than a broken image when there is no source', () => {
    const html = renderPhotoReport(report({ photos: [photo({ src: null })] }));
    expect(html).toContain('img-missing');
    expect(html).not.toContain('<img src="null"');
  });

  it('stamps each photo with its capture time', () => {
    expect(renderPhotoReport(report())).toContain('class="stamp"');
  });

  it('mentions location only when photos actually carry one', () => {
    expect(renderPhotoReport(report())).toContain('capture time and location');
    const noGps = renderPhotoReport(report({ photos: [photo({ gpsLat: null, gpsLng: null })] }));
    expect(noGps).toContain('capture time.');
    expect(noGps).not.toContain('and location');
  });

  it('handles a job with no photographs', () => {
    const html = renderPhotoReport(report({ photos: [] }));
    expect(html).toContain('No photographs on this job.');
  });

  it('escapes a caption, a room name and an image source', () => {
    const html = renderPhotoReport(
      report({
        rooms: [{ id: 'room-1', name: '<script>a</script>' }],
        photos: [photo({ caption: '"><script>b</script>', src: '"><script>c</script>' })],
      }),
    );
    expect(html).not.toContain('<script>a</script>');
    expect(html).not.toContain('<script>b</script>');
    expect(html).not.toContain('<script>c</script>');
  });
});
