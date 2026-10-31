import copy
import unittest

from prepare_review_tasks import prepare


class PrepareReviewTasksTest(unittest.TestCase):
    def fixture(self):
        entry = {'id': 'e', 'title': 'Example', 'content': 'Synthetic answer', 'contentHash': 'eh'}
        query = {'id': 'q', 'text': 'Example question?', 'textHash': 'qh', 'family': 'examples'}
        run = {'id': 'run1', 'status': 'complete', 'datasetHash': 'dh', 'dataset': {'entries': [entry], 'queries': [query]}, 'rankings': [
            {'queryId': 'q', 'configuration': c, 'repeat': 1, 'k': 10, 'retrievedIds': ['e']} for c in ('relevance', 'recency', 'importance', 'combined')]}
        manifest = {'schemaVersion': 1, 'datasetHash': 'dh', 'items': [{'id': 'pair', 'entryId': 'e', 'queryId': 'q', 'entryHash': 'eh', 'queryHash': 'qh', 'content': 'Example\n\nSynthetic answer', 'query': 'Example question?'}]}
        proposals = {'queries': [{**query, 'informationNeed': 'Understand the example', 'seedJudgments': [{'grade': 2}]}]}
        return run, manifest, proposals

    def test_renders_rankings_and_deduplicated_pairs_without_seed_labels(self):
        queries, pairs = prepare(*self.fixture())
        self.assertEqual(len(queries), 1)
        self.assertEqual(len(pairs), 1)
        self.assertIn('1. Example', queries[0]['relevance_results'])
        self.assertEqual(pairs[0]['id'], 'pair')
        self.assertEqual(pairs[0]['intent'], 'Understand the example')
        self.assertNotIn('seedJudgments', pairs[0])
        self.assertNotIn('labels', pairs[0])

    def test_rejects_incomplete_runs_and_stale_inputs(self):
        base = self.fixture()
        for part, key, value in [(0, 'status', 'failed'), (1, 'datasetHash', 'other')]:
            args = copy.deepcopy(base)
            args[part][key] = value
            with self.assertRaises(ValueError): prepare(*args)
        args = copy.deepcopy(base)
        args[2]['queries'][0]['text'] = 'Changed question'
        with self.assertRaises(ValueError): prepare(*args)
        args = copy.deepcopy(base)
        args[0]['rankings'].pop()
        with self.assertRaises(ValueError): prepare(*args)


if __name__ == '__main__':
    unittest.main()
