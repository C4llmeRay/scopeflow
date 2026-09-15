/**
 * The price list.
 *
 * A contractor's own numbers. Seed rows are marked as a starting point, because
 * shipping a price and letting someone assume it is regional pricing is how you
 * lose their trust on the first job.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Label, Screen, TypeText } from '@/components/ui';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import {
  countPriceItems,
  listPriceItems,
  seedPriceListIfEmpty,
  unitPriceCents,
  type PriceItemRecord,
} from '@/db/price-items';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { newId } from '@/lib/id';
import { radius, space, type } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function PriceListScreen() {
  const [items, setItems] = useState<PriceItemRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const c = useTheme();

  const refresh = useCallback(
    async (query: string) => {
      const db = await openLocalDatabase();
      const [rows, count] = await Promise.all([
        listPriceItems(db, currentCompanyId(), query),
        countPriceItems(db, currentCompanyId()),
      ]);
      setItems(rows);
      setTotal(count);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh(search);
    }, [refresh, search]),
  );

  const installSeed = useCallback(async () => {
    const db = await openLocalDatabase();
    await seedPriceListIfEmpty(db, currentCompanyId(), newId);
    await refresh(search);
  }, [refresh, search]);

  const seedCount = items.filter((i) => i.isSeed).length;

  return (
    <Screen
      footer={
        <>
          <Button label="New item" onPress={() => router.push('/prices/new')} />
          <Button
            label="Import a price list"
            variant="secondary"
            onPress={() => router.push('/prices/import')}
          />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Price list</TypeText>
        <TypeText role="caption" tone="textFaint">
          {total} {total === 1 ? 'item' : 'items'}
        </TypeText>
      </View>

      {total === 0 ? (
        <Card>
          <TypeText role="heading">Nothing priced yet</TypeText>
          <TypeText role="body" tone="textMuted">
            Import your own spreadsheet — that is what you should scope against.
            Or start from a generic water-damage list and edit it.
          </TypeText>
          <Button label="Start from the generic list" variant="secondary" onPress={() => void installSeed()} />
        </Card>
      ) : (
        <>
          <TextInput
            value={search}
            onChangeText={(next) => {
              setSearch(next);
              void refresh(next);
            }}
            placeholder="Search code, description or category"
            placeholderTextColor={c.textFaint}
            style={[
              type.body as never,
              styles.search,
              { backgroundColor: c.surface, borderColor: c.border, color: c.text },
            ]}
          />

          {seedCount > 0 ? (
            <Card>
              <TypeText role="caption" tone="warn">
                {seedCount} of these are generic starting prices, not pricing for
                your area. Edit them or import your own before you send an estimate.
              </TypeText>
            </Card>
          ) : null}

          <View style={styles.list}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => router.push(`/prices/${item.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.rowMain}>
                  <View style={styles.rowTop}>
                    <TypeText role="bodyStrong">{item.code}</TypeText>
                    {item.isSeed ? (
                      <View style={[styles.badge, { backgroundColor: c.warnSoft }]}>
                        <TypeText role="caption" tone="warn">
                          generic
                        </TypeText>
                      </View>
                    ) : null}
                  </View>
                  <TypeText role="caption" tone="textMuted">
                    {item.description}
                  </TypeText>
                  <TypeText role="caption" tone="textFaint">
                    {item.category ?? 'Uncategorised'}
                    {item.wastePct > 0 ? ` · ${item.wastePct}% waste` : ''}
                  </TypeText>
                </View>

                <View style={styles.rowPrice}>
                  <TypeText role="bodyStrong">{formatUsd(unitPriceCents(item))}</TypeText>
                  <TypeText role="caption" tone="textFaint">
                    per {item.unit}
                  </TypeText>
                  {item.materialCostCents === 0 && item.laborCostCents > 0 ? (
                    <TypeText role="caption" tone="warn">
                      no material split
                    </TypeText>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>

          {items.length === 0 ? (
            <Card>
              <Label>No match</Label>
              <TypeText role="body" tone="textMuted">
                Nothing in the list matches “{search}”.
              </TypeText>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 72,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowPrice: { alignItems: 'flex-end', gap: 2 },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
});
