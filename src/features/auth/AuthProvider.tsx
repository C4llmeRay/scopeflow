/**
 * Who is signed in, for the screens.
 *
 * One rule shapes this: A CACHED SESSION IS ENOUGH TO WORK. Signing in is the
 * only thing in ScopeFlow that genuinely needs signal. Once a session is on the
 * phone it is read from storage, and a contractor in a basement with no bars
 * gets straight to their jobs — the token refresh can fail all it likes, the
 * local database does not care.
 *
 * With no backend configured at all, the app runs in local mode under the
 * placeholder company, which is what makes it testable before Supabase exists.
 */

import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { openLocalDatabase } from '@/db/client';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { adoptLocalData, PLACEHOLDER_COMPANY_ID } from './adopt';
import { setCurrentIdentity } from './current';
import { describeAuthError, normalizeEmail, normalizeOtp } from './session';

export type AuthPhase =
  /** Reading the stored session. Nothing should render yet. */
  | 'loading'
  /** No backend configured: everything works locally under the placeholder. */
  | 'local'
  | 'signed-out'
  | 'signed-in';

export interface AuthValue {
  phase: AuthPhase;
  companyId: string | null;
  email: string | null;
  /** Sends a six-digit code. */
  sendCode: (email: string) => Promise<void>;
  /** Verifies it and resolves the company. */
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth used outside AuthProvider');
  return value;
}

/**
 * Finds the company this user belongs to, creating one on a first sign-in.
 *
 * `bootstrap_company` is a SECURITY DEFINER function in the schema that makes
 * the company and the profile in one transaction — it exists because of a
 * chicken-and-egg problem: RLS keys on company_id and a brand new user has none.
 */
async function resolveCompany(): Promise<string> {
  const supabase = getSupabase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .maybeSingle();

  if (profile?.company_id) return profile.company_id as string;

  const { data, error } = await supabase.rpc('bootstrap_company', { p_name: '' });
  if (error) throw error;
  return data as string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  /** Everything that has to happen once a session exists. */
  const adopt = useCallback(async (session: Session) => {
    const resolved = await resolveCompany();

    // Anything recorded before signing in moves under the real company —
    // rows, the profile, and the tenant inside queued pushes.
    const db = await openLocalDatabase();
    await adoptLocalData(db, resolved, PLACEHOLDER_COMPANY_ID);

    setCurrentIdentity({ companyId: resolved, userId: session.user.id });
    setCompanyId(resolved);
    setEmail(session.user.email ?? null);
    setPhase('signed-in');
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!isSupabaseConfigured()) {
        // No backend. Work locally under the placeholder so the app is usable
        // and testable before Supabase exists.
        setCurrentIdentity({ companyId: PLACEHOLDER_COMPANY_ID, userId: 'local' });
        if (active) {
          setCompanyId(PLACEHOLDER_COMPANY_ID);
          setPhase('local');
        }
        return;
      }

      const { data } = await getSupabase().auth.getSession();
      if (!active) return;

      if (data.session) {
        try {
          await adopt(data.session);
        } catch {
          // The session is cached but the company could not be resolved —
          // almost always no signal. Work locally rather than locking them out
          // of their own jobs; sync catches up when there are bars.
          setCurrentIdentity({
            companyId: PLACEHOLDER_COMPANY_ID,
            userId: data.session.user.id,
          });
          if (active) {
            setCompanyId(PLACEHOLDER_COMPANY_ID);
            setPhase('local');
          }
        }
      } else {
        setCurrentIdentity(null);
        setPhase('signed-out');
      }
    })();

    let unsubscribe: (() => void) | null = null;

    if (isSupabaseConfigured()) {
      const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          setCurrentIdentity(null);
          setCompanyId(null);
          setEmail(null);
          setPhase('signed-out');
        } else if (session && event === 'SIGNED_IN') {
          void adopt(session).catch(() => setPhase('signed-out'));
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [adopt]);

  const sendCode = useCallback(async (raw: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({
      email: normalizeEmail(raw),
      options: { shouldCreateUser: true },
    });
    if (error) throw new Error(describeAuthError(error));
  }, []);

  const verifyCode = useCallback(
    async (raw: string, code: string) => {
      const { data, error } = await getSupabase().auth.verifyOtp({
        email: normalizeEmail(raw),
        token: normalizeOtp(code),
        type: 'email',
      });
      if (error) throw new Error(describeAuthError(error));
      if (!data.session) throw new Error('Signing in did not return a session.');
      await adopt(data.session);
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) await getSupabase().auth.signOut();
    setCurrentIdentity(null);
    setCompanyId(null);
    setEmail(null);
    setPhase('signed-out');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ phase, companyId, email, sendCode, verifyCode, signOut }),
    [companyId, email, phase, sendCode, signOut, verifyCode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
