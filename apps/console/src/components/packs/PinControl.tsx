import {
  Button,
  ConfirmDialog,
  InlineNotice,
  Stack,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { getApiErrorDetail } from '../../api-error.js';
import { getConfig } from '../../config.js';
import type { DecayState } from '../../packs/decay.js';
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

function retentionSentence(days: number): string {
  return days === 1
    ? 'It will be deleted a day from now unless you pin it again.'
    : `It will be deleted ${days} days from now unless you pin it again.`;
}

/**
 * Pin / unpin a context pack.
 *
 * This is the one act the console asks a human to perform on a pack, so the
 * label names the consequence rather than the verb alone, and unpinning — which
 * starts a deletion clock — is confirmed and states the resulting deadline.
 *
 * Callers pass only the pack id and its lifecycle state. `usePinPack` owns the
 * payload invariant: the API rejects `{ pinned: false }` without an `expiresAt`
 * and rejects an `expiresAt` sent against an already-pinned row, so assembling
 * the body here would put that trap back at every call site.
 */
export function PinControl({ packId, state }: PinControlProps) {
  const pinned = state.kind === 'pinned';
  const pin = usePinPack();
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const ttlDays = getConfig().packGcTtlDays;

  // The badge swaps silently, so the outcome is announced for anyone who
  // cannot see it (accessibility checklist item 8).
  useEffect(() => {
    if (pin.isSuccess) {
      setAnnouncement(
        pinned
          ? 'Pack unpinned. ' + retentionSentence(ttlDays)
          : 'Pack pinned. It will not expire.',
      );
    }
  }, [pin.isSuccess, pinned, ttlDays]);

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
        message={`Unpinning schedules the pack for deletion. ${retentionSentence(ttlDays)}`}
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
