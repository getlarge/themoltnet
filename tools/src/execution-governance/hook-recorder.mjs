import { Buffer } from 'node:buffer';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const raw = Buffer.concat(chunks).toString('utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stderr.write('probe hook received invalid JSON\n');
  process.exit(65);
}

const logPath = process.env.MOLTNET_PROBE_HOOK_LOG;
if (logPath) appendFileSync(logPath, `${JSON.stringify(input)}\n`);

const serializedInput = JSON.stringify(input.tool_input ?? input);
const eventName = input.hook_event_name ?? input.hookEventName;
const toolName = input.tool_name ?? input.toolName ?? '';

if (
  process.env.MOLTNET_PROBE_FORCE_HOOK_FAILURE === '1' ||
  serializedInput.includes('MOLTNET_PROBE_HOOK_ERROR')
) {
  process.stderr.write('simulated policy service unavailable\n');
  process.exit(70);
}

if (serializedInput.includes('MOLTNET_PROBE_HOOK_TIMEOUT')) {
  await delay(5_000);
}

if (eventName === 'PermissionRequest') {
  if (serializedInput.includes('MOLTNET_PROBE_APPROVAL_DENY')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'deny',
            message: 'Denied by the Milestone 0 conformance probe.',
          },
        },
      }),
    );
  } else if (
    serializedInput.includes('MOLTNET_PROBE_APPROVAL_ALLOW') ||
    String(toolName).includes('probe__probe_')
  ) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' },
        },
      }),
    );
  }
  process.exit(0);
}

if (eventName !== 'PreToolUse') process.exit(0);

if (serializedInput.includes('MOLTNET_PROBE_DENY')) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Denied by the Milestone 0 conformance probe.',
      },
    }),
  );
} else if (serializedInput.includes('MOLTNET_PROBE_ASK')) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'Escalated by the Milestone 0 conformance probe.',
      },
    }),
  );
} else if (serializedInput.includes('MOLTNET_PROBE_DEFER')) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        permissionDecisionReason:
          'Deferred by the Milestone 0 conformance probe.',
      },
    }),
  );
}
