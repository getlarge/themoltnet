"""Bounded released-CLI/daemon runner. No credentials are persisted or printed."""
import argparse
import concurrent.futures
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('/tmp/review-guidance-eval'))
parser.add_argument('--team', required=True)
parser.add_argument('--diary', required=True)
parser.add_argument('--profile', required=True)
parser.add_argument('--daemon', default=shutil.which('moltnet-agent'))
parser.add_argument('--cases', nargs='+', choices=['defect', 'clean', 'head-conflict', 'unrelated-scope'], default=['defect', 'clean', 'head-conflict', 'unrelated-scope'])
parser.add_argument('--first-task-id', help='Optional queued transport-probe task to reuse')
args = parser.parse_args()
if not args.daemon:
    parser.error('released moltnet-agent not found; pass --daemon')
ROOT = args.root
TEAM = args.team
DIARY = args.diary
PROFILE = args.profile
DAEMON = args.daemon
RUN = str(uuid.uuid4())
STARTED = time.monotonic()
REPEATS = 4


def cli(args):
    result = subprocess.run(['moltnet', *args], capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError('Released CLI command failed: ' + ' '.join(args[:2]))
    return result.stdout


def save(name, value):
    fd = os.open(ROOT / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


effective = json.loads(cli(['profile', 'allowed-tools', PROFILE, '--team-id', TEAM]))
if effective.get('enforcement') != 'enforce' or effective.get('allowedTools') or effective.get('allowedShellCommands'):
    raise RuntimeError('Evaluation requires an enforced empty tool/shell allow-set')
save('allowed-tools.json', effective)

# Operational auth is host-only, never in task input or the VM environment.
values = {}
for line in cli(['config', 'export-env', '--show-secret']).splitlines():
    if line.startswith('MOLTNET_') and '=' in line:
        name, value = line.split('=', 1)
        parts = shlex.split(value)
        values[name] = parts[0] if parts else ''
if not values.get('MOLTNET_PRIVATE_KEY'):
    raise RuntimeError('No signing material supplied by released CLI')
created = json.loads(cli(['agents', 'keys', 'create', '--team-id', TEAM,
    '--name', 'review-guidance-eval-bounded', '--ttl-days', '1',
    '--scopes', 'agent:profile,crypto:sign,runtime:read,task:read,task:claim,task:execute,team:read',
    '--idempotency-key', RUN]))
key_id = created['key']['id']
env = os.environ.copy()
for name in ('MOLTNET_AGENT_KEY_REF', 'MOLTNET_PRIVATE_KEY_REF', 'MOLTNET_CLIENT_SECRET', 'MOLTNET_CLIENT_ID'):
    env.pop(name, None)
env.update(MOLTNET_AGENT_KEY=created['secret'], MOLTNET_PRIVATE_KEY=values['MOLTNET_PRIVATE_KEY'], MOLTNET_API_URL=values['MOLTNET_API_URL'])
results = []



def trial(case, arm, repeat, reuse=None):
    if time.monotonic() - STARTED > 1800:
        raise RuntimeError('Whole-experiment 30-minute deadline reached')
    tag = f'{case}-{arm}-{repeat}'
    task_id = reuse or cli(['task', 'create', '--task-type', 'freeform', '--team-id', TEAM,
        '--diary-id', DIARY, '--title', 'Review guidance evaluation',
        '--input-file', str(ROOT / 'inputs' / f'{case}-{arm}.json'),
        '--allowed-profile', json.dumps({'profileId': PROFILE}),
        '--max-attempts', '1', '--running-timeout-sec', '120', '--dispatch-timeout-sec', '1200',
        '--expires-in-sec', '3600', '--output', 'id', '--idempotency-key', RUN + '-' + tag]).strip()
    save(tag + '-metadata.json', {'case': case, 'arm': arm, 'repeat': repeat, 'taskId': task_id})
    fd = os.open(ROOT / (tag + '-runner.log'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    begun = time.monotonic()
    with os.fdopen(fd, 'w') as log:
        try:
            worker = subprocess.run([DAEMON, 'once', '--task-id', task_id, '--agent', 'legreffier',
                '--profile', PROFILE, '--team', TEAM, '--general', '--workspace-strategy', 'none',
                '--state-dir', str(ROOT / ('runtime-' + tag)), '--warm-retention-sec', '0',
                '--git-author', 'legreffier <261968324+legreffier[bot]@users.noreply.github.com>'],
                env=env, stdout=log, stderr=subprocess.STDOUT, timeout=155)
            code = worker.returncode
        except subprocess.TimeoutExpired:
            cli(['task', 'cancel', task_id, '--team-id', TEAM])
            code = 124
    task = json.loads(cli(['task', 'get', task_id, '--team-id', TEAM]))
    attempts = json.loads(cli(['task', 'attempts', task_id, '--team-id', TEAM]))
    save(tag + '-task.json', task)
    save(tag + '-attempts.json', attempts)
    conversation = json.loads(cli(['task', 'conversations', 'get', task_id, '--team-id', TEAM, '--format', 'json']))
    save(tag + '-conversation.json', conversation)
    row = {'case': case, 'arm': arm, 'repeat': repeat, 'taskId': task_id,
           'workerExit': code, 'seconds': round(time.monotonic() - begun, 3), 'status': task.get('status')}
    print(json.dumps(row), flush=True)
    return row


try:
    first_case = args.cases[0]
    first_id = args.first_task_id
    row = trial(first_case, 'baseline', 1, first_id)
    results.append(row)
    save('runs.json', results)
    if row['workerExit'] != 0:
        raise RuntimeError('Configless transport probe failed; matrix not started')
    cases = list(dict.fromkeys(args.cases))
    failures = 0
    # Every paired repeat reverses arm order. Two workers at most; no shared session.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for repeat in range(1, REPEATS + 1):
            for case in cases:
                order = ['baseline', 'guidance'] if repeat % 2 else ['guidance', 'baseline']
                futures = [pool.submit(trial, case, arm, repeat) for arm in order
                           if not (case == first_case and arm == 'baseline' and repeat == 1)]
                for future in futures:
                    row = future.result()
                    results.append(row)
                    save('runs.json', results)
                    failures = failures + 1 if row['workerExit'] != 0 else 0
                    if failures >= 2:
                        raise RuntimeError('Two consecutive execution failures; stop rather than score capability')
finally:
    cli(['agents', 'keys', 'revoke', key_id, '--team-id', TEAM, '--reason', 'privilege_withdrawn',
         '--description', 'Bounded review guidance evaluation finished'])
    print('Temporary runner credential revoked.', flush=True)
