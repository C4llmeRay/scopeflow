/**
 * Company settings.
 *
 * This is the letterhead on every estimate, which is why the screen leads with
 * what an adjuster needs in order to reply to the document rather than with
 * anything about the app. The warnings below the fields say what a missing
 * piece costs, instead of blocking a save over it — a contractor filling this
 * in on a Tuesday should not be stopped because they have not typed their
 * licence number yet.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Chip, InlineField, Label, NotesField, Screen, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { billingState, saveCompany } from '@/db/companies';
import { jobTimings } from '@/db/estimates';
import {
  ACCEPTANCE_FLOOR,
  acceptanceRates,
  describeAcceptance,
  FEATURE_LABELS,
  type FeatureAcceptance,
} from '@/features/ai/acceptance';
import { useAuth } from '@/features/auth/AuthProvider';
import { entitlement, type Entitlement } from '@/features/billing/entitlement';
import { pullBillingState } from '@/features/billing/sync';
import { timeToEstimate, type TimeToEstimate } from '@/features/metrics/time-to-estimate';
import { currentCompanyId, ensureCompany } from '@/features/jobs/useCompany';
import {
  companyFormFrom,
  deriveCompanyForm,
  emptyCompanyForm,
  type CompanyFormValues,
} from '@/features/settings/company-form';
import { radius, space, type } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function SettingsScreen() {
  const [values, setValues] = useState<CompanyFormValues>(emptyCompanyForm());
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiCeilingText, setAiCeilingText] = useState('5.00');
  const [acceptance, setAcceptance] = useState<FeatureAcceptance[]>([]);
  const [billing, setBilling] = useState<Entitlement | null>(null);
  const [speed, setSpeed] = useState<TimeToEstimate | null>(null);
  const { phase, email, signOut } = useAuth();
  const c = useTheme();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const db = await openLocalDatabase();
        const company = await ensureCompany(db);
        if (!active) return;
        // A brand new profile has an empty name; keep the prefilled defaults
        // rather than blanking the terms the contractor has not seen yet.
        setValues(company.name.trim() ? companyFormFrom(company) : emptyCompanyForm());
        setAiCeilingText((company.aiJobCeilingCents / 100).toFixed(2));
        setBilling(entitlement(billingState(company)));
        setAcceptance(await acceptanceRates(db, currentCompanyId()));
        setSpeed(timeToEstimate(await jobTimings(db, currentCompanyId())));
        setLoaded(true);

        // Then correct it from the server, because a subscription that started
        // or lapsed since the app was last open is not knowable from here.
        const fresh = await pullBillingState(db, currentCompanyId());
        if (active && fresh) setBilling(entitlement(billingState(fresh)));
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const state = useMemo(() => deriveCompanyForm(values), [values]);

  const set = <K extends keyof CompanyFormValues>(key: K, value: CompanyFormValues[K]) => {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const save = useCallback(async () => {
    if (!state.canSave) return;
    const db = await openLocalDatabase();
    await saveCompany(db, {
      id: currentCompanyId(),
      name: values.name.trim(),
      licenseNo: values.licenseNo.trim() || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      addressLine1: values.addressLine1.trim() || null,
      addressLine2: values.addressLine2.trim() || null,
      city: values.city.trim() || null,
      state: values.state.trim() || null,
      postalCode: values.postalCode.trim() || null,
      defaultOpPct: state.defaultOpPct,
      defaultTaxPct: state.defaultTaxPct,
      defaultTaxBase: values.defaultTaxBase,
      estimateTerms: values.estimateTerms.trim() || null,
      aiJobCeilingCents: Math.max(
        0,
        Math.round((Number(aiCeilingText.replace(/[^0-9.]/g, '')) || 0) * 100),
      ),
    });
    setSaved(true);
  }, [aiCeilingText, state, values]);

  const field = (
    label: string,
    key: keyof CompanyFormValues,
    placeholder: string,
    extra: { error?: string; keyboardType?: 'default' | 'email-address' | 'phone-pad' } = {},
  ) => (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        value={String(values[key])}
        onChangeText={(next) => set(key, next as CompanyFormValues[typeof key])}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        keyboardType={extra.keyboardType ?? 'default'}
        autoCapitalize={extra.keyboardType === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={false}
        style={[
          type.body as never,
          styles.input,
          {
            backgroundColor: c.surface,
            borderColor: extra.error ? c.danger : c.border,
            color: c.text,
          },
        ]}
      />
      {extra.error ? (
        <TypeText role="caption" tone="danger">
          {extra.error}
        </TypeText>
      ) : null}
    </View>
  );

  if (!loaded) return null;

  return (
    <Screen
      footer={
        <>
          <Button
            testID="save-company"
            label={saved ? 'Saved' : state.canSave ? 'Save' : 'Add your business name'}
            onPress={() => void save()}
            disabled={!state.canSave}
          />
          <Button label="Done" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.header}>
        <TypeText role="title">Your business</TypeText>
        <TypeText role="caption" tone="textFaint">
          This is the letterhead on every estimate you send.
        </TypeText>
      </View>

      {field('Business name', 'name', 'Harbor Restoration LLC', { error: state.errors.name })}
      {field('Licence number', 'licenseNo', 'TX-RC-118244')}
      {field('Phone', 'phone', '(512) 555-0142', { keyboardType: 'phone-pad' })}
      {field('Email', 'email', 'office@example.com', {
        keyboardType: 'email-address',
        error: state.errors.email,
      })}

      <Card>
        <Label>Address</Label>
        {field('Street', 'addressLine1', '4400 Shoal Creek Blvd')}
        {field('Suite or unit', 'addressLine2', 'Suite 200')}
        <View style={styles.row}>
          <View style={styles.rowWide}>{field('City', 'city', 'Austin')}</View>
          <View style={styles.rowNarrow}>{field('State', 'state', 'TX')}</View>
        </View>
        {field('Postal code', 'postalCode', '78756')}
      </Card>

      <Card>
        <Label>Defaults for a new job</Label>
        <InlineField
          testID="default-op"
          label="Overhead and profit"
          value={values.defaultOpPctText}
          onChangeText={(next) => set('defaultOpPctText', next)}
          suffix="%"
          error={state.errors.defaultOpPct}
        />
        <InlineField
          testID="default-tax"
          label="Sales tax"
          value={values.defaultTaxPctText}
          onChangeText={(next) => set('defaultTaxPctText', next)}
          suffix="%"
          error={state.errors.defaultTaxPct}
        />
        <View style={styles.field}>
          <Label>Tax applies to</Label>
          <View style={styles.chipRow}>
            <Chip
              label="Materials only"
              selected={values.defaultTaxBase === 'materials'}
              onPress={() => set('defaultTaxBase', 'materials')}
            />
            <Chip
              label="The whole subtotal"
              selected={values.defaultTaxBase === 'all'}
              onPress={() => set('defaultTaxBase', 'all')}
            />
          </View>
          <TypeText role="caption" tone="textFaint">
            Materials only in most places. Each job can override these.
          </TypeText>
        </View>
      </Card>

      <Card>
        <Label>Terms printed on an estimate</Label>
        <NotesField
          value={values.estimateTerms}
          onChangeText={(next) => set('estimateTerms', next)}
          placeholder="What the estimate covers, how long the prices hold, when work starts"
        />
      </Card>

      <Card>
        <Label>AI budget per job</Label>
        <InlineField
          testID="ai-ceiling"
          label="Stop after"
          value={aiCeilingText}
          onChangeText={(next) => {
            setSaved(false);
            setAiCeilingText(next);
          }}
          placeholder="5.00"
          suffix="$"
        />
        <TypeText role="caption" tone="textFaint">
          A twelve-room house costs one to three dollars of model time. This
          ceiling is not there to save that — it is there so a stuck retry
          cannot run overnight.
        </TypeText>
      </Card>

      <Card>
        <Label>How often you take the suggestions</Label>
        {acceptance.map((entry) => (
          <View key={entry.feature} style={styles.acceptanceRow}>
            <TypeText role="body" tone="textMuted">
              {FEATURE_LABELS[entry.feature]}
            </TypeText>
            <TypeText role="bodyStrong" tone={entry.belowFloor ? 'danger' : 'text'}>
              {describeAcceptance(entry)}
            </TypeText>
          </View>
        ))}
        {acceptance.some((entry) => entry.belowFloor) ? (
          <TypeText role="caption" tone="danger">
            Anything under {Math.round(ACCEPTANCE_FLOOR * 100)}% is costing you more
            time than it saves. Turn it off rather than tuning it forever.
          </TypeText>
        ) : (
          <TypeText role="caption" tone="textFaint">
            Suggestions you accept versus ones you remove. Under{' '}
            {Math.round(ACCEPTANCE_FLOOR * 100)}% means a feature is not earning
            its place.
          </TypeText>
        )}
      </Card>

      {speed ? (
        <Card>
          <Label>Time to estimate</Label>
          <TypeText role="body" tone={speed.medianMs === null ? 'textMuted' : 'success'}>
            {speed.label}
          </TypeText>
          <TypeText role="caption" tone="textFaint">
            {speed.medianMs === null
              ? 'Measured from starting a job to freezing its first estimate. This is the number that says whether ScopeFlow is earning its place.'
              : `Median across ${speed.sample} ${speed.sample === 1 ? 'job' : 'jobs'}` +
                (speed.unfinished > 0
                  ? `. ${speed.unfinished} ${speed.unfinished === 1 ? 'job has' : 'jobs have'} no estimate yet and are not counted.`
                  : '.')}
          </TypeText>
        </Card>
      ) : null}

      {billing ? (
      <Card>
        <Label>Subscription</Label>
        <TypeText role="body" tone={billing.urgent ? 'danger' : billing.shouldPrompt ? 'warn' : 'textMuted'}>
          {billing.message}
        </TypeText>
        <TypeText role="caption" tone="textFaint">
          Measuring, scoping and pricing never stop. Only sending does.
        </TypeText>
        <Button
          label={billing.canSendEstimates ? 'Manage subscription' : 'Subscribe'}
          variant={billing.canSendEstimates ? 'secondary' : 'primary'}
          onPress={() => router.push('/subscribe')}
        />
      </Card>
      ) : null}

      <Card>
        <Label>Signed in</Label>
        {phase === 'local' ? (
          <>
            <TypeText role="body" tone="warn">
              Running locally with no backend. Everything works and stays on this
              phone — nothing syncs until you sign in.
            </TypeText>
            <Button
              label="Sign in"
              variant="secondary"
              onPress={() => router.push('/sign-in')}
            />
          </>
        ) : (
          <>
            <TypeText role="body">{email ?? 'Signed in'}</TypeText>
            <TypeText role="caption" tone="textFaint">
              Signing out leaves everything on this phone. It comes back when you
              sign in again.
            </TypeText>
            <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
          </>
        )}
      </Card>

      {state.warnings.length > 0 ? (
        <Card>
          <Label>Worth filling in</Label>
          {state.warnings.map((warning) => (
            <TypeText key={warning} role="caption" tone="warn">
              {warning}
            </TypeText>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  field: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.md },
  rowWide: { flex: 2 },
  rowNarrow: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  acceptanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
});
