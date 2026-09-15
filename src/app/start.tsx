/**
 * Getting started.
 *
 * Not a wizard. Every step reads the database and marks itself done, so a
 * contractor who does things in their own order sees the list keep up, and one
 * who force-quits halfway comes back to exactly where they were. The screen
 * quietly stops mattering the moment they have priced a room.
 *
 * The last step is the point: the number appearing is what the product is.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Label, Screen, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { billingState } from '@/db/companies';
import { listJobs } from '@/db/jobs';
import { listLineItems } from '@/db/line-items';
import { countPriceItems } from '@/db/price-items';
import { listRooms } from '@/db/rooms';
import { entitlement } from '@/features/billing/entitlement';
import { currentCompanyId, ensureCompany } from '@/features/jobs/useCompany';
import {
  describeProgress,
  deriveOnboarding,
  type OnboardingState,
} from '@/features/onboarding/steps';
import { isProfileComplete } from '@/features/settings/company-form';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function StartScreen() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [trialMessage, setTrialMessage] = useState<string | null>(null);
  const c = useTheme();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const db = await openLocalDatabase();
        const company = await ensureCompany(db);
        const jobs = await listJobs(db, currentCompanyId());

        let roomCount = 0;
        let scopedLineCount = 0;
        for (const job of jobs) {
          roomCount += (await listRooms(db, job.id)).length;
          scopedLineCount += (await listLineItems(db, job.id)).length;
        }

        const derived = deriveOnboarding({
          profileComplete: isProfileComplete(company),
          priceItemCount: await countPriceItems(db, currentCompanyId()),
          jobCount: jobs.length,
          roomCount,
          scopedLineCount,
          estimateCount: 0,
        });

        if (!active) return;
        setState(derived);
        setTrialMessage(entitlement(billingState(company)).message);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  if (!state) return null;

  return (
    <Screen
      footer={
        state.next ? (
          <Button label={state.next.action} onPress={() => router.push(state.next!.route as never)} />
        ) : (
          <Button label="Go to my jobs" onPress={() => router.replace('/')} />
        )
      }
    >
      <View style={styles.header}>
        <TypeText role="title">
          {state.finished ? 'You are set up' : 'Getting started'}
        </TypeText>
        <TypeText role="caption" tone="textFaint">
          {describeProgress(state)}
          {trialMessage ? ` · ${trialMessage}` : ''}
        </TypeText>
      </View>

      {state.finished ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            That is the whole loop: walk the house, say what got wet, send the
            estimate before you leave the driveway. Everything from here is the
            same thing, faster.
          </TypeText>
        </Card>
      ) : null}

      <View style={styles.list}>
        {state.steps.map((step, index) => (
          <View
            key={step.id}
            style={[
              styles.step,
              {
                backgroundColor: c.surface,
                borderColor: step.id === state.next?.id ? c.accent : c.border,
                borderWidth: step.id === state.next?.id ? 2 : 1,
              },
            ]}
          >
            <View style={styles.stepHead}>
              <View
                style={[
                  styles.marker,
                  {
                    backgroundColor: step.done ? c.successSoft : c.surfaceAlt,
                    borderColor: step.done ? c.success : c.border,
                  },
                ]}
              >
                <TypeText role="caption" tone={step.done ? 'success' : 'textFaint'}>
                  {step.done ? '✓' : String(index + 1)}
                </TypeText>
              </View>
              <TypeText role="heading" tone={step.done ? 'textMuted' : 'text'}>
                {step.title}
              </TypeText>
            </View>

            {!step.done ? (
              <>
                <TypeText role="body" tone="textMuted">
                  {step.detail}
                </TypeText>
                {step.id === state.next?.id ? null : (
                  <Button
                    label={step.action}
                    variant="ghost"
                    onPress={() => router.push(step.route as never)}
                  />
                )}
              </>
            ) : null}
          </View>
        ))}
      </View>

      <Card>
        <Label>While you are trying it</Label>
        <TypeText role="caption" tone="textMuted">
          Everything works with no signal. Measure a whole house in a basement
          and it syncs when you get back to the truck. Nothing waits on a bar of
          service.
        </TypeText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  list: { gap: space.md },
  step: { borderRadius: radius.md, padding: space.lg, gap: space.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  marker: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
