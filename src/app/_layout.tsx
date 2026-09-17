import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';

import { initObservability } from '@/lib/observability';
import { colors } from '@/theme/tokens';

// Before anything renders, so a crash during startup is still reported.
initObservability();

/**
 * The guard.
 *
 * Nothing renders until the stored session has been read, so a signed-in
 * contractor never sees the sign-in screen flash on the way to their jobs.
 * After that it is one rule: no session, no app — except in local mode, which
 * is what runs when no backend is configured at all.
 */
function Guarded({ children }: { children: React.ReactNode }) {
  const { phase } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const onSignIn = segments[0] === 'sign-in';

  useEffect(() => {
    if (phase === 'loading') return;
    if (phase === 'signed-out' && !onSignIn) router.replace('/sign-in');
    if (phase !== 'signed-out' && onSignIn) router.replace('/');
  }, [onSignIn, phase, router]);

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const c = colors[scheme];

  return (
    <AuthProvider>
      <Guarded>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: 'Jobs' }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Inspection' }} />
        <Stack.Screen
          name="job/[id]/room-wizard"
          options={{ title: 'Room', presentation: 'modal' }}
        />
        <Stack.Screen
          name="job/[id]/damage"
          options={{ title: 'Damage', presentation: 'modal' }}
        />
        <Stack.Screen name="job/[id]/notes" options={{ title: 'Voice notes' }} />
        <Stack.Screen name="job/[id]/sort" options={{ title: 'Sort photos' }} />
        <Stack.Screen name="job/[id]/estimate" options={{ title: 'Estimate' }} />
        <Stack.Screen name="job/[id]/send" options={{ title: 'Send' }} />
        <Stack.Screen name="prices" options={{ title: 'Price list' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="subscribe" options={{ title: 'Subscription' }} />
        <Stack.Screen name="start" options={{ title: 'Getting started' }} />
        <Stack.Screen
          name="prices/import"
          options={{ title: 'Import prices', presentation: 'modal' }}
        />
        <Stack.Screen
          name="prices/[id]"
          options={{ title: 'Price item', presentation: 'modal' }}
        />
        <Stack.Screen
          name="job/[id]/line"
          options={{ title: 'Line item', presentation: 'modal' }}
        />
        <Stack.Screen
          name="job/[id]/capture"
          options={{ title: 'Capture', headerShown: false, presentation: 'fullScreenModal' }}
        />
      </Stack>
      </Guarded>
    </AuthProvider>
  );
}
