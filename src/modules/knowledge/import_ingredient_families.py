"""Import reviewed name/source relationships; never infer from 'may contain' lists.

python src/modules/knowledge/import_ingredient_families.py --fetch
Without --fetch, rebuild deterministically from the ignored downloaded HTML.
New aliases/sections require review; a source change or missing alias fails closed.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata
import urllib.request

MODULE = Path(__file__).resolve().parent
ROOT = MODULE.parents[2]
BASE = 'https://www.canada.ca/en/health-canada/services/food-nutrition/reports-publications/food-safety/'


def normalize(text):
    return ' '.join(re.sub(r'[^\w]+', ' ', unicodedata.normalize('NFKC', text.replace('™', '')).lower()).split())


class Lists(HTMLParser):
    """Read only the first list immediately following a reviewed heading."""
    def __init__(self, headings):
        super().__init__()
        self.headings = set(headings)
        self.sections = {}
        self.label = ''
        self.label_tag = None
        self.pending = None
        self.active = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('h2', 'h3', 'h4', 'strong'):
            self.label_tag, self.label = tag, ''
            if tag.startswith('h'):
                self.pending = None
        if tag == 'ul':
            if self.depth == 0 and self.pending:
                self.active = self.pending
                if self.active in self.sections:
                    raise ValueError('Repeated source section: ' + self.active)
                self.sections[self.active] = []
                self.pending = None
            self.depth += 1

    def handle_data(self, data):
        if self.label_tag:
            self.label += data
        if self.active:
            self.sections[self.active].append(data)

    def handle_endtag(self, tag):
        if tag == self.label_tag:
            label = ' '.join(self.label.split())
            self.pending = label if label in self.headings else None
            self.label_tag = None
        if tag == 'ul':
            self.depth -= 1
            if self.depth == 0:
                self.active = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    review = json.loads((MODULE / 'ingredient-families.review.json').read_text(encoding='utf-8'))
    cache = ROOT / '.data/sources/ingredient-families'
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    for family in review['families']:
        url = BASE + family['slug'] + '.html'
        path = cache / ('health-canada-' + family['family'] + '.html')
        if args.fetch:
            with urllib.request.urlopen(url, timeout=30) as response:
                if response.geturl() != url:
                    raise ValueError('Unexpected source redirect')
                data = response.read(1_000_001)
            if len(data) > 1_000_000:
                raise ValueError('Source too large')
            path.write_bytes(data)
        data = path.read_bytes()
        html = data.decode('utf-8')
        extract = Lists(family['sections'])
        extract.feed(html)
        aliases = []
        for section, reviewed_aliases in family['sections'].items():
            if section not in extract.sections:
                raise ValueError('Missing source section: ' + section)
            section_text = normalize(' '.join(extract.sections[section]))
            if hashlib.sha256(section_text.encode()).hexdigest() != family['sectionHashes'][section]:
                raise ValueError('Source section changed; review before updating: ' + section)
            text = ' ' + section_text + ' '
            for alias in reviewed_aliases:
                if ' ' + normalize(alias) + ' ' not in text:
                    raise ValueError('Alias absent from reviewed section: ' + alias)
                aliases.append({'name': alias, 'section': section})
        dates = re.findall(r'<(?:time|gcds-date-modified)\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*</(?:time|gcds-date-modified)>', html)
        if not dates:
            raise ValueError('Source date missing')
        records.append({
            'family': family['family'], 'sourceId': 'health-canada-allergen-' + family['family'],
            'title': family['title'], 'url': url, 'pageModifiedAt': dates[-1],
            'reviewedAt': review['reviewedAt'], 'sha256': hashlib.sha256(data).hexdigest(),
            'aliases': aliases,
        })
    output = {'version': review['reviewedAt'], 'policyUrl': review['policyUrl'], 'reuse': review['reuse'], 'records': records}
    (MODULE / 'ingredient-families.data.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'families': len(records), 'aliases': sum(len(record['aliases']) for record in records)}))


if __name__ == '__main__':
    main()
