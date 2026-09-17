/**
 * Opening Stripe, and coming back.
 *
 * The app never sees a card number. It asks the billing Edge Function for a
 * URL, opens that URL in a system browser, and waits for the webhook to say
 * what happened. That is the entire client side of taking money, which is the
 * point: a solo developer should not be storing card details, and an app that
 * does not collect them cannot leak them.
 *
 * `openAuthSessionAsync` rather than `openBrowserAsync` because it is the one
 * that watches for the return URL and closes itself. With the plain browser the
 * contractor is left staring at a Stripe receipt page with no obvious way back
 * into the app, which reliably produces a support email.
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { CompanyRecord } from '../../db/companies';
import type { LocalDatabase } from '../../db/types';
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase';
import { waitForSubscription } from './sync';

export type BillingAction = 'checkout' | 'portal';

export type CheckoutOutcome =
  /** Paid, and the webhook has landed. */
  | { kind: 'subscribed'; company: CompanyRecord }
  /**
   * They came back through the success redirect but the webhook has not
   * arrived. Almost always a slow delivery rather than a failed payment, so the
   * wording must not accuse them of anything.
   */
  | { kind: 'pending' }
  /** They closed the browser or pressed back on Stripe's page. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export class BillingUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingUnavailable';
  }
}

/** Where Stripe should send the browser when it is done. */
export function billingReturnUrl(): string {
  // Resolves to scopeflow://billing in a build, and to the exp:// URL under
  // Expo Go, which is what makes this testable before there is a standalone app.
  return Linking.createURL('billing');
}

/**
 * Asks the Edge Function for a Stripe URL.
 *
 * Exported for the settings screen, which wants the portal without any of the
 * waiting that follows a checkout.
 */
export async function billingUrl(action: BillingAction): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new BillingUnavailable(
      'Subscribing needs a connection. Everything else works without one.',
    );
  }

  const { data, error } = await getSupabase().functions.invoke('billing', {
    body: { action, returnUrl: billingReturnUrl() },
  });

  if (error) {
    const body = (data ?? {}) as { error?: string };
    throw new BillingUnavailable(
      body.error || 'Could not reach the payment provider. Try again in a moment.',
    );
  }

  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new BillingUnavailable('The payment provider did not return a page to open.');
  return url;
}

/**
 * Reads the status the return URL carries.
 *
 * This says only which Stripe button was pressed. It is NOT evidence of
 * payment — anyone can type the success URL — so it decides how long to wait,
 * never what to believe.
 */
export function outcomeFromReturnUrl(url: string): 'success' | 'cancel' {
  try {
    const { queryParams } = Linking.parse(url);
    return queryParams?.status === 'cancel' ? 'cancel' : 'success';
  } catch {
    return 'success';
  }
}

/**
 * The whole subscribe flow: open Stripe, come back, wait for the truth.
 */
export async function startCheckout(
  db: LocalDatabase,
  companyId: string,
): Promise<CheckoutOutcome> {
  let url: string;
  try {
    url = await billingUrl('checkout');
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Could not start checkout.',
    };
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(url, billingReturnUrl());
  } catch {
    return { kind: 'failed', message: 'Could not open the payment page.' };
  }

  // 'cancel' is the browser being closed, 'dismiss' the app closing it. Neither
  // means a failed payment, and neither should say so.
  if (result.type !== 'success') return { kind: 'cancelled' };

  if (outcomeFromReturnUrl(result.url) === 'cancel') return { kind: 'cancelled' };

  const company = await waitForSubscription(db, companyId);
  if (company && (company.subscriptionStatus === 'active' || company.subscriptionStatus === 'trialing')) {
    return { kind: 'subscribed', company };
  }

  return { kind: 'pending' };
}

/**
 * Opens the Stripe Billing Portal — cards, invoices, cancelling.
 *
 * Nothing is waited for afterwards. A change made in the portal arrives by
 * webhook like any other, and the next screen that reads billing state picks it
 * up; blocking here would mean holding a spinner for somebody who went in to
 * download a receipt.
 */
export async function openBillingPortal(): Promise<{ ok: boolean; message?: string }> {
  try {
    const url = await billingUrl('portal');
    await WebBrowser.openAuthSessionAsync(url, billingReturnUrl());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not open billing.',
    };
  }
}
