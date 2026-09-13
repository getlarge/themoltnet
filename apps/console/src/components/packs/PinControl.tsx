import {
  Button,
  ConfirmDialog,
  InlineNotice,
  Stack,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { getApiErrorDetail } from '../../api-error.js';
import { type DecayState, describeDecay } from '../../packs/decay.js';
import { usePinPack } from '../../packs/hooks.js';

export interface PinControlProps {
  packId: string;
  /**
   * The same `DecayState` the row's `DecayBadge` renders.
   *
   * Taking the state rather than a separate `pinned` boolean gives the badge
   * and the button one source, so a call site cannot render "Expires in 3 days"
   * beside "Unpin — let this pack expire".
   */
  state: DecayState;
}

/**
 * Names the deadline the server assigned when it unpinned the pack.
 *
 * The console does not know the deployment's retention window (#1858), so it
 * reads the deadline off the PATCH response rather than predicting it.
 */
function retentionSentence(expiresAt: string | null, now: Date): string {
  const decay = describeDecay({ pinned: false, expiresAt }, now);
  if (decay.kind !== 'expiring') {
    return 'It will be deleted when its retention window ends unless you pin it again.';
  }
  return decay.daysRemaining === 1
    ? 'It will be deleted a day from now unless you pin it again.'
    : `It will be deleted ${decay.daysRemaining} days from now unless you pin it again.`;
}

/**
 * Pin / unpin a context pack.
 *
 * This is the one act the console asks a human to perform on a pack, so the
 * label names the consequence rather than the verb alone, and unpinning — which
 * starts a deletion clock — is confirmed, then announces the deadline the
 * server chose.
 *
 * Callers pass only the pack id and its lifecycle state. `usePinPack` owns the
 * payload invariant: the API rejects an `expiresAt` sent against an
 * already-pinned row, so assembling the body here would put that trap back at
 * every call site.
 */
export function PinControl({ packId, state }: PinControlProps) {
  const pinned = state.kind === 'pinned';
  const pin = usePinPack();
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // The badge swaps silently, so the outcome is announced for anyone who
  // cannot see it (accessibility checklist item 8). The response, not the
  // (already refetched) row, is the source: it carries the server-assigned
  // deadline and says which way the toggle actually went.
  useEffect(() => {
    if (!pin.isSuccess) return;
    setAnnouncement(
      pin.data.pinned
        ? 'Pack pinned. It will not expire.'
        : 'Pack unpinned. ' + retentionSentence(pin.data.expiresAt, new Date()),
    );
  }, [pin.isSuccess, pin.data]);

  const submit = (next: boolean) => {
    if (pin.isPending) return;
    setAnnouncement('');
    pin.mutate({ packId, pinned: next });
  };

  return (
    <Stack gap={2}>
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={pinned}
        disabled={pin.isPending}
        onClick={() => {
          if (pin.isPending) return;
          if (pinned) {
            setConfirming(true);
            return;
          }
          submit(true);
        }}
      >
        {pinned
          ? 'Unpin — let this pack expire'
          : 'Pin — keep this pack past its expiry'}
      </Button>

      {/* Polite: the operator initiated this, so it should not interrupt. */}
      <span
        role="status"
        aria-live="polite"
        style={{
          border: 0,
          clip: 'rect(0 0 0 0)',
          height: '1px',
          margin: '-1px',
          overflow: 'hidden',
          padding: 0,
          position: 'absolute',
          whiteSpace: 'nowrap',
          width: '1px',
        }}
      >
        {announcement}
      </span>

      {pin.isError ? (
        <InlineNotice tone="error">
          {getApiErrorDetail(pin.error, 'Could not update the pin state.')}
        </InlineNotice>
      ) : null}

      <ConfirmDialog
        open={confirming}
        destructive
        title="Unpin this pack?"
        message="Unpinning schedules the pack for deletion once the retention window configured for this deployment ends. Pin it again before then to keep it."
        confirmLabel="Unpin"
        cancelLabel="Keep pinned"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          submit(false);
        }}
      />
    </Stack>
  );
}
