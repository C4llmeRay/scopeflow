import { describe, expect, it } from 'vitest';

import { BEDROOM, BEDROOM_EXPECTED } from './fixtures/bedroom-cat2';
import { COMMON_OPENINGS, computeRoom, type Offset } from './measure';
import { ft } from './units';

describe("computeRoom — the plan's worked example", () => {
  it('derives every quantity in section 6 of the build plan', () => {
    expect(computeRoom(BEDROOM)).toEqual(BEDROOM_EXPECTED);
  });
});

describe('computeRoom — base geometry', () => {
  const plain = { lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) };

  it('derives floor, ceiling, perimeter and volume from L x W x H', () => {
    const q = computeRoom(plain);
    expect(q.floorSf).toBe(100);
    expect(q.ceilingSf).toBe(100);
    expect(q.perimeterLf).toBe(40);
    expect(q.volumeCf).toBe(800);
  });

  it('computes gross wall as perimeter x height', () => {
    expect(computeRoom(plain).grossWallSf).toBe(320);
  });

  it('leaves net wall equal to gross wall when there are no openings', () => {
    const q = computeRoom(plain);
    expect(q.netWallSf).toBe(q.grossWallSf);
    expect(q.openingWallDeductionSf).toBe(0);
  });

  it('leaves baseboard equal to perimeter when there are no openings', () => {
    const q = computeRoom(plain);
    expect(q.baseboardLf).toBe(q.perimeterLf);
  });

  it('handles non-square rooms and half-foot dimensions', () => {
    const q = computeRoom({ lengthIn: ft(11, 6), widthIn: ft(13, 3), heightIn: ft(9) });
    // 138 in x 159 in = 21942 sq in = 152.375 SF, rounded to 2dp
    expect(q.floorSf).toBe(152.38);
    expect(q.perimeterLf).toBe(49.5);
  });
});

describe('computeRoom — openings', () => {
  const base = { lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) };

  it('deducts a door from both wall area and baseboard', () => {
    const q = computeRoom({ ...base, openings: [{ kind: 'door', widthIn: 36, heightIn: 80 }] });
    expect(q.openingWallDeductionSf).toBe(20); // 36 x 80 = 2880 sq in
    expect(q.netWallSf).toBe(300);
    expect(q.baseboardLf).toBe(37); // 480 in - 36 in = 444 in
  });

  it('deducts a window from wall area but NOT from baseboard', () => {
    const q = computeRoom({ ...base, openings: [{ kind: 'window', widthIn: 48, heightIn: 36 }] });
    expect(q.openingWallDeductionSf).toBe(12);
    expect(q.netWallSf).toBe(308);
    expect(q.baseboardLf).toBe(40); // baseboard runs under a window
  });

  it('breaks the baseboard run at an archway and a missing wall', () => {
    const q = computeRoom({
      ...base,
      openings: [
        { kind: 'archway', widthIn: 48, heightIn: 84 },
        { kind: 'missing_wall', widthIn: 60, heightIn: 96 },
      ],
    });
    expect(q.baseboardLf).toBe(31); // 480 - 48 - 60 = 372 in
  });

  it('multiplies by count', () => {
    const one = computeRoom({ ...base, openings: [COMMON_OPENINGS.standardWindow] });
    const three = computeRoom({
      ...base,
      openings: [{ ...COMMON_OPENINGS.standardWindow, count: 3 }],
    });
    expect(three.openingWallDeductionSf).toBe(one.openingWallDeductionSf * 3);
  });

  it('honours explicit deductsWall / deductsBase overrides', () => {
    const q = computeRoom({
      ...base,
      openings: [{ kind: 'window', widthIn: 48, heightIn: 36, deductsBase: true }],
    });
    expect(q.baseboardLf).toBe(36); // 480 - 48 = 432 in — floor-to-ceiling window
  });

  it('never returns a negative net wall or baseboard', () => {
    const q = computeRoom({
      ...base,
      openings: [{ kind: 'missing_wall', widthIn: 600, heightIn: 200 }],
    });
    expect(q.netWallSf).toBe(0);
    expect(q.baseboardLf).toBe(0);
  });
});

describe('computeRoom — offsets (L-shaped rooms)', () => {
  const base = { lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) };

  it('adds area and two returns for a bump-out', () => {
    const bump: Offset = { name: 'Closet', op: 'add', depthIn: ft(2), widthIn: ft(5) };
    const q = computeRoom({ ...base, offsets: [bump] });
    expect(q.floorSf).toBe(110); // 100 + (2 x 5)
    expect(q.perimeterLf).toBe(44); // 40 + 2 x 2
    expect(q.grossWallSf).toBe(352); // 44 x 8
  });

  it('removes area but leaves perimeter unchanged for a corner notch', () => {
    const chase: Offset = { name: 'Chimney chase', op: 'subtract', depthIn: ft(2), widthIn: ft(3) };
    const q = computeRoom({ ...base, offsets: [chase] });
    expect(q.floorSf).toBe(94); // 100 - 6
    expect(q.perimeterLf).toBe(40); // the removed runs reappear as the inside corner
  });

  it('adds two returns for a notch bitten out mid-wall', () => {
    const alcove: Offset = {
      op: 'subtract',
      depthIn: ft(2),
      widthIn: ft(3),
      placement: 'mid_wall',
    };
    const q = computeRoom({ ...base, offsets: [alcove] });
    expect(q.floorSf).toBe(94);
    expect(q.perimeterLf).toBe(44);
  });

  it('accumulates several offsets', () => {
    const q = computeRoom({
      ...base,
      offsets: [
        { op: 'add', depthIn: ft(2), widthIn: ft(5) },
        { op: 'subtract', depthIn: ft(1), widthIn: ft(4) },
      ],
    });
    expect(q.floorSf).toBe(106); // 100 + 10 - 4
    expect(q.perimeterLf).toBe(44); // add contributes +4 ft, corner subtract contributes 0
  });

  it('includes offset area in the ceiling and the volume', () => {
    const q = computeRoom({ ...base, offsets: [{ op: 'add', depthIn: ft(2), widthIn: ft(5) }] });
    expect(q.ceilingSf).toBe(110);
    expect(q.volumeCf).toBe(880); // 110 SF x 8 ft
  });

  it('throws when offsets remove the whole room', () => {
    expect(() =>
      computeRoom({ ...base, offsets: [{ op: 'subtract', depthIn: ft(10), widthIn: ft(10) }] }),
    ).toThrow(/removed the entire floor area/i);
  });
});

describe('computeRoom — flood cut', () => {
  const base = {
    lengthIn: ft(10),
    widthIn: ft(10),
    heightIn: ft(8),
    openings: [{ kind: 'door' as const, widthIn: 36, heightIn: 80 }],
  };

  it('is zero when no cut height is given', () => {
    expect(computeRoom(base).floodCutSf).toBe(0);
  });

  it('runs the full perimeter by default', () => {
    const q = computeRoom({ ...base, floodCutHeightIn: ft(2) });
    expect(q.floodCutSf).toBe(80); // 40 LF x 2 ft
  });

  it('stops at door openings when the contractor scopes it net', () => {
    const q = computeRoom({ ...base, floodCutHeightIn: ft(2), floodCutDeductsOpenings: true });
    expect(q.floodCutSf).toBe(74); // 37 LF x 2 ft
  });

  it('scales with cut height', () => {
    const q = computeRoom({ ...base, floodCutHeightIn: ft(4) });
    expect(q.floodCutSf).toBe(160);
  });
});

describe('computeRoom — ceilings', () => {
  const base = { lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) };

  it('matches the floor for a flat ceiling', () => {
    expect(computeRoom(base).ceilingSf).toBe(100);
  });

  it('applies a multiplier for a vaulted ceiling', () => {
    expect(computeRoom({ ...base, ceilingMultiplier: 1.25 }).ceilingSf).toBe(125);
  });

  it('rejects a non-positive multiplier', () => {
    expect(() => computeRoom({ ...base, ceilingMultiplier: 0 })).toThrow(/ceilingMultiplier/);
  });
});

describe('computeRoom — validation', () => {
  const base = { lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) };

  it('rejects fractional inches, because dimensions are integers', () => {
    expect(() => computeRoom({ ...base, lengthIn: 120.5 })).toThrow(/integer inches/i);
  });

  it('rejects zero and negative dimensions', () => {
    expect(() => computeRoom({ ...base, widthIn: 0 })).toThrow(/positive whole number/i);
    expect(() => computeRoom({ ...base, heightIn: -96 })).toThrow(/positive whole number/i);
  });

  it('rejects a fractional opening count', () => {
    expect(() =>
      computeRoom({ ...base, openings: [{ kind: 'door', widthIn: 36, heightIn: 80, count: 1.5 }] }),
    ).toThrow(/count/i);
  });

  it('rejects a negative flood cut height', () => {
    expect(() => computeRoom({ ...base, floodCutHeightIn: -24 })).toThrow(/floodCutHeightIn/);
  });
});
