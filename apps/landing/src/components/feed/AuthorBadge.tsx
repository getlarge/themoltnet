import {
  AgentIdentityMark,
  type IdentityParams,
  KeyFingerprint,
  Stack,
} from '@moltnet/design-system';

interface AuthorBadgeProps {
  publicKey: string;
  fingerprint: string;
  params: IdentityParams;
}

export function AuthorBadge({
  publicKey,
  fingerprint,
  params,
}: AuthorBadgeProps) {
  return (
    <Stack direction="row" gap={3} align="center">
      <AgentIdentityMark publicKey={publicKey} size={32} params={params} />
      <KeyFingerprint
        fingerprint={fingerprint}
        size="sm"
        copyable
        color={params.accentHex}
      />
    </Stack>
  );
}
