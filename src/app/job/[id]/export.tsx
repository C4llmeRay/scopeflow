/**
 * Exporting one job's photos for Xactimate, from the device the job is on.
 *
 * On the phone this is the quick path: a ZIP through the share sheet. At the
 * desk, /export reads the same job from Supabase instead, with full-size
 * originals — see src/app/export.tsx.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { Button, Screen, TypeText } from '@/components/ui';
import { ExportPanel } from '@/features/export/ExportPanel';
import { loadLocalJob, type ExportJob } from '@/features/export/source';
import { goBack } from '@/lib/navigation';

export default function ExportJobScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<ExportJob | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadLocalJob(jobId).then((loadedJob) => {
        setJob(loadedJob);
        setLoaded(true);
      });
    }, [jobId]),
  );

  if (!loaded) return null;

  return (
    <Screen footer={<Button label="Back to the job" variant="ghost" onPress={() => goBack(`/job/${jobId}`)} />}>
      <TypeText role="title">{job?.title ?? 'Export'}</TypeText>
      {job ? (
        <ExportPanel job={job} onLabel={() => router.push(`/job/${jobId}/label`)} />
      ) : (
        <TypeText role="body" tone="textMuted">
          This job is not on this device.
        </TypeText>
      )}
    </Screen>
  );
}
