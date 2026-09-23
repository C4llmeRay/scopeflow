/**
 * Where a job is, and the only moves it can actually make.
 *
 * The allowed moves come from JOB_STATUS_FLOW rather than from a list typed out
 * here, so the screen cannot offer a transition the repository would refuse. A
 * closed job shows no moves at all, which is the point of it being closed.
 */

import { StyleSheet, View } from 'react-native';

import { Button, Chip, Label, TypeText } from '../../components/ui';
import { JOB_STATUS_FLOW, JOB_STATUS_LABELS, type JobStatus } from '../../db/jobs';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';

/** What moving to each status means, in the words a contractor would use. */
const MOVE_LABELS: Partial<Record<JobStatus, string>> = {
  inspecting: 'Back to inspecting',
  estimating: 'Back to estimating',
  sent: 'Mark sent',
  approved: 'Carrier approved it',
  closed: 'Close the job',
  lost: 'Mark lost',
};

const TONE: Record<JobStatus, 'accent' | 'success' | 'warn' | 'danger'> = {
  inspecting: 'accent',
  estimating: 'accent',
  sent: 'warn',
  approved: 'success',
  closed: 'success',
  lost: 'danger',
};

export interface JobStatusBarProps {
  status: JobStatus;
  onChange: (next: JobStatus) => void;
  /** Disabled while a move is being written. */
  busy?: boolean;
}

export function JobStatusBar({ status, onChange, busy }: JobStatusBarProps) {
  const c = useTheme();
  const moves = JOB_STATUS_FLOW[status];

  const soft = {
    accent: c.accentSoft,
    success: c.successSoft,
    warn: c.warnSoft,
    danger: c.dangerSoft,
  }[TONE[status]];

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Label>Status</Label>
        <View style={[styles.pill, { backgroundColor: soft }]}>
          <TypeText role="caption" tone={TONE[status]}>
            {JOB_STATUS_LABELS[status]}
          </TypeText>
        </View>
      </View>

      {moves.length === 0 ? (
        <TypeText role="caption" tone="textFaint">
          This job is closed. Its estimates and photographs stay on the record.
        </TypeText>
      ) : (
        <View style={styles.moves}>
          {moves.map((next) => (
            <Chip
              key={next}
              label={
                status === 'inspecting' && next === 'estimating'
                  ? 'Start estimating'
                  : (MOVE_LABELS[next] ?? JOB_STATUS_LABELS[next])
              }
              onPress={() => {
                if (!busy) onChange(next);
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * A closing prompt for a job whose carrier has approved it. Closing is the last
 * move a job makes, so it asks rather than offering a bare chip alongside the
 * others.
 */
export function CloseJobPrompt({ onClose, busy }: { onClose: () => void; busy?: boolean }) {
  return (
    <View style={styles.prompt}>
      <TypeText role="body" tone="textMuted">
        Work is approved. Close the job once it is finished and the recoverable
        depreciation has been released.
      </TypeText>
      <Button label={busy ? 'Closing…' : 'Close the job'} variant="secondary" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pill: { paddingHorizontal: space.md, paddingVertical: 2, borderRadius: radius.pill },
  moves: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  prompt: { gap: space.sm },
});
