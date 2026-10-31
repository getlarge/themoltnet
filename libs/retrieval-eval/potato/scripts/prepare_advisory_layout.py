"""Display verified model suggestions without selecting annotation controls."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

import yaml
from potato.server_utils.front_end import generate_schematic

from corpus_suggestions import SCHEMAS


def build_layout(config, items, predictions, provenance, original_layout=None):
    index = {}
    for item in items:
        suggestions = predictions.get(item['id'], {})
        if not suggestions:
            continue
        if len(suggestions) != 1:
            raise ValueError('Expected one decision schema')
        schema, label = next(iter(suggestions.items()))
        text_key, labels = SCHEMAS[schema]
        text = item[text_key]
        if label not in labels or provenance[item['id']]['input_hash'] != hashlib.sha256(text.encode()).hexdigest()[:32]:
            raise ValueError('Stale or invalid suggestion')
        index[item['id']] = {'label': label, 'text': text, 'text_key': text_key}
    panel = '''{% set advisory_index = INDEX %}
{% set advisory = advisory_index.get(instance_record['id']) %}
{% if advisory and instance_record[advisory['text_key']] == advisory['text'] %}
<aside aria-label="Model suggestion" style="margin: 1rem 0; padding: 1rem; border: 1px solid #8888; border-radius: 0.5rem;">
<strong>Model suggestion: {{ advisory['label'] | e }}</strong>
<p>Choose a label below to accept or override this suggestion. It is not a saved human judgment. Previous does not accept it.</p>
</aside>
{% endif %}
'''.replace('INDEX', json.dumps(index, ensure_ascii=True), 1)
    if original_layout is None:
        original_layout = '\n'.join(generate_schematic(copy.deepcopy(scheme))[0] for scheme in config['annotation_schemes'])
    return panel + original_layout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('config', 'items', 'predictions', 'provenance', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--layout', type=Path, help='Existing native task layout to preserve')
    args = parser.parse_args()
    config = yaml.safe_load(args.config.read_text())
    items = [json.loads(line) for line in args.items.read_text().splitlines() if line.strip()]
    markup = build_layout(config, items, json.loads(args.predictions.read_text()), json.loads(args.provenance.read_text()), args.layout.read_text() if args.layout else None)
    args.output.write_text(markup)
    args.output.chmod(0o600)
    print('Advisory layout generated. Disable pre_annotation and set task_layout to this file before restart.')


if __name__ == '__main__':
    main()
