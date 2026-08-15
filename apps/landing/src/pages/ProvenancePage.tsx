import { ProvenanceExplorer } from '@moltnet/provenance-ui';
import {
  Badge,
  Button,
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type { ChangeEvent } from 'react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'wouter';

import { NAV_OFFSET } from '../constants';
import {
  compressGraphToParam,
  decompressGraphFromParam,
} from '../provenance/graph-sharing';
import {
  MAX_PROVENANCE_INPUT_BYTES,
  parseProvenanceGraph,
} from '../provenance/parse-graph';

export function ProvenancePage() {
  const theme = useTheme();
  const [rawInput, setRawInput] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [uploadFocused, setUploadFocused] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredInput = useDeferredValue(rawInput);
  const parsed = useMemo(() => {
    if (deferredInput.trim() === '') {
      return { graph: null, error: null as string | null };
    }
    try {
      return { graph: parseProvenanceGraph(deferredInput), error: null };
    } catch (error) {
      return {
        graph: null,
        error: error instanceof Error ? error.message : 'Failed to parse graph',
      };
    }
  }, [deferredInput]);

  useEffect(() => {
    const graphParam = new URLSearchParams(window.location.search).get('graph');
    if (!graphParam) return;

    decompressGraphFromParam(graphParam)
      .then((input) => {
        setImportError(null);
        setRawInput(input);
      })
      .catch((error) => {
        try {
          const base64 = graphParam.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
          const json = atob(padded);
          if (json.startsWith('{')) {
            if (
              new TextEncoder().encode(json).byteLength >
              MAX_PROVENANCE_INPUT_BYTES
            ) {
              setImportError(
                'Shared provenance graph exceeds the 512 KB limit.',
              );
              return;
            }
            setImportError(null);
            setRawInput(json);
            return;
          }
        } catch {
          // The parser below reports invalid graph data once input is present.
        }
        setImportError(
          error instanceof Error
            ? `Could not open this shared graph: ${error.message}`
            : 'Could not open this shared graph. Paste another export below.',
        );
      });
  }, []);

  useEffect(() => {
    if (!parsed.graph || deferredInput !== rawInput) {
      setShareUrl(null);
      return;
    }
    let cancelled = false;
    void compressGraphToParam(JSON.stringify(parsed.graph)).then((param) => {
      if (cancelled || !param) {
        if (!cancelled) setShareUrl(null);
        return;
      }
      const url = new URL(window.location.href);
      url.search = `?graph=${param}`;
      setShareUrl(url.toString());
    });
    return () => {
      cancelled = true;
    };
  }, [deferredInput, parsed.graph, rawInput]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopyLink = useCallback(() => {
    if (!shareUrl) return;
    const markCopied = () => {
      setCopyError(null);
      setLinkCopied(true);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    };
    const markCopyFailed = () => {
      setLinkCopied(false);
      setCopyError('Could not copy the link. Check browser clipboard access.');
    };
    const copyWithFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (copied) markCopied();
      else markCopyFailed();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(markCopied, copyWithFallback);
    } else {
      copyWithFallback();
    }
  }, [shareUrl]);

  async function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PROVENANCE_INPUT_BYTES) {
      setImportError('Choose a provenance export that is 512 KB or smaller.');
      event.target.value = '';
      return;
    }
    setImportError(null);
    setRawInput(await file.text());
    event.target.value = '';
  }

  const graphError = importError ?? parsed.error;
  const graphDescription = graphError
    ? 'provenance-json-hint provenance-json-error'
    : 'provenance-json-hint';

  return (
    <div
      style={{
        paddingTop: NAV_OFFSET,
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${theme.color.bg.elevated} 0%, ${theme.color.bg.surface} 52%, ${theme.color.bg.void} 100%)`,
      }}
    >
      <Container maxWidth="xl">
        <Stack
          gap={6}
          style={{ padding: `${theme.spacing[10]} 0 ${theme.spacing[16]}` }}
        >
          <Stack gap={2}>
            <Link
              href="/architecture"
              style={{
                fontSize: theme.font.size.sm,
                color: theme.color.text.muted,
              }}
            >
              &larr; Back to architecture
            </Link>
            <Badge variant="accent" style={{ alignSelf: 'flex-start' }}>
              Lab
            </Badge>
            <Text variant="h1">Provenance explorer</Text>
            <Text variant="body" color="secondary" style={{ maxWidth: '70ch' }}>
              Inspect the same pack ancestry and entry membership shown in
              Console without signing in. Paste an exported
              `moltnet.provenance-graph/v1` payload or open a shared URL.
            </Text>
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 32rem), 1fr))',
              gap: theme.spacing[5],
              alignItems: 'start',
            }}
          >
            <Card variant="outlined" padding="md">
              <Stack gap={3}>
                <Stack gap={1}>
                  <Text weight="semibold">Graph input</Text>
                  <Text
                    id="provenance-json-hint"
                    variant="caption"
                    color="muted"
                  >
                    Export a real graph with `npx @themoltnet/cli pack
                    provenance`, then paste or upload the JSON here. Imports are
                    limited to 512 KB.
                  </Text>
                </Stack>
                <div
                  style={{
                    display: 'flex',
                    gap: theme.spacing[2],
                    flexWrap: 'wrap',
                  }}
                >
                  <label
                    htmlFor="provenance-json-upload"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: theme.radius.md,
                      border: `1px solid ${theme.color.border.DEFAULT}`,
                      padding: `${theme.spacing[2]} ${theme.spacing[4]}`,
                      minHeight: 44,
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                      color: theme.color.primary.DEFAULT,
                      boxShadow: uploadFocused
                        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.border.focus}`
                        : `inset 0 0 0 1px ${theme.color.border.DEFAULT}`,
                    }}
                  >
                    Upload JSON
                    <input
                      id="provenance-json-upload"
                      type="file"
                      aria-label="Upload provenance graph JSON"
                      accept="application/json,.json"
                      onChange={handleFileUpload}
                      onFocus={() => setUploadFocused(true)}
                      onBlur={() => setUploadFocused(false)}
                      style={{
                        position: 'absolute',
                        width: 1,
                        height: 1,
                        opacity: 0,
                        pointerEvents: 'none',
                      }}
                    />
                  </label>
                  {shareUrl ? (
                    <Button variant="secondary" onClick={handleCopyLink}>
                      {linkCopied ? 'Copied!' : 'Copy link'}
                    </Button>
                  ) : null}
                </div>
                {shareUrl ? (
                  <Stack gap={2}>
                    <Text variant="caption" color="muted">
                      Shared links contain the imported graph metadata. Anyone
                      holding the URL can inspect it.
                    </Text>
                    <div role="status" aria-live="polite">
                      <Text
                        variant="caption"
                        color={copyError ? 'error' : 'muted'}
                      >
                        {copyError ??
                          (linkCopied
                            ? 'Share link copied.'
                            : 'Review the graph before sharing its URL.')}
                      </Text>
                    </div>
                  </Stack>
                ) : null}
                <label
                  htmlFor="provenance-json-input"
                  style={{
                    color: theme.color.text.DEFAULT,
                    fontSize: theme.font.size.sm,
                    fontWeight: theme.font.weight.medium,
                  }}
                >
                  Provenance graph JSON
                </label>
                <textarea
                  id="provenance-json-input"
                  aria-describedby={graphDescription}
                  aria-invalid={graphError ? true : undefined}
                  value={rawInput}
                  onChange={(event) => {
                    setImportError(null);
                    setCopyError(null);
                    setRawInput(event.target.value);
                  }}
                  spellCheck={false}
                  placeholder={`{\n  "metadata": { ... },\n  "nodes": [],\n  "edges": []\n}`}
                  style={{
                    minHeight: '18rem',
                    width: '100%',
                    resize: 'vertical',
                    borderRadius: theme.radius.lg,
                    border: `1px solid ${theme.color.border.DEFAULT}`,
                    background: theme.color.bg.void,
                    color: theme.color.text.DEFAULT,
                    padding: theme.spacing[4],
                    fontFamily: theme.font.family.mono,
                    fontSize: theme.font.size.xs,
                  }}
                />
                {graphError ? (
                  <div id="provenance-json-error" role="alert">
                    <Text
                      variant="caption"
                      style={{ color: theme.color.error.DEFAULT }}
                    >
                      {graphError}
                    </Text>
                  </div>
                ) : null}
              </Stack>
            </Card>

            {parsed.graph ? (
              <Stack gap={3}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing[2],
                    flexWrap: 'wrap',
                  }}
                >
                  <Badge variant="warning">Imported · unverified</Badge>
                  <Text variant="caption" color="muted">
                    Schema-valid export. This public viewer does not verify its
                    signatures or source authorization.
                  </Text>
                </div>
                <ProvenanceExplorer graph={parsed.graph} height="42rem" />
              </Stack>
            ) : (
              <div
                style={{
                  minHeight: '18rem',
                  display: 'grid',
                  placeItems: 'center',
                  borderBlock: `1px solid ${theme.color.border.DEFAULT}`,
                  padding: theme.spacing[8],
                }}
              >
                <Stack gap={2} align="center">
                  <Text color="muted">
                    Paste or upload a provenance export to inspect it.
                  </Text>
                  <Text variant="caption" color="muted">
                    The graph stays in this browser until you choose to copy a
                    share link.
                  </Text>
                </Stack>
              </div>
            )}
          </div>
        </Stack>
      </Container>
    </div>
  );
}
