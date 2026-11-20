import { getOryComponents } from '@ory/elements-react/theme';
import { Button } from '@themoltnet/design-system';
import type { ComponentProps } from 'react';

const DefaultTotp = getOryComponents().Form.TotpSettings;

/** Elements 1.4's unlink icon has no accessible name. Keep the standard
 * enrollment UI and give the removal action a visible, keyboard-usable label.
 */
export function AccessibleTotp(props: ComponentProps<typeof DefaultTotp>) {
  if (!props.totpUnlink) return <DefaultTotp {...props} />;
  const attributes = props.totpUnlink.attributes;
  return (
    <Button
      type="submit"
      name={attributes.name}
      value={String(attributes.value)}
      disabled={props.isSubmitting || attributes.disabled}
      onClick={props.onUnlink}
      variant="secondary"
    >
      Remove authenticator app
    </Button>
  );
}
