import copy
import hashlib
import unittest

from jinja2 import Environment
from bs4 import BeautifulSoup
from grouped_relevance import flatten, prepare


class GroupedRelevanceTest(unittest.TestCase):
    def fixture(self):
        pairs = [dict(id=str(i) * 64, queryId='q', query='Question?', queryHash='qh',
                      entryId='e' + str(i), entryHash='eh', content='Title {{7*7}}\n<script>bad</script>',
                      intent='Need', context='Exact model input', run_id='run') for i in (1, 2)]
        return prepare({}, pairs, {pairs[0]['id']: {'relevance': 'Supports'}},
                       {pairs[0]['id']: {'input_hash': hashlib.sha256(pairs[0]['context'].encode()).hexdigest()[:32]}})

    def test_native_controls_escape_content_and_never_preselect_advice(self):
        config, groups, layout = self.fixture()
        markup = Environment(autoescape=True).from_string(layout).render(instance_record=groups[0])
        soup = BeautifulSoup(markup, 'html.parser')
        self.assertEqual(len(soup.select('input[type=radio]')), 6)
        self.assertEqual(len(soup.select('textarea')), 2)
        self.assertEqual(len(soup.select('details')), 2)
        self.assertFalse(soup.select('input[checked]'))
        self.assertFalse(soup.select('form form'))
        self.assertEqual(len(soup.select('script')), 1)
        self.assertNotIn('bad', soup.script.get_text())
        self.assertIn('Title {{7*7}}', soup.get_text())
        self.assertIn('<script>bad</script>', soup.get_text())
        self.assertEqual(config['annotation_schemes'][0]['annotation_type'], 'multirate')

    def test_partial_ratings_flatten_to_original_pairs_with_origin(self):
        _, groups, _ = self.fixture()
        pair = groups[0]['pairs'][0]['id']
        row = {'instance_id': groups[0]['id'], 'user_id': 'human',
               'annotator_origin': {'kind': 'human'},
               'labels': {'relevance': {pair: 'Supports'}, 'reason_' + pair: {'text_box': 'Evidence'}}}
        result = flatten(groups, [row], 'human')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['instance_id'], pair)
        self.assertEqual(result[0]['labels']['relevance'], {'Supports': 'Supports'})
        self.assertEqual(result[0]['annotator_origin'], row['annotator_origin'])
        for change in ('reason', 'unknown', 'duplicate', 'stale'):
            g, rows = copy.deepcopy(groups), [copy.deepcopy(row)]
            if change == 'reason': rows[0]['labels'].pop('reason_' + pair)
            if change == 'unknown': rows[0]['labels']['relevance'] = {'other': 'Answers'}
            if change == 'duplicate': rows.append(rows[0])
            if change == 'stale': g[0]['pairs'][0]['content'] = 'Changed'
            with self.assertRaises(ValueError): flatten(g, rows, 'human')


if __name__ == '__main__':
    unittest.main()
