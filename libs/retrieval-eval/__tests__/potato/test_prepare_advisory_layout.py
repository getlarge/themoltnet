import hashlib
import unittest

from bs4 import BeautifulSoup
from jinja2 import Environment
from prepare_advisory_layout import build_layout


class AdvisoryLayoutTest(unittest.TestCase):
    def setUp(self):
        self.config = {'annotation_schemes': [{'annotation_type': 'radio', 'name': 'decision', 'description': 'Choose', 'labels': ['Keep exploring', 'Revise', 'Drop']}]}
        self.item = {'id': 'one', 'context': '<script>bad()</script> {{7*7}}'}
        self.predictions = {'one': {'decision': 'Keep exploring'}}
        self.provenance = {'one': {'input_hash': hashlib.sha256(self.item['context'].encode()).hexdigest()[:32]}}

    def test_suggestion_never_becomes_checked_form_value(self):
        template = build_layout(self.config, [self.item], self.predictions, self.provenance)
        html = Environment(autoescape=True).from_string(template).render(instance_record=self.item)
        soup = BeautifulSoup(html, 'html.parser')
        self.assertIn('Model suggestion: Keep exploring', html)
        self.assertEqual(len(soup.select('input[type=radio]')), 3)
        self.assertEqual(soup.select('input[checked]'), [])
        self.assertNotIn('<script>', html)
        stale = Environment().from_string(template).render(instance_record={**self.item, 'context': 'changed'})
        self.assertNotIn('Model suggestion:', stale)

    def test_stale_provenance_rejected(self):
        with self.assertRaises(ValueError):
            build_layout(self.config, [{**self.item, 'context': 'changed'}], self.predictions, self.provenance)

    def test_existing_layout_preserved(self):
        self.assertTrue(build_layout(self.config, [self.item], self.predictions, self.provenance, '<p>Original</p>').endswith('<p>Original</p>'))


if __name__ == '__main__':
    unittest.main()
