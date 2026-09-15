import { describe, expect, it } from 'vitest';

import { dimensionError, formatFeetInches, parseFeetInches } from './dimension';
import { deriveRoomForm, emptyRoomForm, type RoomFormValues } from './wizard';

describe('parseFeetInches — a bare number is feet', () => {
  it('reads whole feet', () => {
    expect(parseFeetInches('12')).toBe(144);
    expect(parseFeetInches('8')).toBe(96);
  });

  it('reads decimal feet', () => {
    expect(parseFeetInches('12.5')).toBe(150);
    expect(parseFeetInches('11.25')).toBe(135);
  });

  it('rounds to the nearest whole inch', () => {
    expect(parseFeetInches('12.33')).toBe(148);
    expect(parseFeetInches('10.01')).toBe(120);
  });
});

describe('parseFeetInches — feet and inches', () => {
  it('accepts every shape a contractor types', () => {
    for (const input of [`12'6"`, "12'6", '12 6', '12-6', '12ft 6in', "12' 6\"", '12 feet 6 inches']) {
      expect(parseFeetInches(input), input).toBe(150);
    }
  });

  it('is not confused by extra whitespace or case', () => {
    expect(parseFeetInches('  12 FT 6 IN  ')).toBe(150);
    expect(parseFeetInches("12'  6")).toBe(150);
  });

  it('accepts inches alone when they are marked', () => {
    expect(parseFeetInches('6"')).toBe(6);
    expect(parseFeetInches('30in')).toBe(30);
    expect(parseFeetInches('36 inches')).toBe(36);
  });

  it('treats an unmarked bare number as feet, not inches', () => {
    expect(parseFeetInches('6')).toBe(72);
  });
});

describe('parseFeetInches — rejections', () => {
  it('returns null for nothing', () => {
    expect(parseFeetInches('')).toBeNull();
    expect(parseFeetInches('   ')).toBeNull();
  });

  it('returns null for text', () => {
    expect(parseFeetInches('abc')).toBeNull();
    expect(parseFeetInches('twelve')).toBeNull();
    expect(parseFeetInches('12x14')).toBeNull();
  });

  it('returns null for malformed numbers', () => {
    expect(parseFeetInches('12.5.3')).toBeNull();
    expect(parseFeetInches('.')).toBeNull();
    expect(parseFeetInches('-12')).toBeNull();
  });

  it('reads zero as zero rather than rejecting it', () => {
    expect(parseFeetInches('0')).toBe(0);
  });
});

describe('formatFeetInches', () => {
  it('drops the inches when there are none', () => {
    expect(formatFeetInches(144)).toBe(`12'`);
  });

  it('shows both when there are inches', () => {
    expect(formatFeetInches(150)).toBe(`12' 6"`);
  });

  it('shows inches alone under a foot', () => {
    expect(formatFeetInches(6)).toBe(`6"`);
    expect(formatFeetInches(0)).toBe(`0"`);
  });

  it('round-trips through the parser', () => {
    for (const inches of [1, 6, 11, 12, 96, 144, 150, 167, 1_200]) {
      expect(parseFeetInches(formatFeetInches(inches)), String(inches)).toBe(inches);
    }
  });
});

describe('dimensionError', () => {
  it('accepts a sensible measurement', () => {
    expect(dimensionError(144, 'Length')).toBeNull();
  });

  it('rejects unparseable, zero and negative', () => {
    expect(dimensionError(null, 'Length')).toMatch(/not a measurement/);
    expect(dimensionError(0, 'Width')).toMatch(/more than zero/);
    expect(dimensionError(-5, 'Width')).toMatch(/more than zero/);
  });

  it('flags a value that is obviously a typo', () => {
    expect(dimensionError(1_201, 'Length')).toMatch(/typo/);
  });

  it('names the field, so the message is actionable', () => {
    expect(dimensionError(null, 'Height')).toMatch(/^Height/);
  });
});

const form = (over: Partial<RoomFormValues> = {}): RoomFormValues => ({
  ...emptyRoomForm(),
  name: 'Master Bedroom',
  lengthText: '12',
  widthText: '14',
  heightText: '8',
  ...over,
});

describe('deriveRoomForm — the live preview', () => {
  it('derives the plan worked example as the contractor types', () => {
    const state = deriveRoomForm(form({ floodCutText: '2' }));

    expect(state.quantities).toMatchObject({
      floorSf: 168,
      ceilingSf: 168,
      perimeterLf: 52,
      grossWallSf: 416,
      floodCutSf: 104,
      volumeCf: 1344,
    });
    expect(state.canSave).toBe(true);
  });

  it('accounts for openings in the preview', () => {
    const state = deriveRoomForm(
      form({
        openings: [
          { kind: 'door', widthIn: 36, heightIn: 80 },
          { kind: 'window', widthIn: 48, heightIn: 36 },
        ],
      }),
    );
    expect(state.quantities?.netWallSf).toBe(384);
    expect(state.quantities?.baseboardLf).toBe(49);
  });

  it('accounts for offsets in the preview', () => {
    const state = deriveRoomForm(
      form({ offsets: [{ op: 'subtract', depthIn: 24, widthIn: 36 }] }),
    );
    expect(state.quantities?.floorSf).toBe(162); // 168 - 6
    expect(state.quantities?.perimeterLf).toBe(52); // a corner notch leaves it alone
  });

  it('defaults the ceiling to eight feet', () => {
    expect(emptyRoomForm().heightText).toBe('8');
  });
});

describe('deriveRoomForm — validation', () => {
  it('does not open the form covered in red', () => {
    const state = deriveRoomForm(emptyRoomForm());
    expect(state.errors.length).toBeUndefined();
    expect(state.errors.width).toBeUndefined();
    expect(state.errors.name).toBe('Give the room a name');
    expect(state.canSave).toBe(false);
  });

  it('will not save without every dimension', () => {
    expect(deriveRoomForm(form({ widthText: '' })).canSave).toBe(false);
    expect(deriveRoomForm(form({ heightText: '' })).canSave).toBe(false);
  });

  it('will not save without a name', () => {
    const state = deriveRoomForm(form({ name: '   ' }));
    expect(state.errors.name).toBeDefined();
    expect(state.canSave).toBe(false);
  });

  it('complains only about the field that is wrong', () => {
    const state = deriveRoomForm(form({ widthText: 'abc' }));
    expect(state.errors.width).toMatch(/not a measurement/);
    expect(state.errors.length).toBeUndefined();
    expect(state.quantities).toBeNull();
  });

  it('rejects a flood cut taller than the wall', () => {
    const state = deriveRoomForm(form({ heightText: '8', floodCutText: '10' }));
    expect(state.errors.floodCut).toMatch(/taller than the wall/);
    expect(state.canSave).toBe(false);
  });

  it('treats an empty flood cut as no cut, not as an error', () => {
    const state = deriveRoomForm(form({ floodCutText: '' }));
    expect(state.errors.floodCut).toBeUndefined();
    expect(state.floodCutHeightIn).toBe(0);
    expect(state.quantities?.floodCutSf).toBe(0);
    expect(state.canSave).toBe(true);
  });

  it('accepts a flood cut written in inches', () => {
    const state = deriveRoomForm(form({ floodCutText: '24"' }));
    expect(state.floodCutHeightIn).toBe(24);
    expect(state.quantities?.floodCutSf).toBe(104);
  });

  it('survives geometry the field checks cannot catch', () => {
    const state = deriveRoomForm(
      form({ offsets: [{ op: 'subtract', depthIn: 1_000, widthIn: 1_000 }] }),
    );
    expect(state.quantities).toBeNull();
    expect(state.canSave).toBe(false);
  });
});
