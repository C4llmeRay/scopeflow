/**
 * The company profile form, with no React in it.
 *
 * This is the letterhead on every estimate, so the validation is about what an
 * adjuster needs in order to take the document seriously and reply to it: a
 * business name, a way to reach you, and terms. The default money percentages
 * live here too, because they are the ones copied onto each new job.
 */

import type { CompanyRecord } from '../../db/companies';
import { DEFAULT_ESTIMATE_TERMS } from '../../db/companies';
import { parsePercentInRange } from '../pricing/forms';

export type CompanyField =
  | 'name'
  | 'email'
  | 'defaultOpPct'
  | 'defaultTaxPct';

export interface CompanyFormValues {
  name: string;
  licenseNo: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  defaultOpPctText: string;
  defaultTaxPctText: string;
  defaultTaxBase: 'materials' | 'all';
  estimateTerms: string;
}

export interface CompanyFormState {
  defaultOpPct: number;
  defaultTaxPct: number;
  errors: Partial<Record<CompanyField, string>>;
  /** Things that will not stop a save but will weaken the document. */
  warnings: string[];
  canSave: boolean;
}

export function emptyCompanyForm(): CompanyFormValues {
  return {
    name: '',
    licenseNo: '',
    phone: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    defaultOpPctText: '20',
    defaultTaxPctText: '0',
    defaultTaxBase: 'materials',
    estimateTerms: DEFAULT_ESTIMATE_TERMS,
  };
}

export function companyFormFrom(company: CompanyRecord): CompanyFormValues {
  return {
    name: company.name,
    licenseNo: company.licenseNo ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
    addressLine1: company.addressLine1 ?? '',
    addressLine2: company.addressLine2 ?? '',
    city: company.city ?? '',
    state: company.state ?? '',
    postalCode: company.postalCode ?? '',
    defaultOpPctText: String(company.defaultOpPct),
    defaultTaxPctText: String(company.defaultTaxPct),
    defaultTaxBase: company.defaultTaxBase,
    estimateTerms: company.estimateTerms ?? '',
  };
}

/**
 * Deliberately loose. The point is to catch a typo like a missing @, not to
 * adjudicate RFC 5322 — rejecting a contractor's real address because a regex
 * disagrees with it is worse than letting a bad one through.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function deriveCompanyForm(values: CompanyFormValues): CompanyFormState {
  const errors: Partial<Record<CompanyField, string>> = {};
  const warnings: string[] = [];

  if (!values.name.trim()) {
    errors.name = 'Your business name goes on every estimate';
  }

  if (values.email.trim() && !looksLikeEmail(values.email)) {
    errors.email = 'That does not look like an email address';
  }

  let defaultOpPct = 0;
  if (values.defaultOpPctText.trim()) {
    const parsed = parsePercentInRange(values.defaultOpPctText);
    if (parsed === null) errors.defaultOpPct = 'Must be 0 to 100';
    else defaultOpPct = parsed;
  }

  let defaultTaxPct = 0;
  if (values.defaultTaxPctText.trim()) {
    const parsed = parsePercentInRange(values.defaultTaxPctText);
    if (parsed === null) errors.defaultTaxPct = 'Must be 0 to 100';
    else defaultTaxPct = parsed;
  }

  // None of these block a save, but each one weakens the document.
  if (!values.phone.trim() && !values.email.trim()) {
    warnings.push('No phone or email — an adjuster has no way to reply to your estimate.');
  }
  if (!values.licenseNo.trim()) {
    warnings.push('No licence number. Most carriers expect one on an estimate.');
  }
  if (!values.addressLine1.trim()) {
    warnings.push('No business address on the letterhead.');
  }
  if (!values.estimateTerms.trim()) {
    warnings.push('No terms. Without them, nothing tells the carrier a supplement may follow.');
  }

  return {
    defaultOpPct,
    defaultTaxPct,
    errors,
    warnings,
    canSave: Object.keys(errors).length === 0,
  };
}

/** True once the profile is good enough to put on a document. */
export function isProfileComplete(company: CompanyRecord | null): boolean {
  if (!company) return false;
  return Boolean(company.name.trim()) && Boolean(company.phone?.trim() || company.email?.trim());
}
