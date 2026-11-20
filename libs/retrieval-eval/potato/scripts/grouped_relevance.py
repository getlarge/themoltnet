"""Group immutable query/entry pairs for native Potato multirate review.

Prepare a NEW task directory, never rewrite a running task's annotation schema.
Flatten its human export back into the original pair manifest before import.
"""
import argparse
import copy
import hashlib
import html
import json
import re
from pathlib import Path

import yaml
from bs4 import BeautifulSoup
from potato.server_utils.front_end import generate_schematic

LABELS = ['Answers', 'Supports', 'Not relevant']


def group_pairs(pairs):
    groups, seen = {}, set()
    for pair in pairs:
        if not re.fullmatch(r'[a-f0-9]{64}', pair['id']):
            raise ValueError('Expected immutable pair hash ID')
        if pair['id'] in seen:
            raise ValueError('Duplicate pair ID')
        seen.add(pair['id'])
        group = groups.setdefault(pair['queryId'], {
            'query': pair['query'], 'intent': pair['intent'],
            'queryId': pair['queryId'], 'queryHash': pair['queryHash'],
            'run_id': pair['run_id'], 'pairs': [],
        })
        if any(group[k] != pair[k] for k in ('query', 'intent', 'queryHash', 'run_id')):
            raise ValueError('Inconsistent query snapshot')
        group['pairs'].append(pair)
    for group in groups.values():
        digest = hashlib.sha256(json.dumps(group, sort_keys=True).encode()).hexdigest()
        group['id'] = 'group-' + digest
        group['context'] = '\n\n'.join([group['query'], group['intent']] + [
            'Candidate ' + str(i + 1) + ':\n' + pair['content']
            for i, pair in enumerate(group['pairs'])])
    if not groups:
        raise ValueError('No relevance pairs')
    return list(groups.values())


def prepare(config, pairs, predictions, provenance):
    groups = group_pairs(pairs)
    rating = {'annotation_type': 'multirate', 'name': 'relevance',
              'description': 'Rate each candidate', 'labels': LABELS,
              'options': [{'name': p['id'], 'label': 'Candidate ' + str(i + 1)} for i, p in enumerate(pairs)]}
    reasons = [{'annotation_type': 'text', 'name': 'reason_' + p['id'],
                'description': 'Reason — what in this entry supports your rating?',
                'multiline': True} for p in pairs]
    updated = copy.deepcopy(config)
    updated['annotation_schemes'] = [rating, *reasons]
    # Frozen per-pair suggestions stay advisory. A grouped prediction would no
    # longer mean the same thing as the existing per-document engine schema.
    updated.pop('labeling_engine', None)
    updated.pop('pre_annotation', None)
    updated['task_layout'] = 'grouped-layout.html'
    updated['data_files'] = ['items.jsonl']
    updated['annotation_task_name'] = 'MoltNet — relevance review by query'
    updated['annotation_instructions'] = (
        'Review all candidates for one query together. Answers directly answers; '
        'Supports adds useful information; Not relevant does not help. Open Read full entry '
        'for the complete text. Give a reason for each rating. Model suggestions are advisory '
        'and are never selected for you. Unselected means Not reviewed. '
        'Potato saves edits automatically; Next and Previous also save. '
        'Page progress counts queries with saved edits, not fully reviewed entries.')
    updated['instance_display'] = {'fields': [
        {'key': 'query', 'type': 'text', 'label': 'Query'},
        {'key': 'intent', 'type': 'text', 'label': 'Information need'}]}
    sections = ['''<style>
.potato-nav {position:sticky;bottom:0;z-index:20;background:var(--background);padding:12px;border-top:1px solid var(--border);gap:12px;flex-wrap:wrap}
.grouped-review-status {flex:1;font-size:.875rem}
.grouped-review h2 {font-size:1.5rem;margin:1.5rem 0 .75rem}
.grouped-review .shadcn-multirate-table {width:100%;table-layout:fixed}
.grouped-review .shadcn-multirate-table th:first-child {width:58%}
.grouped-review .shadcn-multirate-table td {vertical-align:top;padding:1rem .5rem}
.grouped-review .entry-title {font-size:1.125rem;font-weight:650;line-height:1.4}
.grouped-review .entry-body {white-space:pre-wrap;overflow-wrap:anywhere;max-width:75ch;line-height:1.55;margin:1rem 0}
.grouped-review details summary {cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:.5rem 0}
.grouped-review textarea {min-height:4rem;resize:vertical;width:100%}
.grouped-review .model-advice {margin:.75rem 0;font-size:.875rem}
.grouped-review input[type=radio] {min-width:24px;min-height:24px}
.grouped-review :focus-visible {outline:3px solid currentColor;outline-offset:3px}
@media(max-width:700px){.grouped-review .shadcn-multirate-table{table-layout:auto}.grouped-review .shadcn-multirate-table th:first-child{width:auto}}
</style><section class="grouped-review">''']
    for group in groups:
        scheme = copy.deepcopy(rating)
        scheme['options'] = [{'name': p['id'], 'label': 'Candidate ' + str(i + 1)} for i, p in enumerate(group['pairs'])]
        soup = BeautifulSoup(generate_schematic(scheme)[0], 'html.parser')
        for i, (row, pair) in enumerate(zip(soup.select('tbody tr'), group['pairs'], strict=True)):
            cell = row.find('td')
            value = 'instance_record["pairs"][' + str(i) + ']["content"]'
            cell.clear()
            content = '<div class="entry-title">' + '{{ ' + value + '.splitlines()[0] | e }}' + '</div>'
            content += '<details><summary>Read full entry</summary><div class="entry-body">' + '{{ ' + value + ' | e }}' + '</div></details>'
            suggestion = predictions.get(pair['id'], {}).get('relevance')
            if suggestion:
                digest = hashlib.sha256(pair['context'].encode()).hexdigest()[:32]
                if suggestion not in LABELS or provenance.get(pair['id'], {}).get('input_hash') != digest:
                    raise ValueError('Stale model suggestion')
                content += '<p class="model-advice">Model suggestion: <strong>' + html.escape(suggestion) + '</strong> · Choose your own rating.</p>'
            reason = next(r for r in reasons if r['name'] == 'reason_' + pair['id'])
            reason_html = BeautifulSoup(generate_schematic(reason)[0], 'html.parser')
            # Keep native input attributes but avoid nested forms.
            reason_html.form.name = 'div'
            content += str(reason_html)
            cell.append(BeautifulSoup(content, 'html.parser'))
        sections += ['{% if instance_record["id"] == ' + json.dumps(group['id']) + ' %}',
                     '<h2>Review ' + str(len(group['pairs'])) + ' candidates</h2>', str(soup), '{% endif %}']
    sections.append('''</section><script>
(function () {
  function setup() {
    const root = document.querySelector('.grouped-review');
    const nav = document.querySelector('.potato-nav');
    if (!root || !nav) return;
    const status = document.createElement('output');
    status.className = 'grouped-review-status';
    status.setAttribute('aria-live', 'polite');
    nav.prepend(status);
    function update() {
      const rows = [...root.querySelectorAll('tbody tr')];
      const rated = rows.filter(row => row.querySelector('input:checked')).length;
      const complete = rows.filter(row => row.querySelector('input:checked') && row.querySelector('textarea').value.trim()).length;
      status.textContent = rated + '/' + rows.length + ' rated · ' + complete + '/' + rows.length + ' with reasons';
    }
    root.addEventListener('input', update);
    root.addEventListener('change', update);
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
</script>''')
    return updated, groups, '\n'.join(sections)


def flatten(groups, rows, reviewer):
    index = {g['id']: g for g in groups}
    if len(index) != len(groups):
        raise ValueError('Duplicate group')
    # Verify the group identity against its immutable pair contents.
    for g in groups:
        if group_pairs(g['pairs']) != [g]:
            raise ValueError('Stale group mapping')
    result, seen = [], set()
    for row in rows:
        if row.get('user_id') != reviewer:
            continue
        if row.get('instance_id') not in index or row['instance_id'] in seen:
            raise ValueError('Unknown or duplicate group export')
        seen.add(row['instance_id'])
        group = index[row['instance_id']]
        pairs = {p['id']: p for p in group['pairs']}
        labels = row.get('labels', {})
        ratings = labels.get('relevance', {})
        for pair_id, value in ratings.items():
            if pair_id not in pairs or value not in LABELS:
                raise ValueError('Invalid pair rating')
            reason = labels.get('reason_' + pair_id, {}).get('text_box')
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError('Every rated entry needs a reason')
            # Preserve annotator_origin/label_origin/engine_request for the
            # canonical importer, which rejects machine-origin judgments.
            result.append({**row, 'instance_id': pair_id,
                           'labels': {'relevance': {value: value}, 'reason': {'text_box': reason}}})
    if not seen:
        raise ValueError('Reviewer has no exported rows')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prepare_parser = sub.add_parser('prepare')
    for field in ('config', 'pairs', 'predictions', 'provenance', 'output'):
        prepare_parser.add_argument('--' + field, type=Path, required=True)
    export_parser = sub.add_parser('flatten')
    for field in ('groups', 'export', 'output'):
        export_parser.add_argument('--' + field, type=Path, required=True)
    export_parser.add_argument('--reviewer', required=True)
    args = parser.parse_args()
    def read_lines(path):
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if args.command == 'prepare':
        config, groups, layout = prepare(yaml.safe_load(args.config.read_text()), read_lines(args.pairs),
                                         json.loads(args.predictions.read_text()), json.loads(args.provenance.read_text()))
        args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
        files = {'config.yaml': yaml.safe_dump(config, sort_keys=False),
                 'items.jsonl': ''.join(json.dumps(g, ensure_ascii=False) + '\n' for g in groups),
                 'grouped-layout.html': layout}
        for name, text in files.items():
            (args.output / name).write_text(text)
            (args.output / name).chmod(0o600)
        print(json.dumps({'queries': len(groups), 'pairs': sum(len(g['pairs']) for g in groups)}))
    else:
        result = flatten(read_lines(args.groups), read_lines(args.export), args.reviewer)
        with args.output.open('x') as stream:
            args.output.chmod(0o600)
            stream.write(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in result))
        print(json.dumps({'judgments': len(result)}))


if __name__ == '__main__':
    main()
