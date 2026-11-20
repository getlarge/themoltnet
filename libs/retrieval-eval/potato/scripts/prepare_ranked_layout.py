"""Generate a Potato task layout from its unchanged annotation schemas.

Rankings are rendered from existing item fields at request time. No task items,
queries, annotations or machine context are rewritten.
"""
import argparse
import copy
import json
import os
from pathlib import Path

import yaml
from potato.server_utils.front_end import generate_schematic

RANKINGS = (
    ('relevance', 'Relevance only'),
    ('recency', 'Relevance + recency'),
    ('importance', 'Relevance + importance'),
    ('combined', 'Combined weights'),
)

STYLE = '''<style>
.retrieval-rankings { margin-bottom: 1.5rem; }
.retrieval-rankings details { border-block-end: 1px solid #8888; padding: 1rem 0; }
.retrieval-rankings summary { cursor: pointer; font-size: 1.125rem; font-weight: 650; }
.retrieval-rankings summary:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
.retrieval-rankings ol { margin: 1rem 0 0; padding-inline-start: 2rem; }
.retrieval-rankings li { padding: 0.75rem 0.5rem; border-block-end: 1px solid #8884; }
.retrieval-rankings li:last-child { border: 0; }
.retrieval-rankings li::marker { font-weight: 700; }
.retrieval-rankings strong { display: block; font-size: 1.0625rem; overflow-wrap: anywhere; }
.retrieval-rankings .entry-full-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin-top: 0.75rem; }
.retrieval-rankings .entry-details { border: 0; padding: 0.5rem 0; }
.retrieval-rankings .entry-details summary { font-size: 1rem; }
.retrieval-rankings p { margin: 0.5rem 0; line-height: 1.6; overflow-wrap: anywhere; }
</style>'''


def full_entry_index(run):
    if run['status'] != 'complete':
        raise ValueError('Full entries require a completed frozen run')
    entries = {entry['id']: entry for entry in run['dataset']['entries']}
    index = {}
    for query in run['dataset']['queries']:
        item = {'query': query['text'], 'run_id': run['id']}
        for key, _ in RANKINGS:
            rankings = [r for r in run['rankings'] if r['queryId'] == query['id'] and r['configuration'] == key and r['repeat'] == 1 and r['k'] == 10]
            if len(rankings) != 1:
                raise ValueError('Expected one frozen top-ten ranking per configuration')
            full, previews = [], []
            for rank, eid in enumerate(rankings[0]['retrievedIds'][:10], 1):
                entry = entries[eid]
                snippet = ' '.join(entry['content'].split())[:220]
                previews.append(f"{rank}. {entry.get('title') or eid}\n{snippet}…\n")
                full.append({'id': eid, 'content': entry['content']})
            item[key] = {'preview': '\n'.join(previews), 'entries': full}
        index[query['id'] + '-' + run['id']] = item
    return index


def build_layout(config, run):
    # A Jinja literal is evaluated on the server, not sent as a client-side data dump.
    # JSON quoting prevents entry text from becoming template code; output is escaped.
    index = json.dumps(full_entry_index(run), ensure_ascii=True)
    parts = ['{% set full_entry_index = ' + index + ' %}',
             "{% set frozen = full_entry_index.get(instance_record['id'], {}) %}", STYLE, '<section class="retrieval-rankings" aria-label="Ranked entry previews">',
             '<p>Ranked entry previews — retrieval order is not a relevance judgment.</p>']
    for key, title in RANKINGS:
        parts.append('<details><summary>' + title + ' — top ten</summary><ol>')
        # Input format is rank/title, newline, snippet, blank line between entries.
        # Explicit escaping remains in force even if the caller disables autoescape.
        parts.append("{% for result in instance_record['" + key + "_results'].strip().split('\\n\\n') %}")
        parts.append("{% set lines = result.partition('\\n') %}")
        parts.append("<li><strong>{{ lines[0].partition('. ')[2] | e }}</strong><p>{{ lines[2].strip() | e }}</p>")
        parts.append("{% if frozen and frozen['run_id'] == instance_record['run_id'] and frozen['query'] == instance_record['query'] and frozen['" + key + "']['preview'] == instance_record['" + key + "_results'] %}")
        parts.append("<details class=\"entry-details\"><summary>Read full entry</summary><div class=\"entry-full-text\">{{ frozen['" + key + "']['entries'][loop.index0]['content'] | e }}</div></details>")
        parts.append('{% else %}<p>Full entry unavailable for this snapshot.</p>{% endif %}</li>')
        parts.append('{% endfor %}</ol></details>')
    parts.append('</section>')
    for scheme in config['annotation_schemes']:
        markup, _ = generate_schematic(copy.deepcopy(scheme))
        parts.append(markup)
    return '\n'.join(parts) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--run', required=True, type=Path, help='Completed frozen run containing approved entry content')
    args = parser.parse_args()
    config = yaml.safe_load(args.config.read_text())
    destination = args.config.parent / 'ranked-task-layout.html'
    layout = build_layout(config, json.loads(args.run.read_text()))
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(layout)
    print('Generated ranked-task-layout.html; annotation schemas preserved.')
