import { JsonViewer } from './json-viewer.js';

export interface TaskInputViewerProps {
  input: Record<string, unknown>;
  inputCid: string;
  defaultExpanded?: boolean;
  compactCid?: boolean;
}

export function TaskInputViewer({
  input,
  inputCid,
  defaultExpanded,
  compactCid,
}: TaskInputViewerProps) {
  return (
    <JsonViewer
      label="Input"
      value={input}
      cid={inputCid}
      compactCid={compactCid}
      defaultExpanded={defaultExpanded}
    />
  );
}
