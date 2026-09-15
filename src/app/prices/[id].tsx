/**
 * The price item editor.
 *
 * Handles both a new item and an existing one — `/prices/new` or
 * `/prices/<id>`. Contractors adjust these numbers constantly, so the unit
 * price updates live and the material/labor split is shown rather than hidden,
 * because it is the thing that decides whether tax comes out right.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Chip, InlineField, Label, Screen, TypeText } from '@/components/ui';
import { formatUsd } from '@/core/units';
import { openLocalDatabase } from '@/db/client';
import {
  getPriceItem,
  getPriceItemByCode,
  savePriceItem,
  softDeletePriceItem,
} from '@/db/price-items';
import { currentCompanyId } from '@/features/jobs/useCompany';
import {
  centsToInput,
  derivePriceForm,
  emptyPriceForm,
  type PriceFormValues,
} from '@/features/pricing/forms';
import { newId } from '@/lib/id';
import { radius, space, type } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const UNITS = ['SF', 'LF', 'SY', 'EA', 'DA', 'HR', 'CF'] as const;

export default function PriceEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [values, setValues] = useState<PriceFormValues>(emptyPriceForm());
  const [loaded, setLoaded] = useState(isNew);
  const [isSeed, setIsSeed] = useState(false);
  const [codeTaken, setCodeTaken] = useState(false);
  const c = useTheme();

  useEffect(() => {
    if (isNew) return;
    void (async () => {
      const db = await openLocalDatabase();
      const item = await getPriceItem(db, id);
      if (item) {
        setValues({
          code: item.code,
          description: item.description,
          unit: item.unit,
          category: item.category ?? '',
          materialText: centsToInput(item.materialCostCents),
          laborText: centsToInput(item.laborCostCents),
          wastePctText: String(item.wastePct),
          usefulLifeText: item.usefulLifeYears !== null ? String(item.usefulLifeYears) : '',
        });
        setIsSeed(item.isSeed);
      }
      setLoaded(true);
    })();
  }, [id, isNew]);

  const state = useMemo(() => derivePriceForm(values), [values]);

  const set = <K extends keyof PriceFormValues>(key: K, value: PriceFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  // A duplicate code is only knowable against the database, so it is checked
  // as the code is typed rather than discovered on save.
  useEffect(() => {
    if (!state.normalizedCode) {
      setCodeTaken(false);
      return;
    }
    let active = true;
    void (async () => {
      const db = await openLocalDatabase();
      const existing = await getPriceItemByCode(db, currentCompanyId(), state.normalizedCode);
      if (active) setCodeTaken(Boolean(existing) && existing?.id !== id);
    })();
    return () => {
      active = false;
    };
  }, [id, state.normalizedCode]);

  const save = useCallback(async () => {
    if (!state.canSave || codeTaken) return;
    const db = await openLocalDatabase();
    await savePriceItem(db, {
      id: isNew ? newId() : id,
      companyId: currentCompanyId(),
      code: state.normalizedCode,
      description: values.description.trim(),
      unit: values.unit.trim().toUpperCase(),
      category: values.category.trim() || null,
      materialCostCents: state.materialCostCents,
      laborCostCents: state.laborCostCents,
      wastePct: state.wastePct,
      usefulLifeYears: state.usefulLifeYears,
      // Editing a seed row makes it the contractor's own.
      isSeed: false,
    });
    router.back();
  }, [codeTaken, id, isNew, state, values]);

  const remove = useCallback(async () => {
    const db = await openLocalDatabase();
    await softDeletePriceItem(db, id);
    router.back();
  }, [id]);

  if (!loaded) return null;

  return (
    <Screen
      footer={
        <>
          <Button
            testID="save-price"
            label={state.canSave && !codeTaken ? 'Save' : 'Fill in the required fields'}
            onPress={() => void save()}
            disabled={!state.canSave || codeTaken}
          />
          {!isNew ? (
            <Button label="Delete" variant="danger" onPress={() => void remove()} />
          ) : null}
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">{isNew ? 'New price item' : state.normalizedCode || 'Price item'}</TypeText>
        <TypeText role="caption" tone="textFaint">
          {formatUsd(state.unitPriceCents)} per {values.unit || '—'}
        </TypeText>
      </View>

      {isSeed ? (
        <Card>
          <TypeText role="caption" tone="warn">
            This is a generic starting price, not pricing for your area. Saving
            it makes it yours.
          </TypeText>
        </Card>
      ) : null}

      <View style={styles.section}>
        <Label>Code</Label>
        <TextInput
          value={values.code}
          onChangeText={(next) => set('code', next)}
          placeholder="FCC-CPT"
          placeholderTextColor={c.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[
            type.bodyStrong as never,
            styles.input,
            {
              backgroundColor: c.surface,
              borderColor: state.errors.code || codeTaken ? c.danger : c.border,
              color: c.text,
            },
          ]}
        />
        {state.errors.code ? (
          <TypeText role="caption" tone="danger">
            {state.errors.code}
          </TypeText>
        ) : codeTaken ? (
          <TypeText role="caption" tone="danger">
            Another item already uses this code.
          </TypeText>
        ) : null}
      </View>

      <View style={styles.section}>
        <Label>Description</Label>
        <TextInput
          value={values.description}
          onChangeText={(next) => set('description', next)}
          placeholder="Carpet with pad, replace"
          placeholderTextColor={c.textFaint}
          style={[
            type.body as never,
            styles.input,
            {
              backgroundColor: c.surface,
              borderColor: state.errors.description ? c.danger : c.border,
              color: c.text,
            },
          ]}
        />
      </View>

      <View style={styles.section}>
        <Label>Unit</Label>
        <View style={styles.chipRow}>
          {UNITS.map((unit) => (
            <Chip
              key={unit}
              label={unit}
              selected={values.unit.toUpperCase() === unit}
              onPress={() => set('unit', unit)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Label>Category</Label>
        <TextInput
          value={values.category}
          onChangeText={(next) => set('category', next)}
          placeholder="Flooring"
          placeholderTextColor={c.textFaint}
          style={[
            type.body as never,
            styles.input,
            { backgroundColor: c.surface, borderColor: c.border, color: c.text },
          ]}
        />
      </View>

      <Card>
        <Label>Cost per {values.unit || 'unit'}</Label>
        <InlineField
          testID="material-cost"
          label="Material"
          value={values.materialText}
          onChangeText={(next) => set('materialText', next)}
          placeholder="3.20"
          error={state.errors.materialCost}
        />
        <InlineField
          testID="labor-cost"
          label="Labor"
          value={values.laborText}
          onChangeText={(next) => set('laborText', next)}
          placeholder="0.90"
          error={state.errors.laborCost}
        />
        <View style={[styles.totalRow, { borderTopColor: c.border }]}>
          <TypeText role="bodyStrong">Unit price</TypeText>
          <TypeText role="bodyStrong">{formatUsd(state.unitPriceCents)}</TypeText>
        </View>
        {state.unsplit ? (
          <TypeText role="caption" tone="warn">
            All of this price is labor, so sales tax on it will read as zero.
            Split it if part of it is material.
          </TypeText>
        ) : null}
      </Card>

      <Card>
        <Label>Optional</Label>
        <InlineField
          testID="waste"
          label="Waste"
          value={values.wastePctText}
          onChangeText={(next) => set('wastePctText', next)}
          placeholder="10"
          suffix="%"
          error={state.errors.wastePct}
        />
        <InlineField
          testID="useful-life"
          label="Useful life"
          value={values.usefulLifeText}
          onChangeText={(next) => set('usefulLifeText', next)}
          placeholder="10"
          suffix="yr"
          error={state.errors.usefulLife}
        />
        <TypeText role="caption" tone="textFaint">
          Waste is added to the quantity when this item is used. Useful life is
          what depreciation is worked out against — leave it empty for labor and
          equipment, which do not depreciate.
        </TypeText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: space.md,
    borderTopWidth: 1,
  },
});
