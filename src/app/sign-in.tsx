/**
 * Signing in.
 *
 * A six-digit code rather than a tappable link. A link has to survive whichever
 * browser the mail app chooses, come back through a custom URL scheme, and land
 * in the right app instance. A code works from any device and any mail client —
 * including when the email arrives on a laptop and the app is on a phone, which
 * is most of the time.
 *
 * This is the only screen in ScopeFlow that needs signal, and it says so.
 */

import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Label, Screen, TypeText } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { checkAuthForm, normalizeOtp, OTP_LENGTH } from '@/features/auth/session';
import { radius, space, type } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function SignInScreen() {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const c = useTheme();

  const checks = useMemo(() => checkAuthForm({ email, code, step }), [code, email, step]);

  const send = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await sendCode(email);
      setStep('code');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [email, sendCode]);

  const verify = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await verifyCode(email, code);
      router.replace('/');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [code, email, verifyCode]);

  return (
    <Screen
      footer={
        step === 'email' ? (
          <Button
            testID="send-code"
            label={busy ? 'Sending…' : 'Email me a code'}
            onPress={() => void send()}
            disabled={!checks.canSendCode || busy}
          />
        ) : (
          <>
            <Button
              testID="verify-code"
              label={busy ? 'Checking…' : 'Sign in'}
              onPress={() => void verify()}
              disabled={!checks.canVerify || busy}
            />
            <Button
              label="Use a different address"
              variant="ghost"
              onPress={() => {
                setStep('email');
                setCode('');
                setProblem(null);
              }}
            />
          </>
        )
      }
    >
      <View style={styles.header}>
        <TypeText role="display">ScopeFlow</TypeText>
        <TypeText role="body" tone="textMuted">
          Turn a walkthrough into a repair estimate before you leave the driveway.
        </TypeText>
      </View>

      {problem ? (
        <Card>
          <TypeText role="body" tone="danger">
            {problem}
          </TypeText>
        </Card>
      ) : null}

      {step === 'email' ? (
        <View style={styles.section}>
          <Label>Your email</Label>
          <TextInput
            testID="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@yourcompany.com"
            placeholderTextColor={c.textFaint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            inputMode="email"
            autoFocus
            style={[
              type.body as never,
              styles.input,
              {
                backgroundColor: c.surface,
                borderColor: checks.emailError ? c.danger : c.border,
                color: c.text,
              },
            ]}
          />
          {checks.emailError ? (
            <TypeText role="caption" tone="danger">
              {checks.emailError}
            </TypeText>
          ) : (
            <TypeText role="caption" tone="textFaint">
              No password to remember. We send a six-digit code.
            </TypeText>
          )}
        </View>
      ) : (
        <View style={styles.section}>
          <Label>The code we sent to {email}</Label>
          <TextInput
            testID="code"
            value={code}
            onChangeText={(next) => setCode(normalizeOtp(next))}
            placeholder="123456"
            placeholderTextColor={c.textFaint}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={OTP_LENGTH}
            autoFocus
            style={[
              type.numeric as never,
              styles.codeInput,
              { backgroundColor: c.surface, borderColor: c.border, color: c.text },
            ]}
          />
          <TypeText role="caption" tone="textFaint">
            It can take a minute to arrive. Check spam if it does not.
          </TypeText>
          <Button
            label="Send another code"
            variant="ghost"
            onPress={() => void send()}
            disabled={busy}
          />
        </View>
      )}

      <Card>
        <Label>Why this is the only screen that needs signal</Label>
        <TypeText role="caption" tone="textMuted">
          Signing in is the one thing ScopeFlow cannot do offline. Everything
          after it — measuring, photographing, scoping, pricing, printing an
          estimate — works in a basement with no bars and syncs when you get back
          to the truck.
        </TypeText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.sm, marginTop: space.xl },
  section: { gap: space.xs },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  codeInput: {
    minHeight: 64,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    letterSpacing: 8,
    textAlign: 'center',
  },
});
