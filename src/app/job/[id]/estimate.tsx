/**
 * Estimate review.
 *
 * Collapsible room cards and a running total pinned to the bottom, because that
 * number is why the contractor is here and it should never require scrolling to
 * find.
 *
 * "Scope this room" runs the deterministic template against what the damage
 * sheet recorded and what the measurement engine derived. Anything the
 * contractor's price list cannot price is reported rather than invented.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Label, QuantityRow, Screen, TypeText } from '@/components/ui';
import { computeRoom, type RoomQuantities } from '@/core/measure';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import { listDamages } from '@/db/damages';
import { priceJob, type LivePricing } from '@/db/estimates';
import { getJob } from '@/db/jobs';
import {
  applyScopeToRoom,
  listRoomLineItems,
  saveLineItem,
  setLineItemStatus,
  softDeleteLineItem,
  type LineItemRecord,
} from '@/db/line-items';
import { listOpenings, toCoreOpenings } from '@/db/openings';
import { listPriceItems } from '@/db/price-items';
import { listRooms, type RoomRecord } from '@/db/rooms';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { AiBudgetExceeded, AiUnavailable, isDemoAi, suggestScope } from '@/features/ai/client';
import { DEMO_AI_LABEL } from '@/features/ai/demo';
import { resolveScopeSuggestion } from '@/features/ai/resolve';
import { buildScope, type ScopeLine } from '@/features/scope/templates';
import { newId } from '@/lib/id';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

interface RoomScope {
  room: RoomRecord;
  quantities: RoomQuantities | null;
  lines: LineItemRecord[];
  materials: string[];
}

export default function EstimateScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [scopes, setScopes] = useState<RoomScope[]>([]);
  const [pricing, setPricing] = useState<LivePricing | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unpriced, setUnpriced] = useState<ScopeLine[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const c = useTheme();

  const refresh = useCallback(async () => {
    const db = await openLocalDatabase();
    const record = await getJob(db, jobId);
    if (!record) return;

    const rooms = await listRooms(db, jobId);
    const next: RoomScope[] = [];
    for (const room of rooms) {
      const [openings, damages, lines] = await Promise.all([
        listOpenings(db, room.id),
        listDamages(db, room.id),
        listRoomLineItems(db, room.id),
      ]);
      next.push({
        room,
        lines,
        materials: damages.map((d) => d.material),
        quantities: safeQuantities(room, openings),
      });
    }

    setScopes(next);
    setPricing(await priceJob(db, record));
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const scopeRoom = useCallback(
    async (entry: RoomScope) => {
      if (!entry.quantities) return;
      const db = await openLocalDatabase();
      const priceItems = await listPriceItems(db, currentCompanyId());
      const damages = await listDamages(db, entry.room.id);

      const lines = buildScope({
        quantities: entry.quantities,
        materials: entry.materials,
        waterCategory: damages[0]?.waterCategory ?? null,
        waterClass: damages[0]?.waterClass ?? null,
        floodCutHeightIn: entry.room.floodCutHeightIn,
      });

      const { skipped } = await applyScopeToRoom(
        db,
        { companyId: currentCompanyId(), jobId, roomId: entry.room.id },
        lines,
        priceItems,
        newId,
      );

      setUnpriced(skipped);
      setExpanded((prev) => new Set(prev).add(entry.room.id));
      await refresh();
    },
    [jobId, refresh],
  );

  /**
   * Asks the model for what the deterministic template missed. Everything it
   * returns lands as a suggestion: quantities come from the room's geometry,
   * codes are constrained to the price list, and nothing reaches the total
   * until a human taps accept.
   */
  const suggestMore = useCallback(
    async (entry: RoomScope) => {
      if (!entry.quantities) return;
      setAiBusy(entry.room.id);
      setAiNote(null);
      try {
        const db = await openLocalDatabase();
        const damages = await listDamages(db, entry.room.id);
        const existing = await listRoomLineItems(db, entry.room.id);

        const { result } = await suggestScope(db, currentCompanyId(), jobId, {
          roomName: entry.room.name,
          quantities: entry.quantities,
          materials: entry.materials,
          waterCategory: damages[0]?.waterCategory ?? null,
          waterClass: damages[0]?.waterClass ?? null,
          floodCutHeightIn: entry.room.floodCutHeightIn,
          alreadyScoped: existing.map((line) => line.code),
        });

        const priceItems = await listPriceItems(db, currentCompanyId());
        const resolved = resolveScopeSuggestion(result, priceItems, entry.quantities);

        // Replace last round's unaccepted suggestions so they do not pile up.
        for (const line of existing) {
          if (line.origin === 'ai' && line.status === 'suggested') {
            await softDeleteLineItem(db, line.id);
          }
        }

        const already = new Set(
          existing.filter((l) => l.status !== 'suggested').map((l) => l.code.toUpperCase()),
        );

        let added = 0;
        for (const line of resolved.lines) {
          if (already.has(line.code.toUpperCase())) continue;
          await saveLineItem(db, {
            id: newId(),
            companyId: currentCompanyId(),
            jobId,
            roomId: entry.room.id,
            priceItemId: line.priceItemId,
            code: line.code,
            description: line.description,
            unit: line.unit,
            qty: line.qty,
            wastePct: line.wastePct,
            materialUnitCents: line.materialUnitCents,
            laborUnitCents: line.laborUnitCents,
            usefulLifeYears: line.usefulLifeYears,
            origin: 'ai',
            aiConfidence: line.confidence,
            note: line.reason,
            sortOrder: 900 + added,
          });
          added++;
        }

        const parts = [
          added > 0 ? `${added} suggested` : 'nothing new suggested',
          resolved.rejectedCodes.length > 0
            ? `${resolved.rejectedCodes.length} used codes you do not have`
            : null,
          resolved.unpriced.length > 0 ? `unpriced: ${resolved.unpriced.join(', ')}` : null,
          isDemoAi() ? DEMO_AI_LABEL : null,
        ].filter(Boolean);

        setAiNote(parts.join(' · '));
        setExpanded((prev) => new Set(prev).add(entry.room.id));
        await refresh();
      } catch (error) {
        setAiNote(
          error instanceof AiBudgetExceeded || error instanceof AiUnavailable
            ? error.message
            : `That did not work: ${(error as Error).message}`,
        );
      } finally {
        setAiBusy(null);
      }
    },
    [jobId, refresh],
  );

  const totals = pricing?.totals;
  const hasScope = (totals?.lines.length ?? 0) > 0;

  return (
    <Screen
      footer={
        <>
          {/* The number they came for, always in view. */}
          <View style={styles.totalRow}>
            <View>
              <Label>Net claim</Label>
              <TypeText role="caption" tone="textFaint">
                RCV {formatUsd(totals?.rcvCents ?? 0)} · ACV {formatUsd(totals?.acvCents ?? 0)}
              </TypeText>
            </View>
            <TypeText role="display">{formatUsd(totals?.netClaimCents ?? 0)}</TypeText>
          </View>
          <Button
            label="Review and send"
            onPress={() => router.push(`/job/${jobId}/send`)}
            disabled={!hasScope}
          />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Estimate</TypeText>
        <TypeText role="caption" tone="textFaint">
          {totals?.lines.length ?? 0} line items across {scopes.length}{' '}
          {scopes.length === 1 ? 'room' : 'rooms'}
        </TypeText>
      </View>

      {pricing && pricing.suggestedCount > 0 ? (
        <Card>
          <TypeText role="body" tone="warn">
            {pricing.suggestedCount} suggested{' '}
            {pricing.suggestedCount === 1 ? 'line is' : 'lines are'} waiting on you.
            Suggestions are not in the total until you accept them.
          </TypeText>
        </Card>
      ) : null}

      {aiNote ? (
        <Card>
          <TypeText role="caption" tone="textMuted">
            {aiNote}
          </TypeText>
        </Card>
      ) : null}

      {unpriced.length > 0 ? (
        <Card>
          <TypeText role="body" tone="warn">
            {unpriced.length} proposed {unpriced.length === 1 ? 'item' : 'items'} had
            no price in your list and were left out:{' '}
            {unpriced.map((l) => l.code).join(', ')}.
          </TypeText>
          <Button label="Open price list" variant="secondary" onPress={() => router.push('/prices')} />
        </Card>
      ) : null}

      {scopes.map((entry) => {
        const isOpen = expanded.has(entry.room.id);
        const roomTotal = entry.lines
          .filter((l) => l.status === 'accepted')
          .reduce(
            (sum, l) =>
              sum + Math.round(l.qty * (1 + l.wastePct / 100) * (l.materialUnitCents + l.laborUnitCents)),
            0,
          );

        return (
          <View
            key={entry.room.id}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(entry.room.id)) next.delete(entry.room.id);
                  else next.add(entry.room.id);
                  return next;
                })
              }
              style={styles.cardHeader}
            >
              <View style={styles.cardHeaderMain}>
                <TypeText role="heading">{entry.room.name}</TypeText>
                <TypeText role="caption" tone="textFaint">
                  {entry.lines.length} {entry.lines.length === 1 ? 'line' : 'lines'}
                  {entry.materials.length > 0 ? ` · ${entry.materials.length} wet materials` : ''}
                </TypeText>
              </View>
              <TypeText role="bodyStrong">{formatUsd(roomTotal)}</TypeText>
            </Pressable>

            {isOpen ? (
              <>
                {entry.lines.length === 0 ? (
                  <TypeText role="caption" tone="textFaint">
                    Nothing scoped yet.
                  </TypeText>
                ) : (
                  entry.lines.map((line) => (
                    <View key={line.id} style={[styles.line, { borderBottomColor: c.border }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${line.code}`}
                        onPress={() => router.push(`/job/${jobId}/line?lineId=${line.id}`)}
                        style={({ pressed }) => [styles.lineMain, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        <TypeText role="bodyStrong">{line.code}</TypeText>
                        <TypeText role="caption" tone="textMuted">
                          {line.description}
                        </TypeText>
                        <TypeText role="caption" tone="textFaint">
                          {line.qty} {line.unit}
                          {line.wastePct > 0 ? ` + ${line.wastePct}% waste` : ''}
                          {' · '}
                          {formatUsd(line.materialUnitCents + line.laborUnitCents)}/{line.unit}
                        </TypeText>
                        {line.note ? (
                          <TypeText role="caption" tone="textFaint">
                            {line.note}
                          </TypeText>
                        ) : null}
                      </Pressable>

                      <View style={styles.lineActions}>
                        <TypeText role="bodyStrong">
                          {formatUsd(
                            Math.round(
                              line.qty *
                                (1 + line.wastePct / 100) *
                                (line.materialUnitCents + line.laborUnitCents),
                            ),
                          )}
                        </TypeText>
                        {line.status === 'suggested' ? (
                          <>
                            <View style={[styles.badge, { backgroundColor: c.warnSoft }]}>
                              <TypeText role="caption" tone="warn">
                                {line.origin === 'ai' && line.aiConfidence !== null
                                  ? `AI ${Math.round(line.aiConfidence * 100)}%`
                                  : 'suggested'}
                              </TypeText>
                            </View>
                            <Button
                              label="Accept"
                              variant="secondary"
                              onPress={() =>
                                void (async () => {
                                  const db = await openLocalDatabase();
                                  await setLineItemStatus(db, line.id, 'accepted');
                                  await refresh();
                                })()
                              }
                            />
                          </>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}

                <Button
                  label={entry.lines.length > 0 ? 'Re-scope from damage' : 'Scope this room'}
                  variant="secondary"
                  onPress={() => void scopeRoom(entry)}
                />
                <Button
                  label={aiBusy === entry.room.id ? 'Asking…' : 'Suggest what I missed'}
                  variant="ghost"
                  onPress={() => void suggestMore(entry)}
                  disabled={aiBusy !== null}
                />
                {entry.materials.length === 0 ? (
                  <TypeText role="caption" tone="textFaint">
                    Record what got wet on the damage sheet first — the scope
                    follows from it.
                  </TypeText>
                ) : null}
              </>
            ) : null}
          </View>
        );
      })}

      {totals && hasScope ? (
        <Card>
          <Label>Totals</Label>
          <QuantityRow label="Line items" value={formatUsd(totals.lineSubtotalCents)} unit="" />
          <QuantityRow
            label={`Overhead and profit, ${totals.opPct}%`}
            value={formatUsd(totals.opCents)}
            unit=""
          />
          <QuantityRow
            label={`Tax, ${totals.taxPct}% on ${totals.taxBase}`}
            value={formatUsd(totals.taxCents)}
            unit=""
          />
          <QuantityRow label="Replacement cost (RCV)" value={formatUsd(totals.rcvCents)} unit="" emphasis />
          <QuantityRow label="Depreciation" value={formatUsd(-totals.depreciationCents)} unit="" />
          <QuantityRow label="Actual cash value (ACV)" value={formatUsd(totals.acvCents)} unit="" emphasis />
          <QuantityRow label="Deductible" value={formatUsd(-totals.deductibleCents)} unit="" />
          <QuantityRow label="Net claim" value={formatUsd(totals.netClaimCents)} unit="" emphasis />
          {totals.recoverableDepreciationCents > 0 ? (
            <TypeText role="caption" tone="textFaint">
              {formatUsd(totals.recoverableDepreciationCents)} of depreciation is
              recoverable on proof of completion.
            </TypeText>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function safeQuantities(
  room: RoomRecord,
  openings: Awaited<ReturnType<typeof listOpenings>>,
): RoomQuantities | null {
  try {
    return computeRoom({
      lengthIn: room.lengthIn,
      widthIn: room.widthIn,
      heightIn: room.heightIn,
      offsets: room.offsets,
      openings: toCoreOpenings(openings),
      floodCutHeightIn: room.floodCutHeightIn,
      ceilingMultiplier: room.ceilingMultiplier,
    });
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  cardHeaderMain: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1 },
  lineMain: { flex: 1, gap: 2 },
  lineActions: { alignItems: 'flex-end', gap: space.xs },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
});
