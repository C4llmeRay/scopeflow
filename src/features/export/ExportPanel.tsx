/**
 * The export: what will go into Xactimate, and the button that sends it.
 *
 * The list is the photo sheet as Xactimate will have it — number, file name,
 * name, description — so the contractor can check it before it leaves, and at
 * the desk copy each name and description straight into Xactimate's fields.
 */

import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Card, Label, TypeText } from '../../components/ui';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { buildExportManifest, isLabelled, type ExportEntry } from '../photos/labels';
import { canCopy, copyText, deliverZip } from './deliver';
import type { ExportJob } from './source';
import { buildXactimateZip } from './zip';

export function ExportPanel({ job, onLabel }: { job: ExportJob; onLabel?: () => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'warn' | 'danger'; text: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);

  const entries = useMemo(() => buildExportManifest(job.rooms, job.photos), [job]);
  const byId = useMemo(() => new Map(job.photos.map((p) => [p.id, p])), [job]);
  const unlabelled = job.photos.filter((p) => !isLabelled(p)).length;
  const unreachable = job.photos.filter((p) => !p.load).length;
  const isPhone = Platform.OS !== 'web';

  const run = async () => {
    setOutcome(null);
    setProgress({ done: 0, total: entries.length });
    try {
      const result = await buildXactimateZip(job, (done, total) => setProgress({ done, total }));
      const delivered = await deliverZip(result.zip, result.fileName);
      const count = result.entries.length - result.missing.length;
      setOutcome(
        !delivered
          ? { tone: 'danger', text: 'This device cannot share files.' }
          : result.missing.length > 0
            ? {
                tone: 'warn',
                text: `${count} photos exported. ${result.missing.length} could not be read and were left out: ${result.missing
                  .map((m) => m.number)
                  .join(', ')}.`,
              }
            : { tone: 'success', text: `${count} photos exported as ${result.fileName}.` },
      );
    } catch (error) {
      setOutcome({ tone: 'danger', text: `The export did not finish: ${(error as Error).message}` });
    } finally {
      setProgress(null);
    }
  };

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };

  return (
    <View style={styles.root}>
      <Card>
        <TypeText role="heading">
          {entries.length} {entries.length === 1 ? 'photo' : 'photos'} for Xactimate
        </TypeText>
        <TypeText role="caption" tone="textMuted">
          {isPhone
            ? 'Makes a ZIP and opens the share sheet — send it to the computer with Xactimate. The phone sends 1280-pixel copies; export from ScopeFlow on the computer for full size.'
            : 'Downloads a ZIP: numbered photos named by their titles, and a photo list. Unzip it, then import the folder into Xactimate and copy each description across from the list below.'}
        </TypeText>
        {unlabelled > 0 ? (
          <View style={styles.warn}>
            <TypeText role="caption" tone="warn">
              {unlabelled} {unlabelled === 1 ? 'photo has' : 'photos have'} no name or no
              description yet.
            </TypeText>
            {onLabel ? <Button label="Label them first" variant="secondary" onPress={onLabel} /> : null}
          </View>
        ) : null}
        {unreachable > 0 ? (
          <TypeText role="caption" tone="warn">
            {unreachable} {unreachable === 1 ? 'photo has' : 'photos have'} not uploaded from the
            phone yet and will be left out. Open the job on the phone with signal and try again.
          </TypeText>
        ) : null}
        <Button
          label={
            progress
              ? `Preparing ${progress.done} of ${progress.total}…`
              : isPhone
                ? 'Share ZIP'
                : 'Download ZIP'
          }
          onPress={() => void run()}
          disabled={progress !== null || entries.length === 0}
        />
        {outcome ? (
          <TypeText role="caption" tone={outcome.tone}>
            {outcome.text}
          </TypeText>
        ) : null}
      </Card>

      <Label>Photo list</Label>
      {entries.map((entry) => (
        <Row
          key={entry.photoId}
          entry={entry}
          previewUri={byId.get(entry.photoId)?.previewUri ?? null}
          copied={copied}
          onCopy={canCopy ? copy : null}
        />
      ))}
    </View>
  );
}

function Row({
  entry,
  previewUri,
  copied,
  onCopy,
}: {
  entry: ExportEntry;
  previewUri: string | null;
  copied: string | null;
  onCopy: ((key: string, text: string) => Promise<void>) | null;
}) {
  const c = useTheme();
  const titleKey = `${entry.photoId}:title`;
  const descKey = `${entry.photoId}:desc`;
  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
      {previewUri ? (
        <Image
          source={{ uri: previewUri }}
          style={[styles.thumb, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          contentFit="cover"
        />
      ) : null}
      <View style={styles.rowMain}>
        <TypeText role="caption" tone="textFaint">
          {entry.fileName}
        </TypeText>
        <TypeText role="bodyStrong">{entry.title}</TypeText>
        <TypeText role="caption" tone={entry.description ? 'textMuted' : 'warn'}>
          {entry.description || 'No description'}
        </TypeText>
        {onCopy ? (
          <View style={styles.copyRow}>
            <Button
              label={copied === titleKey ? 'Copied' : 'Copy name'}
              variant="secondary"
              onPress={() => void onCopy(titleKey, entry.title)}
            />
            <Button
              label={copied === descKey ? 'Copied' : 'Copy description'}
              variant="secondary"
              onPress={() => void onCopy(descKey, entry.description)}
              disabled={!entry.description}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  warn: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  rowMain: { flex: 1, gap: 2 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, borderWidth: 1 },
  copyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
