"""Import/verify every PDF text-layer page of the pinned guideline scope.
Install requirements-guidelines.txt; run from repository root. Data stays ignored.
"""
import argparse,hashlib,json,sqlite3
from pathlib import Path
import pdfplumber

def extract(source,root):
 p=root/source['filename'];raw=p.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError('Source hash mismatch: '+source['id'])
 with pdfplumber.open(p) as doc:
  if len(doc.pages)!=source['expectedPages']:raise ValueError('Page count mismatch')
  return [page.extract_text()or''for page in doc.pages]

def build(manifest,root,target,verify=False):
 target.parent.mkdir(parents=True,exist_ok=True);totals={'documents':0,'pages':0,'characters':0,'emptyPages':0}
 connection=sqlite3.connect(f'{target.resolve().as_uri()}?mode=ro',uri=True)if verify else sqlite3.connect(target)
 try:
  if not verify:
   connection.executescript('CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,metadata TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pages(document_id TEXT,page INTEGER,text TEXT,text_sha256 TEXT,PRIMARY KEY(document_id,page)); CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(document_id UNINDEXED,page UNINDEXED,text);')
  with connection:
   for source in manifest['sources']:
    pages=extract(source,root)
    if verify:
     stored=connection.execute('SELECT page,text,text_sha256 FROM pages WHERE document_id=? ORDER BY page',(source['id'],)).fetchall()
     if len(stored)!=len(pages):raise ValueError('Stored page count mismatch')
     indexed=connection.execute('SELECT CAST(page AS INTEGER),text FROM page_fts WHERE document_id=? ORDER BY CAST(page AS INTEGER)',(source['id'],)).fetchall()
     if indexed!=list(enumerate(pages,1)):raise ValueError('FTS/source page mismatch')
     for (number,text,digest),expected in zip(stored,pages):
      if text!=expected or digest!=hashlib.sha256(expected.encode()).hexdigest():raise ValueError('Source text mismatch')
    else:
     metadata={**source,'license':manifest['license'],'declaredScope':manifest['declaredScope']};connection.execute('INSERT OR REPLACE INTO documents VALUES(?,?)',(source['id'],json.dumps(metadata,ensure_ascii=False)));connection.execute('DELETE FROM pages WHERE document_id=?',(source['id'],));connection.execute('DELETE FROM page_fts WHERE document_id=?',(source['id'],))
     for number,text in enumerate(pages,1):connection.execute('INSERT INTO pages VALUES(?,?,?,?)',(source['id'],number,text,hashlib.sha256(text.encode()).hexdigest()));connection.execute('INSERT INTO page_fts VALUES(?,?,?)',(source['id'],number,text))
    totals['documents']+=1;totals['pages']+=len(pages);totals['characters']+=sum(map(len,pages));totals['emptyPages']+=sum(not p for p in pages)
  if connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Integrity failure')
  totals['verified']=verify;totals['sourceHashes']={source['id']:source['sha256'] for source in manifest['sources']};totals['pageTextRoundtripVerified']=verify;totals['ftsAllPagesCompared']=verify;return totals
 finally:connection.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--manifest',default='data/guideline-sources.json');p.add_argument('--source-dir',default='.data/sources/who-guidelines');p.add_argument('--output',default='.data/knowledge/guidelines.sqlite');p.add_argument('--verify',action='store_true');a=p.parse_args();result=build(json.loads(Path(a.manifest).read_text(encoding='utf-8')),Path(a.source_dir),Path(a.output),a.verify)
 if a.verify:Path(a.output).with_suffix('.verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps(result))
