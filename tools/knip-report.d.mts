export interface Finding {
  key: string;
  file: string;
  type: string;
  name: string;
  line: number;
}
export interface Delta {
  added: Finding[];
  resolved: Finding[];
}
export function normalize(report: unknown): Finding[];
export function compare(base: Finding[], head: Finding[]): Delta;
export function summary(
  head: Finding[],
  delta: Delta | null,
  url?: string,
): string;
export function annotation(finding: Finding): string;
export function scan(
  cwd: string,
  bin: string,
  output: string,
  label: string,
): Finding[];
export const backlogMarker: string;
export function backlog(
  findings: Finding[],
  url?: string,
): { hash: string; body: string };
export function publishBacklog(
  github: unknown,
  repo: { owner: string; repo: string },
  findings: Finding[],
  url: string,
): Promise<unknown>;
