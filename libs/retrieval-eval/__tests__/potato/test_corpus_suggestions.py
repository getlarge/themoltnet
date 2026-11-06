import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from corpus_suggestions import prepare, publish


class CorpusSuggestionsTest(unittest.TestCase):
    def test_native_choices_provenance_and_stale_input_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            db_path = Path(temporary) / 'engine.sqlite'
            item = {'id': 'entry-1', 'content': 'Synthetic example'}
            digest = hashlib.sha256(item['content'].encode()).hexdigest()[:32]
            with sqlite3.connect(db_path) as db:
                db.execute('CREATE TABLE engine_item (item_id TEXT, content_hash TEXT)')
                db.execute('CREATE TABLE current_prediction (id INTEGER, item_id TEXT, schema_name TEXT, source_version_id TEXT, status TEXT, value_json TEXT, raw_conf REAL, call_ids_json TEXT)')
                db.execute('CREATE TABLE model_call (id INTEGER, input_hash TEXT, source_version_id TEXT, error TEXT)')
                db.execute('INSERT INTO model_call VALUES (1, ?, ?, NULL)', (digest, 'v1'))
                db.execute('INSERT INTO engine_item VALUES (?, ?)', ('entry-1', digest))
                db.execute('INSERT INTO current_prediction VALUES (1, ?, ?, ?, ?, ?, 0.9, ?)', ('entry-1', 'corpus_decision', 'v1', 'ok', json.dumps('Needs editing'), '[1]'))
            choices, provenance = prepare(db_path, [item], 'v1')
            self.assertEqual(choices, {'entry-1': {'corpus_decision': 'Needs editing'}})
            self.assertEqual(provenance['entry-1']['source_version'], 'v1')
            output = Path(temporary) / 'suggestions.json'
            publish(output, choices)
            self.assertEqual(json.loads(output.read_text()), choices)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            for items, version in [([item, item], 'v1'), ([item], 'v2'), ([{**item, 'content': 'Changed'}], 'v1')]:
                with self.assertRaises(ValueError):
                    prepare(db_path, items, version)
            with sqlite3.connect(db_path) as db:
                db.execute("UPDATE current_prediction SET status = 'error'")
            with self.assertRaises(ValueError):
                prepare(db_path, [item], 'v1')

    def test_query_and_relevance_suggestions_bind_to_complete_context(self):
        for schema, label in [('decision', 'Revise'), ('relevance', 'Supports')]:
            with self.subTest(schema=schema), tempfile.TemporaryDirectory() as temporary:
                db_path = Path(temporary) / 'engine.sqlite'
                item = {'id': 'pair', 'content': 'Entry alone', 'context': 'Query: why? Information need: cause. Entry: evidence'}
                digest = hashlib.sha256(item['context'].encode()).hexdigest()[:32]
                with sqlite3.connect(db_path) as db:
                    db.execute('CREATE TABLE current_prediction (id INTEGER, item_id TEXT, schema_name TEXT, source_version_id TEXT, status TEXT, value_json TEXT, raw_conf REAL, call_ids_json TEXT)')
                    db.execute('CREATE TABLE model_call (id INTEGER, input_hash TEXT, source_version_id TEXT, error TEXT)')
                    db.execute('INSERT INTO model_call VALUES (1, ?, ?, NULL)', (digest, 'v1'))
                    db.execute('INSERT INTO current_prediction VALUES (1, ?, ?, ?, ?, ?, 0.9, ?)', ('pair', schema, 'v1', 'ok', json.dumps(label), '[1]'))
                choices, _ = prepare(db_path, [item], 'v1', schema)
                self.assertEqual(choices, {'pair': {schema: label}})
                with self.assertRaises(ValueError):
                    prepare(db_path, [{**item, 'context': 'Different query, same entry'}], 'v1', schema)
                with sqlite3.connect(db_path) as db:
                    db.execute('UPDATE current_prediction SET value_json = ?', (json.dumps('Approve unchanged'),))
                with self.assertRaises(ValueError):
                    prepare(db_path, [item], 'v1', schema)


if __name__ == '__main__':
    unittest.main()
