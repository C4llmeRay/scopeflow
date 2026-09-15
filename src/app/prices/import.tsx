/**
 * Importing a contractor's price spreadsheet.
 *
 * Nothing is written until the contractor has seen what is about to happen:
 * which column the importer thinks is which, how many rows it could read, what
 * it had to skip and why, and how many prices arrived without a material/labor
 * split. Silent imports are how a price list ends up full of rows nobody can
 * explain.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Label, Screen, TypeText } from '@/components/ui';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import { applyPriceImport } from '@/db/price-items';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { importPriceList, type ImportResult, type PriceColumn } from '@/features/pricing/import';
import { newId } from '@/lib/id';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const COLUMN_LABELS: Record<PriceColumn, string> = {
  code: 'Code',
  description: 'Description',
  unit: 'Unit',
  category: 'Category',
  materialCost: 'Material cost',
  laborCost: 'Labor cost',
  unitCost: 'Unit cost',
  wastePct: 'Waste %',
  usefulLifeYears: 'Useful life',
};

export default function PriceImportScreen() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = useTheme();

  const pick = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    const text = await FileSystem.readAsStringAsync(asset.uri);
    setFileName(asset.name);
    setResult(importPriceList(text));
  }, []);

  const commit = useCallback(async () => {
    if (!result || result.items.length === 0) return;
    setBusy(true);
    try {
      const db = await openLocalDatabase();
      await applyPriceImport(db, currentCompanyId(), result.items, newId);
      router.back();
    } finally {
      setBusy(false);
    }
  }, [result]);

  const readable = result?.items.length ?? 0;

  return (
    <Screen
      footer={
        result ? (
          <>
            <Button
              label={busy ? 'Importing…' : `Import ${readable} ${readable === 1 ? 'item' : 'items'}`}
              onPress={() => void commit()}
              disabled={busy || readable === 0}
            />
            <Button label="Pick a different file" variant="ghost" onPress={() => void pick()} />
          </>
        ) : (
          <Button label="Choose a CSV file" onPress={() => void pick()} />
        )
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Import prices</TypeText>
        <TypeText role="caption" tone="textFaint">
          {fileName ?? 'A CSV export from your spreadsheet'}
        </TypeText>
      </View>

      {!result ? (
        <Card>
          <TypeText role="body" tone="textMuted">
            Export your price list as CSV. It needs a code, a description, a
            unit and a price. Separate material and labor columns are better —
            sales tax applies to materials only, so a single price cannot be
            taxed correctly.
          </TypeText>
        </Card>
      ) : (
        <>
          <Card>
            <Label>Columns found</Label>
            {Object.entries(result.mapping).length === 0 ? (
              <TypeText role="body" tone="danger">
                None. This file does not look like a price list.
              </TypeText>
            ) : (
              Object.entries(result.mapping).map(([column, index]) => (
                <View key={column} style={styles.mapRow}>
                  <TypeText role="body" tone="textMuted">
                    {COLUMN_LABELS[column as PriceColumn]}
                  </TypeText>
                  <TypeText role="bodyStrong">{result.headers[index as number]}</TypeText>
                </View>
              ))
            )}
          </Card>

          {result.unsplitCount > 0 ? (
            <Card>
              <TypeText role="body" tone="warn">
                {result.unsplitCount} {result.unsplitCount === 1 ? 'item has' : 'items have'} a
                single price with no material/labor split. They will be treated
                as all labor, so sales tax on them will read as zero until you
                split them.
              </TypeText>
            </Card>
          ) : null}

          {result.duplicateCodes.length > 0 ? (
            <Card>
              <TypeText role="body" tone="warn">
                {result.duplicateCodes.length} duplicate{' '}
                {result.duplicateCodes.length === 1 ? 'code' : 'codes'} — the last
                row in the file wins: {result.duplicateCodes.slice(0, 6).join(', ')}
                {result.duplicateCodes.length > 6 ? '…' : ''}
              </TypeText>
            </Card>
          ) : null}

          {result.problems.length > 0 ? (
            <Card>
              <Label>Skipped {result.problems.length}</Label>
              <ScrollView style={styles.problems} nestedScrollEnabled>
                {result.problems.slice(0, 40).map((problem) => (
                  <TypeText key={`${problem.line}-${problem.message}`} role="caption" tone="danger">
                    Line {problem.line}: {problem.message}
                  </TypeText>
                ))}
                {result.problems.length > 40 ? (
                  <TypeText role="caption" tone="textFaint">
                    …and {result.problems.length - 40} more
                  </TypeText>
                ) : null}
              </ScrollView>
            </Card>
          ) : null}

          <Card>
            <Label>Preview</Label>
            {result.items.slice(0, 8).map((item) => (
              <View key={item.code} style={[styles.previewRow, { borderBottomColor: c.border }]}>
                <View style={styles.previewMain}>
                  <TypeText role="bodyStrong">{item.code}</TypeText>
                  <TypeText role="caption" tone="textFaint">
                    {item.description}
                  </TypeText>
                </View>
                <View style={styles.previewPrice}>
                  <TypeText role="body">
                    {formatUsd(item.materialCostCents + item.laborCostCents)}
                  </TypeText>
                  <TypeText role="caption" tone="textFaint">
                    per {item.unit}
                  </TypeText>
                </View>
              </View>
            ))}
            {result.items.length > 8 ? (
              <TypeText role="caption" tone="textFaint">
                …and {result.items.length - 8} more
              </TypeText>
            ) : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  mapRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  problems: { maxHeight: 200 },
  previewRow: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderRadius: radius.sm,
  },
  previewMain: { flex: 1, gap: 2 },
  previewPrice: { alignItems: 'flex-end' },
});
