/**
 * Export for Xactimate, at the desk.
 *
 * The computer Xactimate runs on is not the phone the photos were taken on, so
 * this screen reads the company's jobs from Supabase and downloads the
 * full-size originals from the bucket. It needs a backend: without one there
 * is nothing on this computer to export.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, TypeText } from '@/components/ui';
import { ExportPanel } from '@/features/export/ExportPanel';
import {
  listRemoteJobs,
  loadRemoteJob,
  type ExportJob,
  type RemoteJobSummary,
} from '@/features/export/source';
import { goBack } from '@/lib/navigation';
import { isSupabaseConfigured } from '@/lib/supabase';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function CloudExportScreen() {
  const [jobs, setJobs] = useState<RemoteJobSummary[] | null>(null);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const c = useTheme();

  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      setJobs(await listRemoteJobs());
    } catch (error) {
      setProblem((error as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isSupabaseConfigured()) void refresh();
    }, [refresh]),
  );

  const open = async (id: string) => {
    setOpening(id);
    setProblem(null);
    try {
      setJob(await loadRemoteJob(id));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setOpening(null);
    }
  };

  if (!isSupabaseConfigured()) {
    return (
      <Screen footer={<Button label="Back" variant="ghost" onPress={() => goBack()} />}>
        <TypeText role="title">Export for Xactimate</TypeText>
        <Card>
          <TypeText role="body" tone="textMuted">
            Exporting on a computer reads the photos from the cloud, and this copy of
            ScopeFlow is not connected to one. Export from the job on the phone instead.
          </TypeText>
        </Card>
      </Screen>
    );
  }

  if (job) {
    return (
      <Screen footer={<Button label="All jobs" variant="ghost" onPress={() => setJob(null)} />}>
        <TypeText role="title">{job.title}</TypeText>
        <ExportPanel job={job} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Back" variant="ghost" onPress={() => goBack()} />}>
      <View style={styles.header}>
        <TypeText role="title">Export for Xactimate</TypeText>
        <TypeText role="caption" tone="textFaint">
          Every job your phones have synced. Pick one to download its photos at full size.
        </TypeText>
      </View>

      {problem ? (
        <Card>
          <TypeText role="body" tone="danger">
            {problem}
          </TypeText>
          <Button label="Try again" variant="secondary" onPress={() => void refresh()} />
        </Card>
      ) : null}

      {jobs === null ? (
        <TypeText role="caption" tone="textFaint">
          Loading jobs…
        </TypeText>
      ) : jobs.length === 0 ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            No jobs have synced yet. Open ScopeFlow on the phone with signal and they will
            appear here.
          </TypeText>
        </Card>
      ) : (
        <View style={styles.list}>
          {jobs.map((summary) => (
            <Pressable
              key={summary.id}
              accessibilityRole="button"
              onPress={() => void open(summary.id)}
              disabled={opening !== null}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <TypeText role="heading">{summary.title}</TypeText>
              <TypeText role="caption" tone="textFaint">
                {opening === summary.id
                  ? 'Opening…'
                  : [summary.subtitle, new Date(summary.createdAt).toLocaleDateString()]
                      .filter(Boolean)
                      .join(' · ')}
              </TypeText>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  list: { gap: space.md },
  row: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: 2 },
});
