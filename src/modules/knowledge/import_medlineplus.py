"""Build local MedlinePlus health-topic FTS from an official downloaded XML snapshot."""
import hashlib, html, re, sqlite3, sys, xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
class Text(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True); self.parts=[]
 def handle_data(self, data): self.parts.append(data)
 def handle_starttag(self,tag,attrs):
  if tag in ('p','li','h2','h3','br'): self.parts.append('\n')
 def handle_endtag(self,tag):
  if tag in ('p','li','h2','h3'): self.parts.append('\n')
src=Path(sys.argv[1]); out=Path(sys.argv[2]); raw=src.read_bytes(); digest=hashlib.sha256(raw).hexdigest()
# Build independently; never overwrite a pre-existing database.
if out.exists(): raise SystemExit('Output already exists; select a new path')
db=sqlite3.connect(out)
db.executescript('CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE passages (id TEXT PRIMARY KEY,title TEXT,url TEXT,aliases TEXT,text TEXT); CREATE VIRTUAL TABLE passage_fts USING fts5(id UNINDEXED,title,aliases,text);')
count=0; topics=0
for _,el in ET.iterparse(src,events=('end',)):
 if el.tag!='health-topic': continue
 if el.get('language')!='English': el.clear(); continue
 rawhtml=el.findtext('full-summary') or ''; parser=Text(); parser.feed(rawhtml)
 paras=[re.sub(r'\s+',' ',p).strip() for p in ''.join(parser.parts).splitlines()]; paras=[p for p in paras if 35<=len(p)<=1400]
 aliases='; '.join((e.text or '') for e in el if e.tag in ('also-called','see-reference'))[:3000]
 title=el.get('title',''); url=el.get('url',''); topics+=1
 if not url.startswith('https://medlineplus.gov/'): el.clear(); continue
 for i,text in enumerate(paras):
  ident=f"medline-{el.get('id')}-{i}"; row=(ident,title,url,aliases,text)
  db.execute('INSERT INTO passages VALUES (?,?,?,?,?)',row); db.execute('INSERT INTO passage_fts VALUES (?,?,?,?)',(ident,title,aliases,text)); count+=1
 el.clear()
for k,v in {'source_url':'https://medlineplus.gov/xml.html','snapshot':src.name,'sha256':digest,'attribution':'MedlinePlus, U.S. National Library of Medicine','topics':str(topics),'passages':str(count)}.items(): db.execute('INSERT INTO metadata VALUES (?,?)',(k,v))
db.commit();db.close();print(f'topics={topics} passages={count} sha256={digest}')
