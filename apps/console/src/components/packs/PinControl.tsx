import { Button, InlineNotice, Stack } from '@themoltnet/design-system';

import { getApiErrorDetail } from '../../api-error.js';
import { usePinPack } from '../../packs/hooks.js';

export interface PinControlProps {
  packId: string;
  pinned: boolean;
}

/**
 * Pin / unpin a context pack.
 *
 * This is the one act the console asks a human to perform on a pack, so the
 * label names the consequence rather than the verb alone.
 *
 * Callers pass only `pinned`. `usePinPack` owns the payload invariant — the
 * API rejects `{ pinned: false }` without an `expiresAt`, and rejects an
 * `expiresAt` sent against an already-pinned row — so assembling the body here
 * would put that trap back at every call site.
 */
export function PinControl({ packId, pinned }: PinControlProps) {
  const pin = usePinPack();

  return (
    <Stack gap={2}>
      <Button
        variant="secondary"
        size="sm"
        disabled={pin.isPending}
        onClick={() => {
          if (pin.isPending) return;
          pin.mutate({ packId, pinned: !pinned });
        }}
      >
        {pinned
          ? 'Unpin — let this pack expire'
          : 'Pin — keep this pack past its expiry'}
      </Button>
      {pin.isError ? (
        <InlineNotice tone="error">
          {getApiErrorDetail(pin.error, 'Could not update the pin state.')}
        </InlineNotice>
      ) : null}
    </Stack>
  );
}
