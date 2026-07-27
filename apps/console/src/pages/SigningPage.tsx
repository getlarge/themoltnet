import type { SigningCredential, SigningRequest } from '@moltnet/api-client';
import {
  Button,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import { useSigningController } from '../signing/useSigningController.js';
import { useTeam } from '../team/useTeam.js';

export function SigningPage() {
  const theme = useTheme();
  const { selectedTeam } = useTeam();
  const controller = useSigningController();
  const [label, setLabel] = useState('');
  const [reviewRequest, setReviewRequest] = useState<SigningRequest | null>(
    null,
  );
  const [reviewed, setReviewed] = useState(false);
  const activeCredentials = useMemo(
    () =>
      controller.credentials.filter(
        (credential) => credential.status === 'active',
      ),
    [controller.credentials],
  );
  const selectedCredential = activeCredentials[0];
  const isManager =
    selectedTeam?.role === 'owner' || selectedTeam?.role === 'manager';
  const disabled = controller.pendingAction !== null;

  function closeReview() {
    setReviewRequest(null);
    setReviewed(false);
  }

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text variant="h2">Signing</Text>
        <Text color="muted">
          Review server-owned actions and approve them on your local security
          key.
        </Text>
      </Stack>

      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing[2],
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          border: `1px solid ${
            controller.companionStatus === 'connected'
              ? theme.color.success.DEFAULT
              : theme.color.border.DEFAULT
          }`,
          borderRadius: theme.radius.md,
          color:
            controller.companionStatus === 'connected'
              ? theme.color.success.DEFAULT
              : theme.color.text.muted,
          width: 'fit-content',
        }}
      >
        <span aria-hidden="true">
          {controller.companionStatus === 'connected' ? '●' : '○'}
        </span>
        {controller.companionStatus === 'connected'
          ? 'Companion connected'
          : controller.companionStatus === 'connecting'
            ? 'Connecting to companion'
            : 'Companion unavailable'}
      </div>

      {controller.error ? (
        <div
          role="alert"
          style={{
            padding: theme.spacing[3],
            border: `1px solid ${theme.color.error.DEFAULT}`,
            borderRadius: theme.radius.md,
            background: theme.color.bg.surface,
          }}
        >
          <Text>{controller.error}</Text>
        </div>
      ) : null}

      <section aria-labelledby="requests-heading">
        <Stack gap={4}>
          <Stack direction="row" align="center" justify="space-between">
            <div>
              <div id="requests-heading">
                <Text variant="h3">Signable requests</Text>
              </div>
              <Text color="muted">
                The exact action and expiry are fixed by the server.
              </Text>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void controller.refresh()}
            >
              Refresh
            </Button>
          </Stack>

          {controller.isLoading ? (
            <Text color="muted">Loading signing requests…</Text>
          ) : controller.requests.length === 0 ? (
            <Text color="muted">
              No requests currently need your signature.
            </Text>
          ) : (
            <div
              style={{
                borderTop: `1px solid ${theme.color.border.DEFAULT}`,
              }}
            >
              {controller.requests.map((request) => (
                <article
                  key={request.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(170px, auto)',
                    gap: theme.spacing[5],
                    padding: `${theme.spacing[5]} 0`,
                    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                  }}
                >
                  <Stack gap={3}>
                    <Text
                      style={{
                        fontSize: theme.font.size.xl,
                        fontWeight: theme.font.weight.semibold,
                      }}
                    >
                      {request.purpose || 'Approve signing request'}
                    </Text>
                    <dl
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'max-content minmax(0, 1fr)',
                        gap: `${theme.spacing[1]} ${theme.spacing[4]}`,
                        margin: 0,
                      }}
                    >
                      <dt style={{ color: theme.color.text.muted }}>
                        Requester
                      </dt>
                      <dd style={{ margin: 0 }}>
                        {request.requestedBy?.id ?? request.agentId}
                      </dd>
                      <dt style={{ color: theme.color.text.muted }}>
                        Intended signer
                      </dt>
                      <dd style={{ margin: 0 }}>
                        {request.signerConstraint
                          ? `${request.signerConstraint.type}: ${request.signerConstraint.id}`
                          : 'Unspecified'}
                      </dd>
                      <dt style={{ color: theme.color.text.muted }}>Method</dt>
                      <dd style={{ margin: 0 }}>
                        {request.verificationMethod}
                      </dd>
                      <dt style={{ color: theme.color.text.muted }}>Status</dt>
                      <dd style={{ margin: 0 }}>{request.status}</dd>
                      <dt style={{ color: theme.color.text.muted }}>Expires</dt>
                      <dd style={{ margin: 0 }}>
                        <time dateTime={request.expiresAt}>
                          {formatDate(request.expiresAt)}
                        </time>
                      </dd>
                    </dl>
                  </Stack>
                  <Stack gap={2} justify="center">
                    <Button
                      disabled={
                        disabled ||
                        !selectedCredential ||
                        controller.companionStatus !== 'connected'
                      }
                      onClick={() => {
                        setReviewed(false);
                        setReviewRequest(request);
                      }}
                    >
                      Review and sign request
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        void controller.reject(request).catch(() => undefined)
                      }
                    >
                      Reject signing request
                    </Button>
                  </Stack>
                </article>
              ))}
            </div>
          )}
        </Stack>
      </section>

      <section aria-labelledby="credentials-heading">
        <Stack gap={4}>
          <div>
            <div id="credentials-heading">
              <Text variant="h3">Signing credentials</Text>
            </div>
            <Text color="muted">
              Enrollment and every signature require confirmation in the local
              signer.
            </Text>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = label.trim();
              if (!trimmed) return;
              void controller
                .enroll(trimmed)
                .then(() => setLabel(''))
                .catch(() => undefined);
            }}
            style={{
              display: 'flex',
              alignItems: 'end',
              gap: theme.spacing[3],
              maxWidth: 640,
            }}
          >
            <div style={{ flex: 1 }}>
              <Input
                label="Credential label"
                value={label}
                maxLength={255}
                placeholder="Deployment key"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={
                disabled ||
                !label.trim() ||
                controller.companionStatus !== 'connected'
              }
            >
              Enroll signing credential
            </Button>
          </form>

          {controller.credentials.length === 0 ? (
            <Text color="muted">No previewSign credentials enrolled.</Text>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr>
                    {['Label', 'Status', 'Method', 'Created', 'Actions'].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          style={{
                            padding: theme.spacing[3],
                            color: theme.color.text.muted,
                            borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                          }}
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {controller.credentials.map((credential) => (
                    <CredentialRow
                      key={credential.id}
                      credential={credential}
                      disabled={disabled}
                      isManager={isManager}
                      onApprove={() =>
                        void controller
                          .approve(credential)
                          .catch(() => undefined)
                      }
                      onSuspend={() =>
                        void controller
                          .suspend(credential)
                          .catch(() => undefined)
                      }
                      onRevoke={() =>
                        void controller
                          .revoke(credential)
                          .catch(() => undefined)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Stack>
      </section>

      <Dialog
        open={reviewRequest !== null}
        onClose={closeReview}
        title="Review server-owned action"
        width="620px"
      >
        {reviewRequest ? (
          <Stack gap={4}>
            <div>
              <Text color="muted">Exact action</Text>
              <p
                data-signing-action
                style={{
                  fontSize: theme.font.size.xl,
                  fontWeight: theme.font.weight.bold,
                  lineHeight: 1.4,
                  padding: theme.spacing[4],
                  margin: `${theme.spacing[2]} 0 0`,
                  border: `1px solid ${theme.color.primary.DEFAULT}`,
                  borderRadius: theme.radius.md,
                  background: theme.color.bg.surface,
                }}
              >
                {reviewRequest.purpose || 'Approve signing request'}
              </p>
            </div>
            <Text>
              Expires{' '}
              <time dateTime={reviewRequest.expiresAt}>
                {formatDate(reviewRequest.expiresAt)}
              </time>
            </Text>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: theme.spacing[2],
              }}
            >
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>I reviewed this exact action and its expiry.</span>
            </label>
            <Stack direction="row" gap={2} justify="flex-end">
              <Button variant="ghost" onClick={closeReview}>
                Cancel
              </Button>
              <Button
                disabled={!reviewed || !selectedCredential || disabled}
                onClick={() => {
                  if (!selectedCredential) return;
                  const request = reviewRequest;
                  closeReview();
                  void controller
                    .sign(request, selectedCredential.id)
                    .catch(() => undefined);
                }}
              >
                Sign exact action
              </Button>
            </Stack>
          </Stack>
        ) : null}
      </Dialog>
    </Stack>
  );
}

function CredentialRow({
  credential,
  disabled,
  isManager,
  onApprove,
  onSuspend,
  onRevoke,
}: {
  credential: SigningCredential;
  disabled: boolean;
  isManager: boolean;
  onApprove: () => void;
  onSuspend: () => void;
  onRevoke: () => void;
}) {
  const theme = useTheme();
  const cellStyle = {
    padding: theme.spacing[3],
    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
    verticalAlign: 'middle',
  } as const;
  return (
    <tr>
      <td style={cellStyle}>{credential.label}</td>
      <td style={cellStyle}>{credential.status.replace('_', ' ')}</td>
      <td style={cellStyle}>{credential.verificationMethod}</td>
      <td style={cellStyle}>{formatDate(credential.createdAt)}</td>
      <td style={cellStyle}>
        {isManager ? (
          <Stack direction="row" gap={1}>
            {credential.status === 'pending_approval' ? (
              <Button
                size="sm"
                disabled={disabled}
                onClick={onApprove}
                aria-label={`Approve ${credential.label}`}
              >
                Approve
              </Button>
            ) : null}
            {credential.status === 'active' ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={onSuspend}
                aria-label={`Suspend ${credential.label}`}
              >
                Suspend
              </Button>
            ) : null}
            {credential.status !== 'revoked' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={onRevoke}
                aria-label={`Revoke ${credential.label}`}
              >
                Revoke
              </Button>
            ) : null}
          </Stack>
        ) : (
          <Text color="muted">Manager only</Text>
        )}
      </td>
    </tr>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
