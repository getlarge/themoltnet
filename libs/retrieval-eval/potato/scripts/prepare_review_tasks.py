"""Render saved retrieval rankings as Potato query and relevance task inputs.

Use the retrieval-eval CLI to create the manifest first. Scan both generated
JSONL files before upload. Proposals provide information needs, never labels.
"""
import argparse
import json
import os
from pathlib import Path


def prepare(run, manifest, proposals):
    if run['status'] != 'complete' or manifest['schemaVersion'] != 1 or manifest['datasetHash'] != run['datasetHash']:
        raise ValueError('Use a completed run and its matching immutable manifest')
    entries = {e['id']: e for e in run['dataset']['entries']}
    queries = {q['id']: q for q in run['dataset']['queries']}
    needs = {q['id']: q for q in proposals['queries']}
    query_items, relevance_items = [], []
    for qid, query in queries.items():
        if needs[qid]['text'] != query['text'] or needs[qid]['textHash'] != query['textHash']:
            raise ValueError('Stale query proposal')
        item = {'id': qid + '-' + run['id'], 'query': query['text'], 'intent': needs[qid]['informationNeed'], 'family': query['family'], 'run_id': run['id']}
        for config in ('relevance', 'recency', 'importance', 'combined'):
            ranks = [r for r in run['rankings'] if r['queryId'] == qid and r['configuration'] == config and r['repeat'] == 1 and r['k'] == 10]
            if len(ranks) != 1:
                raise ValueError('Expected one top-ten ranking per query and configuration')
            lines = []
            for rank, eid in enumerate(ranks[0]['retrievedIds'][:10], 1):
                entry = entries[eid]
                snippet = ' '.join(entry['content'].split())[:220]
                lines.append(f"{rank}. {entry.get('title') or eid}\n{snippet}…\n")
            item[config + '_results'] = '\n'.join(lines)
        item['context'] = '\n\n'.join([item['query'], item['intent']] + [item[c + '_results'] for c in ('relevance', 'recency', 'importance', 'combined')])
        query_items.append(item)
    for item in manifest['items']:
        entry, query = entries[item['entryId']], queries[item['queryId']]
        content = '\n\n'.join(p for p in [entry.get('title'), entry['content']] if p)
        if item['entryHash'] != entry['contentHash'] or item['queryHash'] != query['textHash'] or item['content'] != content or item['query'] != query['text']:
            raise ValueError('Stale relevance item')
        intent = needs[item['queryId']]['informationNeed']
        relevance_items.append({**item, 'intent': intent, 'context': f"Query: {query['text']}\nInformation need: {intent}\nCandidate entry:\n{content}", 'run_id': run['id']})
    return query_items, relevance_items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('run', 'manifest', 'proposals', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    query_items, relevance_items = prepare(*[json.loads(p.read_text()) for p in (args.run, args.manifest, args.proposals)])
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name, items in [('explore', query_items), ('relevance', relevance_items)]:
        path = args.output / (name + '.jsonl')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            for item in items:
                stream.write(json.dumps(item, ensure_ascii=False) + '\n')
    print(json.dumps({'queries': len(query_items), 'relevancePairs': len(relevance_items)}))


if __name__ == '__main__':
    main()
