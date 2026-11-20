"""Project recorded engine predictions into Potato's editable pre-label file.

Run after the engine finishes, with the task stopped. This never writes human
annotations. Potato reads the sidecar at startup and records displayed seeds.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile


SCHEMAS = {
    'corpus_decision': ('content', ['Approve unchanged', 'Needs editing', 'Exclude']),
    'decision': ('context', ['Keep exploring', 'Revise', 'Drop']),
    'relevance': ('context', ['Answers', 'Supports', 'Not relevant']),
}


def prepare(database, items, source_version, schema='corpus_decision'):
    text_key, labels = SCHEMAS[schema]
    predictions = {}
    provenance = {}
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        for item in items:
            item_id = item['id']
            if item_id in predictions:
                raise ValueError('Duplicate item')
            digest = hashlib.sha256(item[text_key].encode()).hexdigest()[:32]
            row = db.execute('SELECT * FROM current_prediction WHERE item_id = ? AND schema_name = ? AND source_version_id = ?', (item_id, schema, source_version)).fetchone()
            if row is None or row['status'] != 'ok':
                raise ValueError('Missing successful decision prediction')
            calls = json.loads(row['call_ids_json'])
            if len(calls) != 1:
                raise ValueError('Expected one recorded decision call')
            call = db.execute('SELECT input_hash, source_version_id, error FROM model_call WHERE id = ?', (calls[0],)).fetchone()
            if call is None or call['error'] or call['source_version_id'] != source_version or call['input_hash'] != digest:
                raise ValueError('Recorded model input differs from this copy; regenerate suggestions')
            label = json.loads(row['value_json'])
            if label not in labels:
                raise ValueError('Invalid decision label')
            predictions[item_id] = {schema: label}
            provenance[item_id] = {'prediction_id': row['id'], 'source_version': source_version, 'input_hash': digest, 'probability': row['raw_conf']}
    if not predictions:
        raise ValueError('No items')
    return predictions, provenance


def publish(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + '.')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--items', required=True)
    parser.add_argument('--source-version', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--schema', choices=SCHEMAS, default='corpus_decision')
    args = parser.parse_args()
    items = [json.loads(line) for line in Path(args.items).read_text().splitlines() if line.strip()]
    predictions, provenance = prepare(args.database, items, args.source_version, args.schema)
    publish(args.output + '.provenance.json', provenance)
    publish(args.output, predictions)
    print(f'Prepared {len(predictions)} editable suggestions; no human annotations written.')


if __name__ == '__main__':
    main()
