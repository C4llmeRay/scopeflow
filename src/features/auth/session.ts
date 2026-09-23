/**
 * Sign-in logic, with no React and no network in it.
 *
 * The flow is a six-digit code rather than a tappable link. That is a deliberate
 * departure from the plan's "magic link", and it is the better mobile flow: a
 * link has to survive being opened in whichever browser the mail app chooses,
 * come back through a custom URL scheme, and land in the right app instance. A
 * code the contractor reads and types works from any device, on any mail
 * client, with no deep-link handling at all — including when the email arrives
 * on their laptop and the app is on their phone.
 *
 * Supabase sends both in the same email. The template needs `{{ .Token }}` in
 * it, which is a one-line change in the dashboard.
 */

export const OTP_LENGTH = 6;

/**
 * Deliberately loose, same as the company profile: catch a missing @, do not
 * adjudicate RFC 5322. Rejecting somebody's real address at the front door is
 * a worse failure than letting a typo through and showing "no code arrived".
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** People paste "123 456" and "123-456". Keep the digits. */
export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export const isCompleteOtp = (value: string): boolean =>
  normalizeOtp(value).length === OTP_LENGTH;

export type AuthStep = 'email' | 'code';

export interface AuthFormState {
  email: string;
  code: string;
  step: AuthStep;
}

export interface AuthFormChecks {
  canSendCode: boolean;
  canVerify: boolean;
  emailError: string | null;
}

export function checkAuthForm(state: AuthFormState): AuthFormChecks {
  const email = normalizeEmail(state.email);
  const emailError =
    email === '' || isPlausibleEmail(email) ? null : 'That does not look like an email address';

  return {
    canSendCode: isPlausibleEmail(email),
    canVerify: isPlausibleEmail(email) && isCompleteOtp(state.code),
    emailError,
  };
}

/**
 * Turns an auth failure into something a contractor can act on.
 *
 * Supabase's own messages are written for developers. "Token has expired or is
 * invalid" tells somebody standing in a driveway nothing about what to do.
 */
/**
 * Password sign-in, for accounts created in the Supabase dashboard. It needs no
 * email at all, which is what a demo on a free project needs: Supabase's
 * built-in mailer only reaches the project's own team, a few times an hour.
 */
export function canSignInWithPassword(email: string, password: string): boolean {
  return isPlausibleEmail(normalizeEmail(email)) && password.length > 0;
}

export function describePasswordError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (message.includes('email not confirmed')) {
    return 'This account is not confirmed yet. In Supabase, open the user and confirm it, or create it again with "Auto Confirm User" ticked.';
  }
  return describeAuthError(error);
}

export function describeAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();

  if (message.includes('expired') || message.includes('invalid')) {
    return 'That code did not work. It may have expired — send a new one.';
  }
  if (message.includes('rate') || message.includes('too many') || message.includes('429')) {
    return 'Too many tries. Wait a minute before asking for another code.';
  }
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connection')
  ) {
    return 'No connection. Signing in is the one thing that needs signal — everything else works without it.';
  }
  if (message.includes('not configured') || message.includes('missing')) {
    return 'This app is not connected to a backend yet.';
  }
  return raw || 'Signing in did not work. Try again.';
}
