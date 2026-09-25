/**
 * The job list — the app's front door.
 *
 * A contractor opens this between jobs, in a truck, one-handed. So: biggest
 * touch target is the new-job button in the thumb zone, each row is a full-width
 * tap, and the sync chip says what is still on the phone without ever calling it
 * an error.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, SyncChip, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import {
  JOB_STATUS_LABELS,
  jobSubtitle,
  jobSummaries,
  jobTitle,
  listJobs,
  saveJob,
  type JobRecord,
  type JobSummary,
} from '@/db/jobs';
import type { CompanyRecord } from '@/db/companies';
import { createSampleJob } from '@/features/demo/sample-job';
import { currentCompanyId, ensureCompany } from '@/features/jobs/useCompany';
import { isProfileComplete } from '@/features/settings/company-form';
import { useSync } from '@/hooks/use-sync';
import { estimatingEnabled, showDemoTools } from '@/lib/demo-mode';
import { isSupabaseConfigured } from '@/lib/supabase';
import { newId } from '@/lib/id';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function JobListScreen() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [summaries, setSummaries] = useState<Map<string, JobSummary>>(new Map());
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const sync = useSync();
  const c = useTheme();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const db = await openLocalDatabase();
        const [rows, counts, profile] = await Promise.all([
          listJobs(db, currentCompanyId()),
          jobSummaries(db, currentCompanyId()),
          ensureCompany(db),
        ]);
        if (active) {
          setJobs(rows);
          setSummaries(counts);
          setCompany(profile);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const startJob = useCallback(async () => {
    const db = await openLocalDatabase();
    const id = newId();
    await saveJob(db, { id, companyId: currentCompanyId(), peril: 'water' });
    // The address first, so the job never sits in the list as "Untitled".
    router.push(`/job/${id}/details?new=1`);
  }, []);

  const [loadingSample, setLoadingSample] = useState(false);

  /** Offered with no backend, or when EXPO_PUBLIC_DEMO_TOOLS=1. It syncs like any job. */
  const loadSample = useCallback(async () => {
    setLoadingSample(true);
    try {
      const db = await openLocalDatabase();
      const { jobId } = await createSampleJob(db, currentCompanyId(), newId);
      router.push(`/job/${jobId}`);
    } finally {
      setLoadingSample(false);
    }
  }, []);

  const sampleButton = showDemoTools() ? (
    <Button
      label={loadingSample ? 'Building the sample…' : 'Load a sample job'}
      variant={jobs.length === 0 ? 'secondary' : 'ghost'}
      onPress={() => void loadSample()}
      disabled={loadingSample}
    />
  ) : null;

  return (
    <Screen
      footer={
        <>
          <Button label="New job" onPress={() => void startJob()} />
          {estimatingEnabled() ? (
            <View style={styles.footerRow}>
              <View style={styles.footerItem}>
                <Button
                  label="Price list"
                  variant="secondary"
                  onPress={() => router.push('/prices')}
                />
              </View>
              <View style={styles.footerItem}>
                <Button
                  label="Settings"
                  variant="secondary"
                  onPress={() => router.push('/settings')}
                />
              </View>
            </View>
          ) : (
            <View style={styles.footerRow}>
              {/* At the desk, the jobs are on the phones: export reads the cloud. */}
              {Platform.OS === 'web' && isSupabaseConfigured() ? (
                <View style={styles.footerItem}>
                  <Button
                    label="Export for Xactimate"
                    variant="secondary"
                    onPress={() => router.push('/export')}
                  />
                </View>
              ) : null}
              <View style={styles.footerItem}>
                <Button
                  label="Settings"
                  variant="secondary"
                  onPress={() => router.push('/settings')}
                />
              </View>
            </View>
          )}
        </>
      }
    >
      <SyncChip
        pending={sync.pending}
        uploading={sync.uploading}
        thinking={sync.thinking}
        failed={sync.failed}
        online={sync.online}
      />

      {estimatingEnabled() && !isProfileComplete(company) ? (
        <Card>
          <TypeText role="heading">Finish your business details</TypeText>
          <TypeText role="body" tone="textMuted">
            Your name and a way to reach you go on every estimate. An estimate
            cannot be sent without them.
          </TypeText>
          <Button
            label="Open settings"
            variant="secondary"
            onPress={() => router.push('/settings')}
          />
        </Card>
      ) : null}

      {jobs.length === 0 ? (
        <Card>
          <TypeText role="heading">No jobs yet</TypeText>
          <TypeText role="body" tone="textMuted">
            Start one when you pull up to the property. Everything works without
            signal — it syncs when you get back to the truck.
          </TypeText>
          {sampleButton}
        </Card>
      ) : (
        <View style={styles.list}>
          {jobs.map((job) => {
            const summary = summaries.get(job.id);
            return (
                <Pressable
                  key={job.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/job/${job.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: c.surface,
                      borderColor: c.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.rowMain}>
                    <TypeText role="heading">{jobTitle(job)}</TypeText>
                    {jobSubtitle(job) ? (
                      <TypeText role="caption" tone="textFaint">
                        {jobSubtitle(job)}
                      </TypeText>
                    ) : null}
                    <TypeText role="caption" tone="textMuted">
                      {summary?.rooms ?? 0} rooms &middot; {summary?.photos ?? 0} photos
                    </TypeText>
                  </View>
                  <View style={[styles.status, { backgroundColor: c.accentSoft }]}>
                    <TypeText role="caption" tone="accent">
                      {JOB_STATUS_LABELS[job.status]}
                    </TypeText>
                  </View>
                </Pressable>
            );
          })}
          {sampleButton}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  footerRow: { flexDirection: 'row', gap: space.md },
  footerItem: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  rowMain: { flex: 1, gap: 2 },
  status: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
