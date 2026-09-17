/**
 * The subscribe screen.
 *
 * Reached from exactly two places, and both matter: the send screen, when a
 * contractor is looking at a finished estimate they cannot send, and settings,
 * when they went looking for it. Never on launch, never as an interstitial.
 *
 * The plan's rule holds here — the trial gates sending, never working — so this
 * screen opens by saying the work is safe. Somebody who has just walked a house
 * in the rain and is being asked for money needs to know, in the first sentence,
 * that the afternoon they have just spent is not being held hostage.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Card, Label, Screen, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { billingState, getCompany, type CompanyRecord } from '@/db/companies';
import { entitlement, TRIAL_DAYS, type Entitlement } from '@/features/billing/entitlement';
import { openBillingPortal, startCheckout } from '@/features/billing/checkout';
import { pullBillingState } from '@/features/billing/sync';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** What the subscription actually buys, in a contractor's terms. */
const INCLUDED = [
  'Unlimited jobs, rooms and photos',
  'Estimates and photo reports as PDF',
  'AI scoping, photo tagging and voice notes',
  'Everything keeps working offline',
];

export default function SubscribeScreen() {
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [billing, setBilling] = useState<Entitlement | null>(null);
  const [busy, setBusy] = useState<null | 'checkout' | 'portal'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const c = useTheme();

  const refresh = useCallback(async () => {
    const db = await openLocalDatabase();
    const id = currentCompanyId();

    // Show the local answer first, then correct it from the server. A webhook
    // that landed while the app was closed is the common case, and waiting on
    // the network to render a screen is what this app does not do.
    const local = await getCompany(db, id);
    if (local) {
      setCompany(local);
      setBilling(entitlement(billingState(local)));
    }

    const fresh = await pullBillingState(db, id);
    if (fresh) {
      setCompany(fresh);
      setBilling(entitlement(billingState(fresh)));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    setBusy('checkout');
    setNotice(null);
    try {
      const db = await openLocalDatabase();
      const outcome = await startCheckout(db, currentCompanyId());

      switch (outcome.kind) {
        case 'subscribed':
          setCompany(outcome.company);
          setBilling(entitlement(billingState(outcome.company)));
          setNotice(null);
          break;
        case 'pending':
          // Charged, almost certainly fine, webhook not here yet. Saying
          // "payment failed" to somebody whose card has just cleared is the
          // worst available outcome, so this says what is actually true.
          setNotice(
            'Your payment went through. It can take a moment to show up here — ' +
              'pull back to this screen in a minute if it has not.',
          );
          await refresh();
          break;
        case 'cancelled':
          break;
        case 'failed':
          setNotice(outcome.message);
          break;
      }
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const manage = useCallback(async () => {
    setBusy('portal');
    setNotice(null);
    const result = await openBillingPortal();
    if (!result.ok && result.message) setNotice(result.message);
    // Whatever they changed arrives by webhook, so re-read on the way back.
    await refresh();
    setBusy(null);
  }, [refresh]);

  if (!company || !billing) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator color={c.accent} />
        </View>
      </Screen>
    );
  }

  const subscribed = company.subscriptionStatus === 'active';
  // A company only ever leaves 'trialing' because the webhook moved it, and the
  // webhook only fires for a real Stripe subscription. So this is a reliable
  // "Stripe knows who they are" without the app holding a customer id it is
  // not allowed to write.
  const knownToStripe = company.subscriptionStatus !== 'trialing';

  return (
    <Screen
      footer={
        <>
          {subscribed && !company.cancelAtPeriodEnd ? (
            <Button
              label={busy === 'portal' ? 'Opening…' : 'Manage billing'}
              onPress={() => void manage()}
              disabled={busy !== null}
            />
          ) : (
            <Button
              label={busy === 'checkout' ? 'Opening Stripe…' : 'Subscribe'}
              onPress={() => void subscribe()}
              disabled={busy !== null}
            />
          )}
          {knownToStripe && !subscribed ? (
            <Button
              label="Manage billing"
              variant="secondary"
              onPress={() => void manage()}
              disabled={busy !== null}
            />
          ) : null}
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">
          {subscribed ? 'Subscribed' : 'Keep sending estimates'}
        </TypeText>
        <TypeText role="caption" tone="textFaint">
          {billing.message}
        </TypeText>
      </View>

      {/* First thing on the screen, deliberately. */}
      {!billing.canSendEstimates ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            Every job, room, photo and price you have recorded is still on this
            phone and still yours. Measuring, scoping and pricing all keep
            working. Subscribing turns sending back on.
          </TypeText>
        </Card>
      ) : null}

      {notice ? (
        <Card>
          <TypeText role="body" tone="warn">
            {notice}
          </TypeText>
        </Card>
      ) : null}

      <Card>
        <Label>What you get</Label>
        {INCLUDED.map((line) => (
          <View key={line} style={styles.bulletRow}>
            <TypeText role="body" tone="accent">
              ·
            </TypeText>
            <TypeText role="body" tone="textMuted" style={styles.bulletText}>
              {line}
            </TypeText>
          </View>
        ))}
      </Card>

      {!knownToStripe ? (
        <Card>
          <TypeText role="caption" tone="textFaint">
            {TRIAL_DAYS}-day trial, then billed monthly. Cancel any time from
            this screen — cancelling stops the renewal and you keep sending
            until the period you have paid for runs out.
          </TypeText>
        </Card>
      ) : null}

      <Card>
        <TypeText role="caption" tone="textFaint">
          Payment is handled by Stripe. Card details never reach ScopeFlow.
        </TypeText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  loading: { paddingVertical: space.xl * 2, alignItems: 'center' },
  bulletRow: { flexDirection: 'row', gap: space.sm },
  bulletText: { flex: 1 },
});
