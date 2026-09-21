import { JsonViewer } from './json-viewer.js';

export interface TaskInputViewerProps {
  input: Record<string, unknown>;
  inputCid: string;
  defaultExpanded?: boolean;
}

export function TaskInputViewer({
  input,
  inputCid,
  defaultExpanded,
}: TaskInputViewerProps) {
  return (
    <JsonViewer
      label="Input"
      value={input}
      cid={inputCid}
      defaultExpanded={defaultExpanded}
    />
  );
}
