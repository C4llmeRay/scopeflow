/**
 * The contractor's own business details.
 *
 * Exists mostly so an estimate can carry a letterhead and terms. An estimate
 * without a licence number and a way to reach the contractor reads as unserious
 * to an adjuster, which is a bad way to lose an argument about a real scope.
 */

import type { BillingState, SubscriptionStatus } from '../features/billing/entitlement';
import { upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export interface CompanyRecord {
  id: string;
  name: string;
  licenseNo: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  defaultOpPct: number;
  defaultTaxPct: number;
  defaultTaxBase: 'materials' | 'all';
  estimateTerms: string | null;
  /** Per-job AI budget, in cents. */
  aiJobCeilingCents: number;
  /** Set by Stripe, synced down, never written by the app. */
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
  /** True once Stripe knows this period is the last one. */
  cancelAtPeriodEnd: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCompanyInput {
  id: string;
  name: string;
  licenseNo?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  defaultOpPct?: number;
  defaultTaxPct?: number;
  defaultTaxBase?: 'materials' | 'all';
  estimateTerms?: string | null;
  aiJobCeilingCents?: number;
}

interface CompanyRow {
  id: string;
  name: string;
  license_no: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  default_op_pct: number;
  default_tax_pct: number;
  default_tax_base: string;
  estimate_terms: string | null;
  ai_job_ceiling_cents: number;
  subscription_status: string;
  trial_ends_at: number | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  created_at: number;
  updated_at: number;
}

function toRecord(row: CompanyRow): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    licenseNo: row.license_no,
    logoUrl: row.logo_url,
    phone: row.phone,
    email: row.email,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    defaultOpPct: row.default_op_pct,
    defaultTaxPct: row.default_tax_pct,
    defaultTaxBase: row.default_tax_base as 'materials' | 'all',
    estimateTerms: row.estimate_terms,
    aiJobCeilingCents: row.ai_job_ceiling_cents,
    subscriptionStatus: row.subscription_status as SubscriptionStatus,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The default terms, which a contractor can replace in settings. */
export const DEFAULT_ESTIMATE_TERMS =
  'This estimate covers the damage visible and accessible at the time of ' +
  'inspection. Concealed damage found during demolition may require a ' +
  'supplement. Prices are valid for 30 days. Work begins on written ' +
  'authorisation.';

export async function saveCompany(
  db: LocalDatabase,
  input: SaveCompanyInput,
  now: number = Date.now(),
): Promise<CompanyRecord> {
  await upsertRecord(
    db,
    {
      entity: 'companies',
      id: input.id,
      // A company row is its own tenant, so company_id is its own id.
      companyId: input.id,
      columns: {
        name: input.name,
        license_no: input.licenseNo ?? null,
        logo_url: input.logoUrl ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address_line1: input.addressLine1 ?? null,
        address_line2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postalCode ?? null,
        default_op_pct: input.defaultOpPct ?? 20,
        default_tax_pct: input.defaultTaxPct ?? 0,
        default_tax_base: input.defaultTaxBase ?? 'materials',
        estimate_terms: input.estimateTerms ?? DEFAULT_ESTIMATE_TERMS,
        ai_job_ceiling_cents: input.aiJobCeilingCents ?? 500,
      },
      // The server's companies table has no company_id column — it IS the
      // company — so the denormalised copy stays on the phone.
      //
      // Billing columns are deliberately absent from this write. They are
      // Stripe's to set, the server refuses a client that tries, and an upsert
      // that carried them would be rejected outright.
      localOnly: [],
    },
    now,
  );

  const company = await getCompany(db, input.id);
  if (!company) throw new Error(`company ${input.id} vanished immediately after being saved`);
  return company;
}

export async function getCompany(
  db: LocalDatabase,
  id: string,
): Promise<CompanyRecord | null> {
  const [row] = await db.adapter.all<CompanyRow>(`select * from companies where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

/** The billing facts the entitlement rules read. */
export function billingState(company: CompanyRecord): BillingState {
  return {
    status: company.subscriptionStatus,
    trialEndsAt: company.trialEndsAt,
    currentPeriodEnd: company.currentPeriodEnd,
    cancelAtPeriodEnd: company.cancelAtPeriodEnd,
  };
}

/** A one-line postal address for the letterhead. */
export function companyAddress(company: CompanyRecord): string {
  const street = [company.addressLine1, company.addressLine2].filter(Boolean).join(', ');
  const region = [company.city, company.state].filter(Boolean).join(', ');
  return [street, region, company.postalCode].filter(Boolean).join(' · ');
}
