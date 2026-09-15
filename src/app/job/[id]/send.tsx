/**
 * Sending an estimate.
 *
 * Everything here works from the frozen version, and everything except the
 * shareable link works with no signal at all: the PDF is rendered on the device,
 * and the OS share sheet already has the contractor's email account in it.
 *
 * Marking a version sent is one-way. Revising it means cutting version 2, which
 * is what keeps a claim's history honest.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Label, QuantityRow, Screen, TypeText } from '@/components/ui';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import { billingState, getCompany } from '@/db/companies';
import { entitlement, type Entitlement } from '@/features/billing/entitlement';
import {
  createEstimateVersion,
  listEstimates,
  markEstimateSent,
  setEstimateNarrative,
  type EstimateRecord,
} from '@/db/estimates';
import { listDamages } from '@/db/damages';
import { listRooms } from '@/db/rooms';
import { AiBudgetExceeded, AiUnavailable, writeNarrative } from '@/features/ai/client';
import { cleanNarrative } from '@/features/ai/resolve';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { canTransition, getJob, setJobStatus, type JobRecord } from '@/db/jobs';
import {
  buildEstimateDocument,
  buildPhotoReportDocument,
  MissingCompanyProfile,
  printToPdf,
  shareFile,
  writeCsv,
} from '@/features/documents/generate';
import { publishEstimateShare, revokeEstimateShare, shareUrlFor } from '@/features/documents/share';
import { isSupabaseConfigured } from '@/lib/supabase';
import { newId } from '@/lib/id';
import { space } from '@/theme/tokens';

export default function SendScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [versions, setVersions] = useState<EstimateRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [billing, setBilling] = useState<Entitlement | null>(null);

  const refresh = useCallback(async () => {
    const db = await openLocalDatabase();
    const [record, list, company] = await Promise.all([
      getJob(db, jobId),
      listEstimates(db, jobId),
      getCompany(db, currentCompanyId()),
    ]);
    setJob(record);
    setVersions(list);
    setShareUrl(list[0] ? shareUrlFor(list[0]) : null);
    setBilling(company ? entitlement(billingState(company)) : null);
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const latest = versions[0] ?? null;

  /** Wraps an action so a failure lands on screen rather than in a console. */
  const run = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusy(key);
      setProblem(null);
      try {
        await action();
      } catch (error) {
        setProblem(
          error instanceof MissingCompanyProfile ||
          error instanceof AiUnavailable ||
          error instanceof AiBudgetExceeded
            ? error.message
            : `That did not work: ${(error as Error).message}`,
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const cutVersion = () =>
    run('cut', async () => {
      if (!job) return;
      const db = await openLocalDatabase();
      await createEstimateVersion(db, job, newId);
      // An estimate exists now, so the job is no longer just being inspected.
      if (canTransition(job.status, 'estimating')) {
        await setJobStatus(db, job.id, 'estimating');
      }
      await refresh();
    });

  const sharePdf = () =>
    run('pdf', async () => {
      if (!latest) return;
      const db = await openLocalDatabase();
      const { document } = await buildEstimateDocument(db, latest.id);
      const uri = await printToPdf(document);
      await shareFile(uri, { mimeType: 'application/pdf', dialogTitle: 'Send estimate' });
    });

  const sharePhotos = () =>
    run('photos', async () => {
      const db = await openLocalDatabase();
      const document = await buildPhotoReportDocument(db, jobId);
      const uri = await printToPdf(document);
      await shareFile(uri, { mimeType: 'application/pdf', dialogTitle: 'Send photo report' });
    });

  const shareCsv = () =>
    run('csv', async () => {
      if (!latest) return;
      const uri = await writeCsv(latest);
      await shareFile(uri, { mimeType: 'text/csv', dialogTitle: 'Export line items' });
    });

  const publishLink = () =>
    run('link', async () => {
      if (!latest) return;
      const db = await openLocalDatabase();
      const { document } = await buildEstimateDocument(db, latest.id);
      const published = await publishEstimateShare(db, latest, document.html);
      setShareUrl(published.url);
      await refresh();
    });

  const revokeLink = () =>
    run('revoke', async () => {
      if (!latest) return;
      const db = await openLocalDatabase();
      await revokeEstimateShare(db, latest);
      setShareUrl(null);
      await refresh();
    });

  /**
   * Drafts the summary of loss an adjuster reads before the scope. Only ever on
   * a draft: rewriting what somebody already received is what versions are for.
   */
  const draftNarrative = () =>
    run('narrative', async () => {
      if (!latest || !job) return;
      const db = await openLocalDatabase();
      const rooms = await listRooms(db, jobId);

      const withMaterials = [];
      for (const room of rooms) {
        const damages = await listDamages(db, room.id);
        withMaterials.push({
          name: room.name,
          materials: [...new Set(damages.map((damage) => damage.material))],
        });
      }

      const { result } = await writeNarrative(db, currentCompanyId(), jobId, {
        propertyAddress: job.propertyAddress1,
        peril: job.peril,
        dateOfLoss: job.dateOfLoss,
        rooms: withMaterials,
        totalCents: latest.rcvCents,
      });

      const text = cleanNarrative(result);
      if (!text) throw new Error('the model returned nothing usable');

      await setEstimateNarrative(db, latest.id, text);
      await refresh();
    });

  const markSent = () =>
    run('sent', async () => {
      if (!latest || !job) return;
      const db = await openLocalDatabase();
      await markEstimateSent(db, latest.id, job.adjusterEmail ?? job.homeownerEmail ?? 'recipient');
      if (canTransition(job.status, 'sent')) {
        await setJobStatus(db, job.id, 'sent');
      }
      await refresh();
    });

  return (
    <Screen
      footer={
        latest ? (
          <>
            <Button
              label={
                billing && !billing.canSendEstimates
                  ? 'Subscribe to send'
                  : busy === 'pdf'
                    ? 'Preparing…'
                    : 'Send the estimate'
              }
              onPress={
                billing && !billing.canSendEstimates
                  ? () => router.push('/settings')
                  : sharePdf
              }
              disabled={busy !== null}
            />
            {latest.sentAt === null ? (
              <Button
                label={busy === 'sent' ? 'Marking…' : 'Mark as sent'}
                variant="secondary"
                onPress={markSent}
                disabled={busy !== null}
              />
            ) : null}
          </>
        ) : (
          <Button
            label={busy === 'cut' ? 'Freezing…' : 'Freeze a version to send'}
            onPress={cutVersion}
            disabled={busy !== null}
          />
        )
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Send</TypeText>
        <TypeText role="caption" tone="textFaint">
          {latest
            ? `Version ${latest.version}${latest.sentAt ? ' · sent' : ' · not sent yet'}`
            : 'Nothing frozen yet'}
        </TypeText>
      </View>

      {/* The trial gates sending and nothing else. Everything on the way here
          — measuring, scoping, pricing — worked regardless. */}
      {billing && !billing.canSendEstimates ? (
        <Card>
          <TypeText role="heading">Sending is paused</TypeText>
          <TypeText role="body" tone="textMuted">
            {billing.message}
          </TypeText>
          <Button label="Subscribe" onPress={() => router.push('/settings')} />
        </Card>
      ) : billing?.shouldPrompt ? (
        <Card>
          <TypeText role="caption" tone={billing.urgent ? 'danger' : 'warn'}>
            {billing.message}
          </TypeText>
        </Card>
      ) : null}

      {problem ? (
        <Card>
          <TypeText role="body" tone="danger">
            {problem}
          </TypeText>
        </Card>
      ) : null}

      {!latest ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            An estimate has to be frozen before it can be sent. Freezing takes a
            copy of the scope exactly as it stands, so what the adjuster receives
            can always be reproduced later.
          </TypeText>
        </Card>
      ) : (
        <>
          <Card>
            <Label>Version {latest.version}</Label>
            <QuantityRow label="Replacement cost" value={formatUsd(latest.rcvCents)} unit="" />
            {latest.depreciationCents > 0 ? (
              <QuantityRow label="Actual cash value" value={formatUsd(latest.acvCents)} unit="" />
            ) : null}
            <QuantityRow label="Net claim" value={formatUsd(latest.netClaimCents)} unit="" emphasis />
            <TypeText role="caption" tone="textFaint">
              {latest.snapshot.lines.length} line items across{' '}
              {latest.snapshot.rooms.length} rooms, frozen{' '}
              {new Date(latest.snapshot.takenAt).toLocaleDateString()}
            </TypeText>
          </Card>

          <Card>
            <Label>Summary of loss</Label>
            {latest.narrative ? (
              <>
                <TypeText role="body">{latest.narrative}</TypeText>
                {latest.sentAt === null ? (
                  <Button
                    label={busy === 'narrative' ? 'Rewriting…' : 'Rewrite it'}
                    variant="ghost"
                    onPress={draftNarrative}
                    disabled={busy !== null}
                  />
                ) : (
                  <TypeText role="caption" tone="textFaint">
                    Frozen with this version. Rewriting means a new one.
                  </TypeText>
                )}
              </>
            ) : latest.sentAt === null ? (
              <>
                <TypeText role="caption" tone="textMuted">
                  An adjuster reads this before the scope. Drafted from the rooms
                  and materials you recorded — then edit it, because it goes out
                  under your name.
                </TypeText>
                <Button
                  label={busy === 'narrative' ? 'Drafting…' : 'Draft a summary'}
                  variant="secondary"
                  onPress={draftNarrative}
                  disabled={busy !== null}
                />
              </>
            ) : (
              <TypeText role="caption" tone="textFaint">
                This version went out without one.
              </TypeText>
            )}
          </Card>

          <Card>
            <Label>Also send</Label>
            <Button
              label={busy === 'photos' ? 'Preparing…' : 'Photo report'}
              variant="secondary"
              onPress={sharePhotos}
              disabled={busy !== null}
            />
            <Button
              label={busy === 'csv' ? 'Preparing…' : 'Line items as CSV'}
              variant="secondary"
              onPress={shareCsv}
              disabled={busy !== null}
            />
            <TypeText role="caption" tone="textFaint">
              The CSV is for carriers that only accept their own format — scope
              here, re-key only what they demand.
            </TypeText>
          </Card>

          <Card>
            <Label>Shareable link</Label>
            {!isSupabaseConfigured() ? (
              <TypeText role="caption" tone="textFaint">
                Needs a backend. The PDF works without one.
              </TypeText>
            ) : shareUrl ? (
              <>
                <TypeText role="body">{shareUrl}</TypeText>
                <TypeText role="caption" tone="warn">
                  Anyone with this link can read the estimate — no sign-in. Revoke
                  it when the claim closes.
                </TypeText>
                <Button
                  label={busy === 'revoke' ? 'Revoking…' : 'Revoke the link'}
                  variant="danger"
                  onPress={revokeLink}
                  disabled={busy !== null}
                />
              </>
            ) : (
              <>
                <TypeText role="caption" tone="textMuted">
                  Publishes a read-only web page an adjuster can open without an
                  account.
                </TypeText>
                <Button
                  label={busy === 'link' ? 'Publishing…' : 'Publish a link'}
                  variant="secondary"
                  onPress={publishLink}
                  disabled={busy !== null}
                />
              </>
            )}
          </Card>

          {latest.sentAt !== null ? (
            <Card>
              <TypeText role="body" tone="success">
                Sent {new Date(latest.sentAt).toLocaleDateString()}
                {latest.sentTo ? ` to ${latest.sentTo}` : ''}.
              </TypeText>
              <TypeText role="caption" tone="textFaint">
                This version is frozen. Changing the scope means freezing version{' '}
                {latest.version + 1}.
              </TypeText>
              <Button
                label={busy === 'cut' ? 'Freezing…' : `Freeze version ${latest.version + 1}`}
                variant="secondary"
                onPress={cutVersion}
                disabled={busy !== null}
              />
            </Card>
          ) : null}

          {versions.length > 1 ? (
            <Card>
              <Label>Earlier versions</Label>
              {versions.slice(1).map((version) => (
                <QuantityRow
                  key={version.id}
                  label={`Version ${version.version} · ${version.status}`}
                  value={formatUsd(version.netClaimCents)}
                  unit=""
                />
              ))}
            </Card>
          ) : null}
        </>
      )}

      <Button label="Back to the estimate" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
});
