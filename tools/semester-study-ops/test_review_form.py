import base64
import hashlib
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from review_form import render_form

class FormParser(HTMLParser):
    def __init__(self):super().__init__();self.scripts=[];self.attrs=[];self.current=None;self.csp=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='meta' and a.get('http-equiv')=='Content-Security-Policy':self.csp=a['content']
        if tag=='script':self.current='';self.attrs.append(a)
    def handle_data(self,data):
        if self.current is not None:self.current+=data
    def handle_endtag(self,tag):
        if tag=='script':self.scripts.append(self.current);self.current=None

class ReviewFormTests(unittest.TestCase):
    def test_hostile_text_never_creates_an_executable_script(self):
        hostile='</script><script>alert(1)</script><img src=x onerror=alert(1)>'
        h=render_form([{'displayedResponse':hostile}],{'x':hostile},['dimension'],'synthetic')
        parser=FormParser();parser.feed(h)
        self.assertEqual(len(parser.scripts),2)
        self.assertEqual(json.loads(parser.scripts[0])['packets'][0]['displayedResponse'],hostile)
        expected=base64.b64encode(hashlib.sha256(parser.scripts[1].encode()).digest()).decode()
        self.assertIn("'sha256-"+expected+"'",parser.csp)
        self.assertIn("connect-src 'none'",parser.csp)
        self.assertNotIn(hostile,h)
    def test_no_network_or_untrusted_html_sink(self):
        script=Path(__file__).with_name('review_form.js').read_text()
        self.assertNotRegex(script,r'innerHTML|outerHTML|insertAdjacentHTML|\beval\(|\bfetch\(|XMLHttpRequest|WebSocket')
        self.assertIn('textContent=p.displayedResponse',script)
        self.assertIn("el('persist').checked",script)
if __name__=='__main__':unittest.main()
