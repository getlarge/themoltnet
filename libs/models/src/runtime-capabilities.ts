export const RUNTIME_KINDS = ['gondolin_pi'] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export interface RuntimeCapabilityManifest {
  runtimeKind: RuntimeKind;
  version: string;
  capabilities: readonly string[];
}

const GONDOLIN_PI_CAPABILITIES = [
  // Pi built-ins routed through Gondolin.
  'bash',
  'edit',
  'find',
  'grep',
  'ls',
  'read',
  'write',
  // Reviewed MoltNet host tools.
  'moltnet_create_entry',
  'moltnet_diary_tags',
  'moltnet_download_task_artifact',
  'moltnet_get_entry',
  'moltnet_get_task',
  'moltnet_host_exec',
  'moltnet_list_entries',
  'moltnet_list_task_artifacts',
  'moltnet_list_task_attempts',
  'moltnet_list_task_messages',
  'moltnet_pack_create',
  'moltnet_pack_get',
  'moltnet_pack_provenance',
  'moltnet_pack_render',
  'moltnet_rendered_pack_get',
  'moltnet_rendered_pack_list',
  'moltnet_review_session_errors',
  'moltnet_search_entries',
  'moltnet_upload_task_artifact',
  // Conditionally registered, reviewed runtime tools.
  'subagent',
  'submit_subagent_output',
  'submit_retry_triage',
  'submit_assess_brief_output',
  'submit_curate_pack_output',
  'submit_freeform_output',
  'submit_fulfill_brief_output',
  'submit_judge_eval_attempt_output',
  'submit_judge_eval_variant_output',
  'submit_judge_pack_output',
  'submit_pr_review_output',
  'submit_render_pack_output',
  'submit_run_eval_output',
  // Executables available through the reviewed Gondolin bash boundary.
  'awk',
  'cat',
  'cp',
  'curl',
  'gh',
  'git',
  'head',
  'jq',
  'mkdir',
  'moltnet',
  'mv',
  'node',
  'npm',
  'npx',
  'pnpm',
  'rg',
  'sed',
  'sh',
  'sort',
  'tail',
  'touch',
  'uniq',
  'vitest',
  'wc',
  'xargs',
] as const;

export const GONDOLIN_PI_CAPABILITY_MANIFEST = Object.freeze({
  runtimeKind: 'gondolin_pi',
  version: 'gondolin_pi:v1',
  capabilities: Object.freeze([...new Set(GONDOLIN_PI_CAPABILITIES)].sort()),
}) satisfies RuntimeCapabilityManifest;

const RUNTIME_CAPABILITY_MANIFESTS: Readonly<
  Record<RuntimeKind, RuntimeCapabilityManifest>
> = Object.freeze({
  gondolin_pi: GONDOLIN_PI_CAPABILITY_MANIFEST,
});

export function getRuntimeCapabilityManifest(
  runtimeKind: RuntimeKind,
): RuntimeCapabilityManifest {
  return RUNTIME_CAPABILITY_MANIFESTS[runtimeKind];
}

export function findUnavailableRuntimeCapabilities(
  runtimeKind: RuntimeKind,
  capabilities: readonly string[],
): string[] {
  const available = new Set(
    getRuntimeCapabilityManifest(runtimeKind).capabilities,
  );
  return [...new Set(capabilities)]
    .filter((capability) => !available.has(capability))
    .sort();
}

export function assertRuntimeCapabilityManifest(
  runtimeKind: RuntimeKind,
  manifestVersion: string,
  registeredCapabilities: readonly string[],
): void {
  const manifest = getRuntimeCapabilityManifest(runtimeKind);
  if (manifest.version !== manifestVersion) {
    throw new Error(
      `Runtime capability manifest mismatch for ${runtimeKind}: ` +
        `expected ${manifest.version}, received ${manifestVersion}`,
    );
  }
  const unavailable = findUnavailableRuntimeCapabilities(
    runtimeKind,
    registeredCapabilities,
  );
  if (unavailable.length > 0) {
    throw new Error(
      `Runtime capability manifest ${manifest.version} does not declare: ` +
        unavailable.join(', '),
    );
  }
}
