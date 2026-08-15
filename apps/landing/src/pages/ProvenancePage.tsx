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
import { parseProvenanceGraph } from '../provenance/parse-graph';

export function ProvenancePage() {
  const theme = useTheme();
  const [rawInput, setRawInput] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredInput = useDeferredValue(rawInput);

  useEffect(() => {
    const graphParam = new URLSearchParams(window.location.search).get('graph');
    if (!graphParam) return;

    decompressGraphFromParam(graphParam)
      .then(setRawInput)
      .catch((error) => {
        try {
          const base64 = graphParam.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
          const json = atob(padded);
          if (json.startsWith('{')) {
            setRawInput(json);
            return;
          }
        } catch {
          // The parser below reports invalid graph data once input is present.
        }
        // eslint-disable-next-line no-console
        console.error('[provenance] failed to decode ?graph= param:', error);
      });
  }, []);

  useEffect(() => {
    if (!rawInput.trim()) {
      setShareUrl(null);
      return;
    }
    let cancelled = false;
    void compressGraphToParam(rawInput).then((param) => {
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
  }, [rawInput]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopyLink = useCallback(() => {
    if (!shareUrl) return;
    const markCopied = () => {
      setLinkCopied(true);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    };
    navigator.clipboard.writeText(shareUrl).then(markCopied, () => {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markCopied();
    });
  }, [shareUrl]);

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

  async function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setRawInput(await file.text());
    event.target.value = '';
  }

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
            <Badge variant="accent">Lab</Badge>
            <Text variant="h2">Provenance explorer</Text>
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
                  <Text variant="caption" color="muted">
                    Export a real graph with `npx @themoltnet/cli pack
                    provenance`, then paste or upload the JSON here.
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
                      cursor: 'pointer',
                      color: theme.color.primary.DEFAULT,
                    }}
                  >
                    Upload JSON
                    <input
                      id="provenance-json-upload"
                      type="file"
                      aria-label="Upload provenance graph JSON"
                      accept="application/json,.json"
                      onChange={handleFileUpload}
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
                  <Text variant="caption" color="muted">
                    Shared links contain the graph metadata. Anyone holding the
                    URL can inspect it.
                  </Text>
                ) : null}
                <textarea
                  aria-label="Provenance graph JSON"
                  value={rawInput}
                  onChange={(event) => setRawInput(event.target.value)}
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
                {parsed.error ? (
                  <Text
                    variant="caption"
                    style={{ color: theme.color.error.DEFAULT }}
                  >
                    {parsed.error}
                  </Text>
                ) : null}
              </Stack>
            </Card>

            {parsed.graph ? (
              <ProvenanceExplorer graph={parsed.graph} height="42rem" />
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
                <Text color="muted">
                  Paste or upload a provenance export to inspect it.
                </Text>
              </div>
            )}
          </div>
        </Stack>
      </Container>
    </div>
  );
}
