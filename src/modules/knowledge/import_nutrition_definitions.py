import xml.etree.ElementTree as ET, hashlib, json, pathlib, sys
src=pathlib.Path(sys.argv[1]); raw=src.read_bytes(); root=ET.fromstring(raw); entries=[]
for node in root.findall('term-group'):
 term=(node.findtext('term') or '').lstrip('> ').strip(); text=(node.findtext('definition') or '').lstrip('> ').strip()
 if term and text and '\ufffd' not in text:
  entries.append({'term':term,'text':text,'publisher':node.get('reference') or 'MedlinePlus','url':node.get('reference-url') or 'https://medlineplus.gov/definitions/nutritiondefinitions.html'})
out=pathlib.Path(sys.argv[2]); out.write_text(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'source':'https://medlineplus.gov/xml/nutritiondefinitions.xml','updated':root.get('last-updated'),'entries':entries},ensure_ascii=False,indent=2),encoding='utf-8');print('usable definitions:',len(entries),'of',len(root))
