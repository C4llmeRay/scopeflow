/**
 * The job's details: where it is and whose claim it is.
 *
 * Opened first for a new job, so it never sits in the list as "Untitled job",
 * and the address becomes the name of the photo export. Everything is
 * optional — at the kerb, the address is often all there is.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, TextField, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { getJob, updateJobDetails, type JobDetails } from '@/db/jobs';
import { goBack } from '@/lib/navigation';
import { space } from '@/theme/tokens';

const EMPTY: JobDetails = {
  propertyAddress1: null,
  propertyCity: null,
  propertyState: null,
  propertyPostal: null,
  claimNo: null,
  carrier: null,
  homeownerName: null,
  homeownerPhone: null,
  dateOfLoss: null,
};

export default function JobDetailsScreen() {
  const { id: jobId, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const [details, setDetails] = useState<JobDetails>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const db = await openLocalDatabase();
      const job = await getJob(db, jobId);
      if (job) {
        setDetails({
          propertyAddress1: job.propertyAddress1,
          propertyCity: job.propertyCity,
          propertyState: job.propertyState,
          propertyPostal: job.propertyPostal,
          claimNo: job.claimNo,
          carrier: job.carrier,
          homeownerName: job.homeownerName,
          homeownerPhone: job.homeownerPhone,
          dateOfLoss: job.dateOfLoss,
        });
      }
      setLoaded(true);
    })();
  }, [jobId]);

  const field = (key: keyof JobDetails) => ({
    value: details[key] ?? '',
    onChangeText: (next: string) => setDetails((d) => ({ ...d, [key]: next })),
  });

  const done = () => {
    // A new job goes on to its own screen; an edit goes back to where it came from.
    if (isNew) router.replace(`/job/${jobId}`);
    else goBack(`/job/${jobId}`);
  };

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const db = await openLocalDatabase();
      await updateJobDetails(db, jobId, details);
      done();
    } finally {
      setBusy(false);
    }
    // done() only reads route params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, jobId]);

  if (!loaded) return null;

  return (
    <Screen
      footer={
        <>
          <Button label={busy ? 'Saving…' : 'Save'} onPress={() => void save()} disabled={busy} />
          {isNew ? <Button label="Skip for now" variant="ghost" onPress={done} /> : null}
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">{isNew ? 'New job' : 'Job details'}</TypeText>
        <TypeText role="caption" tone="textFaint">
          The address names the job and its photo export. Everything else can
          wait.
        </TypeText>
      </View>

      <TextField label="Property address" placeholder="1418 Maple Avenue" autoCapitalize="words" {...field('propertyAddress1')} />
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField label="City" autoCapitalize="words" {...field('propertyCity')} />
        </View>
        <View style={styles.state}>
          <TextField label="State" autoCapitalize="none" {...field('propertyState')} />
        </View>
        <View style={styles.zip}>
          <TextField label="ZIP" {...field('propertyPostal')} />
        </View>
      </View>
      <TextField label="Claim number" autoCapitalize="none" {...field('claimNo')} />
      <TextField label="Insured" autoCapitalize="words" {...field('homeownerName')} />
      <TextField label="Insured phone" keyboardType="phone-pad" {...field('homeownerPhone')} />
      <TextField label="Carrier" autoCapitalize="words" {...field('carrier')} />
      <TextField label="Date of loss" placeholder="2026-09-21" autoCapitalize="none" {...field('dateOfLoss')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
  state: { width: 72 },
  zip: { width: 96 },
});
