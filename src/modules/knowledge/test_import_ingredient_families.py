"""Offline importer boundary tests; not independent clinical/ingredient evaluation."""
import unittest
from import_ingredient_families import Lists, normalize


class SourceSectionTests(unittest.TestCase):
    def test_keeps_names_separate_from_possible_sources(self):
        parser = Lists(['Other names for milk', 'Common sources of milk'])
        parser.feed('<h3>Other names for milk</h3><p>Intro.</p><ul><li>Whey</li></ul>'
                    '<p><strong>Common sources of milk</strong></p><ul><li>Ghee</li></ul>'
                    '<p><strong>Other possible sources</strong></p><ul><li>Chocolate</li></ul>')
        self.assertEqual(normalize(' '.join(parser.sections['Other names for milk'])), 'whey')
        self.assertEqual(normalize(' '.join(parser.sections['Common sources of milk'])), 'ghee')

    def test_missing_and_duplicate_sections_do_not_silently_combine(self):
        parser = Lists(['Other names for soy'])
        parser.feed('<h3>Possible sources of soy</h3><ul><li>Vegetable protein</li></ul>')
        self.assertEqual(parser.sections, {})
        with self.assertRaisesRegex(ValueError, 'Repeated source section'):
            parser.feed('<h3>Other names for soy</h3><ul><li>Tofu</li></ul>'
                        '<h3>Other names for soy</h3><ul><li>Edamame</li></ul>')


if __name__ == '__main__':
    unittest.main()
