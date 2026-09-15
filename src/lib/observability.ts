/**
 * Crash reporting.
 *
 * From the plan: "You will not be standing next to the user when it breaks in a
 * crawlspace." For a field app, crash-free sessions is a product metric, not an
 * engineering one.
 *
 * Off unless a DSN is configured, so a dev build and a beta tester's phone do
 * not report into the same place, and so the app runs perfectly well with no
 * observability at all.
 */

import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const ENV = process.env.EXPO_PUBLIC_ENV ?? 'development';

export const isObservabilityEnabled = (): boolean => Boolean(DSN);

export function initObservability(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    // A restoration estimate contains a homeowner's name, address and claim
    // number. None of that belongs in a crash report.
    sendDefaultPii: false,
    // Full traces on a beta of five contractors; turn it down with volume.
    tracesSampleRate: ENV === 'production' ? 0.2 : 1.0,
    beforeSend(event) {
      // Strip anything that could carry claim detail out of a breadcrumb.
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}

/**
 * Reports something that went wrong without stopping the contractor.
 *
 * Used for the failures the app already handles gracefully — a sync entry that
 * gave up, an AI call that kept failing — because those are invisible to the
 * user by design and would otherwise be invisible to you too.
 */
export function reportHandled(error: unknown, context: Record<string, unknown> = {}): void {
  if (!DSN) return;
  Sentry.captureException(error, { extra: context });
}

/** A named thing that happened, for working out what led to a crash. */
export function breadcrumb(message: string, data: Record<string, unknown> = {}): void {
  if (!DSN) return;
  Sentry.addBreadcrumb({ message, data, level: 'info' });
}
