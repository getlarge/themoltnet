"""Manage a closed Potato roster over its existing deployment SSH connection.

Run with the Potato deployment virtualenv. No cloud-provider token is needed.
Changes default to a preview. Passwords are written only to --credentials-out.
"""

import argparse
import copy
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shlex
import sys

import yaml
from potato.authentication import _hash_password_with_salt
from potato.deploy.remote import SSHSession
from potato.deploy.state import DeploymentStore, SecretStore
from potato.server_utils.usernames import colliding_username, username_problem


def changed_roster(config, rows, username, password):
    """Return new documents without changing annotations or existing passwords."""
    problem = username_problem(username)
    if problem:
        raise ValueError(problem)
    config = copy.deepcopy(config)
    rows = copy.deepcopy(rows)
    users = config.get('user_config', {})
    if users.get('allow_all_users') is not False or not config.get('require_password'):
        raise ValueError('This command requires closed, password-based registration.')
    if config.get('authentication', {}).get('method') != 'in_memory':
        raise ValueError('This command supports persisted local password accounts only.')
    roster = users.get('users', [])
    if not isinstance(roster, list) or not all(isinstance(u, str) for u in roster):
        raise ValueError('Expected user_config.users to be a list of usernames.')
    existing = [row['username'] for row in rows]
    if len(existing) != len(set(existing)):
        raise ValueError('Duplicate credential rows; repair the roster first.')
    if colliding_username(username, existing + roster):
        raise ValueError('Username collides with an existing account.')
    roles = config.get('rbac', {}).get('user_role_assignments', {})
    if username in existing or username in roster or username in roles:
        raise ValueError('Account already exists or is reserved; refusing to overwrite it.')
    if not password:
        raise ValueError('A generated password is required.')
    users['users'] = roster + [username]
    rows.append({'username': username, 'password': _hash_password_with_salt(password)})
    return config, rows


def relative_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Roster path must stay inside the deployed task directory.')
    return str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='Private local deployment config.yaml')
    parser.add_argument('--name', required=True, help='Recorded deployment name')
    parser.add_argument('action', choices=['list', 'add'])
    parser.add_argument('username', nargs='?')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--credentials-out', type=Path)
    args = parser.parse_args()
    if args.action != 'list' and not args.username:
        parser.error('add requires a username')
    if args.action == 'add' and args.apply and not args.credentials_out:
        parser.error('add --apply requires a private --credentials-out file')

    record = DeploymentStore(args.config).get(args.name)
    if record is None:
        parser.error('No recorded deployment with that name')
    session = SSHSession(record.provider_ref['host'], private_key_pem=SecretStore(
        args.config).get(args.name, 'ssh_private_key'), console=lambda _: None)
    base = record.provider_ref['app_dir']
    stopped = False
    original = {}
    local_original = {}
    try:
        # The live service writes its roster. Stop it before reading for a mutation.
        if args.apply and args.action != 'list':
            session.run('systemctl stop potato.service', check=True)
            stopped = True
        sftp = session.connect().open_sftp()

        def read(path):
            with sftp.open(path, 'rb') as handle:
                return handle.read().decode('utf-8')

        config_path = base + '/config.yaml'
        config_text = read(config_path)
        config = yaml.safe_load(config_text)
        roster_name = relative_path(config['authentication']['user_config_path'])
        roster_path = base + '/' + roster_name
        roster_text = read(roster_path)
        rows = [json.loads(line) for line in roster_text.splitlines() if line.strip()]
        if args.action == 'list':
            roles = config.get('rbac', {}).get('user_role_assignments', {})
            for row in rows:
                print(json.dumps({'username': row['username'],
                                  'role': roles.get(row['username'], 'reviewer')}))
            return
        password = secrets.token_urlsafe(24) if args.action == 'add' else None
        updated, new_rows = changed_roster(config, rows, args.username, password)
        if not args.apply:
            print(f'Preview: {args.action} reviewer {args.username}; annotations remain unchanged.')
            return
        # Exclusive creation prevents overwriting an earlier account's handover.
        if password:
            fd = os.open(args.credentials_out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as handle:
                json.dump({'url': record.url, 'username': args.username, 'password': password}, handle)
                handle.flush()
                os.fsync(handle.fileno())
        original = {config_path: config_text, roster_path: roster_text}
        replacements = {config_path: yaml.safe_dump(updated, sort_keys=False),
                        roster_path: ''.join(json.dumps(row) + '\n' for row in new_rows)}
        for path, content in replacements.items():
            session.put_text(content, path + '.new', mode=0o600)
            session.run(f'chown 1000:1000 {shlex.quote(path + ".new")} && '
                        f'mv {shlex.quote(path + ".new")} {shlex.quote(path)}', check=True)
        # Keep the private deploy source in sync so a redeploy retains the roster.
        local = Path(args.config).resolve().parent
        for name, content in [('config.yaml', replacements[config_path]),
                              (roster_name, replacements[roster_path])]:
            target = local / name
            local_original[target] = target.read_bytes() if target.exists() else None
            temporary = target.with_name(target.name + '.new')
            temporary.write_text(content)
            temporary.chmod(0o600)
            temporary.replace(target)
        print(f'Applied: {args.action} reviewer {args.username}. No annotations deleted.')
        if password:
            print(f'Credentials saved privately to {args.credentials_out}; share directly with the reviewer.')
    except Exception:
        for target, content in local_original.items():
            if content is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(content)
                target.chmod(0o600)
        for path, content in original.items():
            session.put_text(content, path, mode=0o600)
            session.run(f'chown 1000:1000 {shlex.quote(path)}', check=True)
        raise
    finally:
        if stopped:
            session.run('systemctl start potato.service', check=True)
        session.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Provider exceptions may embed remote output. Do not print credentials.
        print(f'Collaborator operation failed ({type(error).__name__}). '
              'Check the roster and service before retrying.', file=sys.stderr)
        sys.exit(1)
