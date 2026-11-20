import copy
import unittest
from pathlib import Path

import yaml
from jinja2 import Environment
from prepare_ranked_layout import build_layout, full_entry_index, RANKINGS


class RankedLayoutTest(unittest.TestCase):
    def setUp(self):
        self.config = yaml.safe_load((Path(__file__).resolve().parents[2] / 'potato/tasks/queries/config.yaml').read_text())
        self.full_text = '<img src=x onerror=bad()> ' + 'long evidence ' * 30 + '\nTHE END {{ 7 * 7 }} {% set bad = 1 %}'
        self.run = {'id': 'run', 'status': 'complete', 'dataset': {
            'entries': [{'id': 'e1', 'title': '<script>bad()</script>', 'content': self.full_text}, {'id': 'e2', 'title': 'Second title', 'content': 'Other evidence'}],
            'queries': [{'id': 'q', 'text': 'Why?'}]},
            'rankings': [{'queryId': 'q', 'configuration': key, 'repeat': 1, 'k': 10, 'retrievedIds': ['e1', 'e2']} for key, _ in RANKINGS]}
        frozen = full_entry_index(self.run)['q-run']
        self.record = {'id': 'q-run', 'query': 'Why?', 'run_id': 'run', **{key + '_results': frozen[key]['preview'] for key, _ in RANKINGS}}

    def render(self, record):
        return Environment(autoescape=True).from_string(build_layout(self.config, self.run)).render(instance_record=record)

    def test_full_entries_preserve_order_and_escape_html_and_template_syntax(self):
        html = self.render(self.record)
        self.assertEqual(html.count('<li>'), 8)
        self.assertEqual(html.count('Read full entry'), 8)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('&lt;img', html)
        self.assertNotIn('<script>bad()', html)
        self.assertLess(html.index('&lt;script&gt;'), html.index('Second title'))
        self.assertIn('THE END {{ 7 * 7 }} {% set bad = 1 %}', html)
        for name in ['decision', 'rewrite', 'notes']:
            self.assertIn(name, html)

    def test_stale_run_query_or_ranking_cannot_show_wrong_full_text(self):
        for key, value in [('run_id', 'other'), ('id', 'different'), ('query', 'Changed?')]:
            record = {**self.record, key: value}
            html = self.render(record)
            self.assertNotIn('Read full entry', html)
            self.assertNotIn('THE END', html)
        record = {**self.record, 'relevance_results': self.record['relevance_results'].replace('1.', '9.', 1)}
        self.assertEqual(self.render(record).count('Read full entry'), 6)

    def test_incomplete_run_is_rejected(self):
        run = copy.deepcopy(self.run)
        run['rankings'].pop()
        with self.assertRaises(ValueError): full_entry_index(run)
        run['status'] = 'failed'
        with self.assertRaises(ValueError): full_entry_index(run)


if __name__ == '__main__':
    unittest.main()
