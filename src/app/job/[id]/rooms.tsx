/**
 * The rooms on a job, as names.
 *
 * In the photo workflow a room is a label for photos — the sketch and the
 * measurements live in Xactimate. So adding one is a tap on a common name or
 * a few typed letters, and several can be added in one visit before walking
 * the house.
 */

import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Label, Screen, TextField, TypeText } from '@/components/ui';
import { openLocalDatabase } from '@/db/client';
import { addNamedRoom, listRooms, type RoomRecord } from '@/db/rooms';
import { currentCompanyId } from '@/features/jobs/useCompany';
import { COMMON_ROOM_NAMES } from '@/features/rooms/wizard';
import { newId } from '@/lib/id';
import { goBack } from '@/lib/navigation';
import { space } from '@/theme/tokens';

/** What a photo set needs beyond the rooms of a house. */
const OTHER_AREAS = ['Exterior', 'Roof', 'Attic', 'Crawlspace', 'Utility Room', 'Stairway'];

export default function RoomsScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [custom, setCustom] = useState('');

  const load = useCallback(async () => {
    const db = await openLocalDatabase();
    setRooms(await listRooms(db, jobId));
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const taken = useMemo(() => new Set(rooms.map((r) => r.name.toLowerCase())), [rooms]);

  const add = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || taken.has(trimmed.toLowerCase())) return;
      const db = await openLocalDatabase();
      await addNamedRoom(db, {
        id: newId(),
        companyId: currentCompanyId(),
        jobId,
        name: trimmed,
        sortOrder: rooms.length,
      });
      setCustom('');
      await load();
    },
    [jobId, load, rooms.length, taken],
  );

  const suggestions = [...COMMON_ROOM_NAMES, ...OTHER_AREAS].filter(
    (name) => !taken.has(name.toLowerCase()),
  );

  return (
    <Screen footer={<Button label="Done" onPress={() => goBack(`/job/${jobId}`)} />}>
      <View style={styles.header}>
        <TypeText role="title">Rooms</TypeText>
        <TypeText role="caption" tone="textFaint">
          Tap every room you will photograph. Photos are named after the room
          they are taken in.
        </TypeText>
      </View>

      {rooms.length > 0 ? (
        <Card>
          <Label>On this job</Label>
          <View style={styles.chips}>
            {rooms.map((room) => (
              <Chip key={room.id} label={room.name} selected onPress={() => undefined} />
            ))}
          </View>
        </Card>
      ) : null}

      <View style={styles.section}>
        <Label>Add</Label>
        <View style={styles.chips}>
          {suggestions.map((name) => (
            <Chip key={name} label={name} onPress={() => void add(name)} />
          ))}
        </View>
      </View>

      <TextField
        label="Another room"
        placeholder="e.g. Bonus Room"
        autoCapitalize="words"
        value={custom}
        onChangeText={setCustom}
      />
      <Button
        label="Add this room"
        variant="secondary"
        onPress={() => void add(custom)}
        disabled={!custom.trim() || taken.has(custom.trim().toLowerCase())}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
