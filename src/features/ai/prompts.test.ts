import { describe, expect, it } from 'vitest';

import { computeRoom } from '../../core/measure';
import { ft } from '../../core/units';
import type { PriceItemRecord } from '../../db/price-items';
import { checkSpend, costCents, DEFAULT_JOB_CEILING_CENTS, formatSpend } from './cost';
import {
  ALLOWED_MATERIALS,
  narrativeInstruction,
  photoInstruction,
  priceListBlock,
  scopeInstruction,
  stablePrefix,
  voiceInstruction,
} from './prompts';

const price = (code: string): PriceItemRecord => ({
  id: `p-${code}`,
  companyId: 'co-1',
  code,
  description: `${code} description`,
  unit: 'SF',
  category: 'Test',
  materialCostCents: 320,
  laborCostCents: 90,
  wastePct: 0,
  usefulLifeYears: null,
  isSeed: false,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

/** The plan's worked example, openings included. */
const quantities = computeRoom({
  lengthIn: ft(12),
  widthIn: ft(14),
  heightIn: ft(8),
  openings: [
    { kind: 'door', widthIn: 36, heightIn: 80 },
    { kind: 'window', widthIn: 48, heightIn: 36 },
  ],
  floodCutHeightIn: ft(2),
});

describe('stablePrefix', () => {
  const prefix = stablePrefix([price('FCC-CPT'), price('BAS-RR')]);

  it('marks the end of the prefix cacheable, so all of it is cached', () => {
    const marked = prefix.filter((block) => block.cache_control);
    expect(marked).toHaveLength(1);
    expect(prefix[prefix.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('carries the rules that keep the model in its lane', () => {
    const text = prefix.map((b) => b.text).join('\n');
    expect(text).toMatch(/never state a quantity/i);
    expect(text).toMatch(/only ever name line item codes that appear in the price list/i);
    expect(text).toMatch(/SUGGESTION/);
  });

  it('lists the materials and the quantity bases', () => {
    const text = prefix.map((b) => b.text).join('\n');
    for (const material of ALLOWED_MATERIALS) {
      expect(text, material).toContain(material);
    }
    expect(text).toContain('floodCutSf');
    expect(text).toContain('baseboardLf');
  });

  it('is byte-identical for the same price list, which is what makes caching work', () => {
    const a = stablePrefix([price('FCC-CPT'), price('BAS-RR')]);
    const b = stablePrefix([price('FCC-CPT'), price('BAS-RR')]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes when the price list changes, which is when it must', () => {
    const a = JSON.stringify(stablePrefix([price('FCC-CPT')]));
    const b = JSON.stringify(stablePrefix([price('FCC-CPT'), price('BAS-RR')]));
    expect(a).not.toBe(b);
  });
});

describe('priceListBlock', () => {
  it('lists every code with its unit', () => {
    const block = priceListBlock([price('FCC-CPT')]);
    expect(block).toContain('FCC-CPT');
    expect(block).toContain('per SF');
  });

  it('says plainly when there is nothing to scope against', () => {
    expect(priceListBlock([])).toMatch(/empty/i);
  });
});

describe('photoInstruction', () => {
  it('names the room when the photo is tagged', () => {
    expect(photoInstruction({ roomName: 'Master Bedroom', knownMaterials: [] })).toContain(
      'Master Bedroom',
    );
  });

  it('says so when the photo is untagged', () => {
    expect(photoInstruction({ roomName: null, knownMaterials: [] })).toMatch(/not tagged/i);
  });

  it('asks the model to add to what the contractor already found, not repeat it', () => {
    const text = photoInstruction({ roomName: 'Kitchen', knownMaterials: ['Carpet', 'Drywall'] });
    expect(text).toContain('Carpet, Drywall');
    expect(text).toMatch(/missed/i);
  });

  it('gives real reference objects for judging a water line', () => {
    const text = photoInstruction({ roomName: null, knownMaterials: [] });
    expect(text).toMatch(/baseboard is about 4 inches/i);
    expect(text).toMatch(/door is 80 inches/i);
    // And tells it not to guess when there is no reference.
    expect(text).toMatch(/return null rather than a guess/i);
  });
});

describe('scopeInstruction', () => {
  const context = {
    roomName: 'Master Bedroom',
    quantities,
    materials: ['Carpet', 'Drywall'],
    waterCategory: 'cat_2',
    waterClass: 'class_2',
    floodCutHeightIn: ft(2),
    alreadyScoped: ['FCC-CPT', 'DRY-FC2'],
  };

  it('hands over the measured quantities so the model picks a basis, not a number', () => {
    const text = scopeInstruction(context);
    expect(text).toContain('floor 168 SF');
    expect(text).toContain('walls 384 SF after openings');
    expect(text).toContain('baseboard 49 LF');
  });

  it('omits a flood cut the room does not have', () => {
    const noCut = computeRoom({ lengthIn: ft(12), widthIn: ft(14), heightIn: ft(8) });
    expect(scopeInstruction({ ...context, quantities: noCut })).not.toContain('flood cut');
  });

  it('tells the model what the template already covered', () => {
    const text = scopeInstruction(context);
    expect(text).toContain('FCC-CPT, DRY-FC2');
    expect(text).toMatch(/do not repeat them/i);
  });

  it('says an empty answer is a good answer', () => {
    expect(scopeInstruction(context)).toMatch(/empty list — that is a good answer/i);
  });

  it('is explicit when nothing was recorded, rather than leaving a blank', () => {
    const text = scopeInstruction({
      ...context,
      materials: [],
      waterCategory: null,
      waterClass: null,
    });
    expect(text).toContain('none recorded');
    expect(text).toContain('category not recorded');
  });
});

describe('voiceInstruction', () => {
  it('includes the transcript and asks for feet to be converted', () => {
    const text = voiceInstruction('North wall is wet four feet up', 'Master Bedroom');
    expect(text).toContain('North wall is wet four feet up');
    expect(text).toMatch(/converted to inches/i);
  });

  it('keeps side notes instead of dropping them', () => {
    expect(voiceInstruction('x', null)).toMatch(/rather than being dropped/i);
  });
});

describe('narrativeInstruction', () => {
  it('forbids inventing a cause the contractor did not record', () => {
    const text = narrativeInstruction({
      propertyAddress: '1812 Water Street',
      peril: 'water',
      dateOfLoss: '2026-09-11',
      rooms: [{ name: 'Master Bedroom', materials: ['Carpet'] }],
      totalCents: 100_000,
    });
    expect(text).toMatch(/do not invent a cause/i);
    expect(text).toContain('1812 Water Street');
    expect(text).toContain('Master Bedroom: Carpet');
  });

  it('handles a room with nothing recorded', () => {
    const text = narrativeInstruction({
      propertyAddress: null,
      peril: 'water',
      dateOfLoss: null,
      rooms: [{ name: 'Garage', materials: [] }],
      totalCents: 0,
    });
    expect(text).toContain('no materials recorded');
    expect(text).toContain('not recorded');
  });
});

describe('costCents', () => {
  it('prices a typical cached call at a few cents', () => {
    // A room suggestion: small volatile tail, price list served from cache.
    const cents = costCents({
      inputTokens: 600,
      outputTokens: 400,
      cacheReadTokens: 4_000,
      cacheCreationTokens: 0,
    });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeLessThan(5);
  });

  it('charges a cache read at a tenth of fresh input', () => {
    const fresh = costCents({ inputTokens: 100_000, outputTokens: 0 });
    const cached = costCents({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 });
    expect(cached * 10).toBe(fresh);
  });

  it('charges writing the cache more than reading it', () => {
    const write = costCents({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 100_000 });
    const read = costCents({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 });
    expect(write).toBeGreaterThan(read);
  });

  it('never reports real usage as free', () => {
    expect(costCents({ inputTokens: 1, outputTokens: 1 })).toBe(1);
  });

  it('is zero for no usage at all', () => {
    expect(costCents({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('keeps a twelve-room house inside the plan estimate', () => {
    // Twelve rooms, one classification and one suggestion each.
    const perCall = costCents({
      inputTokens: 800,
      outputTokens: 500,
      cacheReadTokens: 4_000,
    });
    expect(perCall * 24).toBeLessThan(DEFAULT_JOB_CEILING_CENTS);
  });
});

describe('checkSpend', () => {
  it('allows a job that has spent nothing', () => {
    const decision = checkSpend(0);
    expect(decision.allowed).toBe(true);
  });

  it('reports what is left', () => {
    const decision = checkSpend(120, 500);
    expect(decision).toMatchObject({ allowed: true, remainingCents: 380 });
  });

  it('stops a job at its ceiling and says so in money', () => {
    const decision = checkSpend(500, 500);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('$5.00');
      expect(decision.reason).toMatch(/settings/i);
    }
  });

  it('stops a job that somehow overshot', () => {
    expect(checkSpend(9_999, 500).allowed).toBe(false);
  });

  it('formats spend for the settings screen', () => {
    expect(formatSpend(0)).toBe('$0.00');
    expect(formatSpend(237)).toBe('$2.37');
  });
});
