"""Create fresh loopback Potato tasks from a completed retrieval experiment."""
import argparse
import json
import secrets
from pathlib import Path

import yaml

from grouped_relevance import prepare as prepare_grouped
from prepare_ranked_layout import build_layout
from prepare_review_tasks import prepare


def create_tasks(run, manifest, proposals, output):
    queries, pairs = prepare(run, manifest, proposals)
    if not pairs:
        raise ValueError('No retrieved candidates; inspect the run before annotation')
    templates = Path(__file__).resolve().parent.parent / 'tasks'

    def local_config(name):
        config = yaml.safe_load((templates / name / 'config.yaml').read_text())
        config.update(host='127.0.0.1', require_password=False,
                      secret_key=secrets.token_hex(32),
                      user_config={'allow_all_users': True},
                      authentication={'method': 'in_memory', 'user_config_path': 'users.jsonl'})
        return config

    explore = local_config('queries')
    explore['task_layout'] = 'ranked-task-layout.html'
    relevance, grouped, layout = prepare_grouped(local_config('relevance'), pairs, {}, {})
    # Construct and validate everything before publishing the fresh task directory.
    files = {
        'explore/config.yaml': yaml.safe_dump(explore, sort_keys=False),
        'explore/items.jsonl': ''.join(json.dumps(q, ensure_ascii=False) + '\n' for q in queries),
        'explore/ranked-task-layout.html': build_layout(explore, run),
        'relevance/config.yaml': yaml.safe_dump(relevance, sort_keys=False),
        'relevance/items.jsonl': ''.join(json.dumps(g, ensure_ascii=False) + '\n' for g in grouped),
        'relevance/grouped-layout.html': layout,
        'manifest.json': json.dumps(manifest, indent=2) + '\n',
        'dataset.json': json.dumps(run['dataset'], indent=2) + '\n',
        'proposals.json': json.dumps(proposals, indent=2) + '\n',
        'run.json': json.dumps(run, indent=2) + '\n',
    }
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, text in files.items():
        path = output / name
        path.parent.mkdir(exist_ok=True, mode=0o700)
        with path.open('x') as stream:
            path.chmod(0o600)
            stream.write(text)
    return {'queries': len(queries), 'pairs': len(pairs), 'directory': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('run', 'manifest', 'proposals', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(create_tasks(*[json.loads(p.read_text()) for p in (args.run, args.manifest, args.proposals)], args.output)))
