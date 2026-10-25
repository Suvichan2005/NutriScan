"""Import the complete visible Codex category hierarchy, not additive provisions.
Usage: python src/modules/knowledge/import_codex_categories.py --source-html PATH --output .data/knowledge/codex-categories.json --retrieved-at YYYY-MM-DD
Raw HTML and generated records remain private/local under FAO research terms.
"""
import argparse, hashlib, json, re
from html.parser import HTMLParser
from pathlib import Path

SOURCE='https://codex.fao.org/codex-texts/codex-online-databases/gsfa/food-categories'
class Categories(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True);self.stack=[];self.rows=[];self.capture=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='li':
   row=None
   if 'category-item' in a.get('class','').split():
    code=a.get('data-category-code','');identifier=a.get('data-category-id','')
    if not re.fullmatch(r'\d{2}(?:\.\d+)+',code) or not re.fullmatch(r'[0-9a-f-]{36}',identifier):raise ValueError('Invalid source category identity')
    parent=next((r for r in reversed(self.stack) if r is not None),None)
    row={'code':code,'id':identifier,'label':'','parentCode':parent['code'] if parent else None,'sourceTable3Attribute':a.get('data-in-table3'),'sourceUrl':SOURCE+'/food-category-details?categoryId='+identifier}
    self.rows.append(row)
   self.stack.append(row)
  if tag=='span' and 'category-label' in a.get('class','').split():
   row=next((r for r in reversed(self.stack) if r is not None),None)
   if row is not None:self.capture=(row,[])
 def handle_data(self,data):
  if self.capture is not None:self.capture[1].append(data)
 def handle_endtag(self,tag):
  if tag=='span' and self.capture is not None:
   row,text=self.capture;row['label']=' '.join(''.join(text).split());self.capture=None
  if tag=='li' and self.stack:self.stack.pop()

def import_categories(content:bytes,retrieved_at:str):
 parser=Categories();parser.feed(content.decode('utf-8'));rows=parser.rows
 if not rows or any(not r['label'] for r in rows) or len({r['code'] for r in rows})!=len(rows) or len({r['id'] for r in rows})!=len(rows):raise ValueError('Empty, incomplete or duplicate category identity')
 codes={r['code'] for r in rows}
 if any(r['parentCode'] and r['parentCode'] not in codes for r in rows):raise ValueError('Missing parent')
 return {'schemaVersion':1,'sourceUrl':SOURCE,'sourceSha256':hashlib.sha256(content).hexdigest(),'retrievedAt':retrieved_at,'declaredScope':'Every category-item in the pinned English category hierarchy page; no detail-page descriptions, additive provisions or notes.','rights':{'termsUrl':'https://www.fao.org/contact-us/terms/','status':'Private study/research/teaching/non-commercial use with FAO acknowledgement; commercial reuse requires review. No FAO endorsement.','redistribution':'Original and normalized source data excluded from Git.'},'limitations':['International category hierarchy, not Indian law or package classification.','Raw source Table3 attribute is preserved but is not an applicability ruling; inspect preamble, notes and category-specific provisions.','Source version is the retrieval date/hash, not a legal effective date.'],'accounting':{'categoryCount':len(rows),'parentEdges':sum(r['parentCode'] is not None for r in rows),'uniqueCodes':len(codes)},'categories':rows}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-html',required=True);p.add_argument('--output',required=True);p.add_argument('--retrieved-at',required=True);p.add_argument('--verify',action='store_true');a=p.parse_args();result=import_categories(Path(a.source_html).read_bytes(),a.retrieved_at);target=Path(a.output)
 if a.verify:
  saved=json.loads(target.read_text(encoding='utf-8'));assert saved['sourceSha256']==result['sourceSha256'] and saved['categories']==result['categories'] and saved['accounting']==result['accounting'];print(json.dumps({'verified':True,**result['accounting']}))
 else:
  result['sourceFile']=a.source_html;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result['accounting']))
