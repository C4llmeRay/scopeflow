import { describe, expect, it } from 'vitest';

import type { CompanyRecord } from '../../db/companies';
import {
  companyFormFrom,
  deriveCompanyForm,
  emptyCompanyForm,
  isProfileComplete,
  type CompanyFormValues,
} from './company-form';

const form = (over: Partial<CompanyFormValues> = {}): CompanyFormValues => ({
  ...emptyCompanyForm(),
  name: 'Harbor Restoration LLC',
  licenseNo: 'TX-RC-118244',
  phone: '(512) 555-0142',
  email: 'office@harborrestoration.test',
  addressLine1: '4400 Shoal Creek Blvd',
  city: 'Austin',
  state: 'TX',
  postalCode: '78756',
  ...over,
});

const company = (over: Partial<CompanyRecord> = {}): CompanyRecord => ({
  id: 'co-1',
  name: 'Harbor Restoration LLC',
  licenseNo: 'TX-RC-118244',
  logoUrl: null,
  phone: '(512) 555-0142',
  email: null,
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
  estimateTerms: 'Prices valid for 30 days.',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('deriveCompanyForm', () => {
  it('accepts a complete profile with no complaints', () => {
    const state = deriveCompanyForm(form());
    expect(state.canSave).toBe(true);
    expect(state.errors).toEqual({});
    expect(state.warnings).toEqual([]);
  });

  it('requires a business name, because it is the letterhead', () => {
    const state = deriveCompanyForm(form({ name: '  ' }));
    expect(state.errors.name).toMatch(/business name/);
    expect(state.canSave).toBe(false);
  });

  it('catches an email typo without adjudicating the whole RFC', () => {
    expect(deriveCompanyForm(form({ email: 'office.harbor.test' })).errors.email).toBeDefined();
    expect(deriveCompanyForm(form({ email: 'a@b.co' })).errors.email).toBeUndefined();
    // A plus address and a subdomain are both real and must pass.
    expect(deriveCompanyForm(form({ email: 'jobs+claims@mail.harbor.test' })).errors.email)
      .toBeUndefined();
  });

  it('treats a blank email as absent rather than wrong', () => {
    const state = deriveCompanyForm(form({ email: '' }));
    expect(state.errors.email).toBeUndefined();
    expect(state.canSave).toBe(true);
  });

  it('parses the default money percentages', () => {
    const state = deriveCompanyForm(
      form({ defaultOpPctText: '20', defaultTaxPctText: '8.25' }),
    );
    expect(state.defaultOpPct).toBe(20);
    expect(state.defaultTaxPct).toBe(8.25);
  });

  it('rejects a percentage outside 0 to 100', () => {
    expect(deriveCompanyForm(form({ defaultOpPctText: '250' })).errors.defaultOpPct).toBeDefined();
    expect(deriveCompanyForm(form({ defaultTaxPctText: 'lots' })).errors.defaultTaxPct).toBeDefined();
  });

  it('treats a blank percentage as zero', () => {
    const state = deriveCompanyForm(form({ defaultOpPctText: '', defaultTaxPctText: '' }));
    expect(state.defaultOpPct).toBe(0);
    expect(state.defaultTaxPct).toBe(0);
    expect(state.canSave).toBe(true);
  });
});

describe('deriveCompanyForm — warnings', () => {
  it('warns when an adjuster would have no way to reply', () => {
    const state = deriveCompanyForm(form({ phone: '', email: '' }));
    expect(state.warnings.some((w) => /no way to reply/i.test(w))).toBe(true);
    // A warning never blocks the save.
    expect(state.canSave).toBe(true);
  });

  it('is satisfied by either a phone or an email', () => {
    expect(deriveCompanyForm(form({ phone: '', email: 'a@b.co' })).warnings).toEqual([]);
    expect(deriveCompanyForm(form({ phone: '(512) 555-0142', email: '' })).warnings).toEqual([]);
  });

  it('warns about a missing licence, address and terms', () => {
    const state = deriveCompanyForm(
      form({ licenseNo: '', addressLine1: '', estimateTerms: '' }),
    );
    expect(state.warnings).toHaveLength(3);
    expect(state.warnings.some((w) => /license/i.test(w))).toBe(true);
    expect(state.warnings.some((w) => /address/i.test(w))).toBe(true);
    expect(state.warnings.some((w) => /supplement/i.test(w))).toBe(true);
  });

  it('ships with terms already filled in, so the common case is warning-free', () => {
    expect(emptyCompanyForm().estimateTerms.length).toBeGreaterThan(0);
  });
});

describe('companyFormFrom', () => {
  it('round-trips a stored company back into the form', () => {
    const values = companyFormFrom(company());
    expect(values).toMatchObject({
      name: 'Harbor Restoration LLC',
      licenseNo: 'TX-RC-118244',
      defaultOpPctText: '20',
      defaultTaxPctText: '8.25',
      defaultTaxBase: 'materials',
    });
    expect(deriveCompanyForm(values).canSave).toBe(true);
  });

  it('turns absent fields into empty strings a TextInput can hold', () => {
    const values = companyFormFrom(company({ licenseNo: null, email: null, estimateTerms: null }));
    expect(values.licenseNo).toBe('');
    expect(values.email).toBe('');
    expect(values.estimateTerms).toBe('');
  });
});

describe('isProfileComplete', () => {
  it('needs a name and at least one way to reach the contractor', () => {
    expect(isProfileComplete(company())).toBe(true);
    expect(isProfileComplete(company({ phone: null, email: 'a@b.co' }))).toBe(true);
  });

  it('is false without a name or without any contact', () => {
    expect(isProfileComplete(company({ name: '   ' }))).toBe(false);
    expect(isProfileComplete(company({ phone: null, email: null }))).toBe(false);
  });

  it('is false when there is no company at all', () => {
    expect(isProfileComplete(null)).toBe(false);
  });
});
