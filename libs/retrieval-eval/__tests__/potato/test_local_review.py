import json
from pathlib import Path
import tempfile
import unittest

import yaml
from local_review import create_tasks
import test_prepare_review_tasks


class LocalReviewTest(unittest.TestCase):
    def test_creates_isolated_tasks_and_refuses_overwriting_annotations(self):
        run, manifest, proposals = test_prepare_review_tasks.PrepareReviewTasksTest().fixture()
        manifest['items'][0]['id'] = 'a' * 64
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'round1'
            result = create_tasks(run, manifest, proposals, output)
            self.assertEqual(result['queries'], 1)
            self.assertEqual(result['pairs'], 1)
            for task in ('explore', 'relevance'):
                config = yaml.safe_load((output / task / 'config.yaml').read_text())
                self.assertEqual(config['host'], '127.0.0.1')
                self.assertTrue(config['user_config']['allow_all_users'])
                self.assertFalse(config['require_password'])
                self.assertEqual(len(config['secret_key']), 64)
                self.assertNotIn('labeling_engine', config)
                self.assertTrue((output / task / config['task_layout']).exists())
            groups = [json.loads(line) for line in (output / 'relevance/items.jsonl').read_text().splitlines()]
            self.assertEqual(groups[0]['pairs'][0]['id'], 'a' * 64)
            before = (output / 'relevance/items.jsonl').read_text()
            with self.assertRaises(FileExistsError): create_tasks(run, manifest, proposals, output)
            self.assertEqual((output / 'relevance/items.jsonl').read_text(), before)
