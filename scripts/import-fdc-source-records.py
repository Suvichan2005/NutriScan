"""Preserve both authorized pinned FDC JSON partitions without field projection.

Original releases and this indexed detail store remain ignored/local. No network.
"""
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCES=[
 ('fdc-foundation-2026-04','.data/fdc-foundation-source-2026-04/FoodData_Central_foundation_food_json_2026-04-30.json','27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc',395,363),
 ('fdc-fndds-2021-2023','.data/fdc-fndds-source-2024-10/surveyDownload.json','2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808',5432,5432),
]

def build():
 output=ROOT/'.data/food-composition/fdc-source-records.sqlite'
 temporary=output.with_suffix('.sqlite.tmp')
 if temporary.exists(): raise RuntimeError('Inspect existing unfinished import before retrying.')
 output.parent.mkdir(parents=True,exist_ok=True)
 manifests=[]
 with closing(sqlite3.connect(temporary)) as db,db:
  db.executescript('CREATE TABLE sources(id TEXT PRIMARY KEY,metadata TEXT NOT NULL);CREATE TABLE records(release TEXT NOT NULL,fdc_id INTEGER NOT NULL,source_index INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(release,fdc_id)) WITHOUT ROWID;')
  for release,relative,expected,slots,count in SOURCES:
   raw=(ROOT/relative).read_bytes()
   if hashlib.sha256(raw).hexdigest()!=expected: raise ValueError('Pinned source checksum mismatch: '+release)
   data=json.loads(raw);foods=next(value for value in data.values() if isinstance(value,list))
   assert len(foods)==slots
   eligible=[(i,food) for i,food in enumerate(foods) if isinstance(food,dict) and food.get('fdcId')]
   assert len(eligible)==count
   manifest={'id':release,'sourceSha256':expected,'sourceSlots':slots,'eligibleFoods':count,'excludedNullSlots':[i for i,food in enumerate(foods) if food is None],'license':'CC0; USDA attribution requested','rootFields':sorted({key for _,food in eligible for key in food})}
   assert count+len(manifest['excludedNullSlots'])==slots
   for index,food in eligible:db.execute('INSERT INTO records VALUES(?,?,?,?)',(release,food['fdcId'],index,json.dumps(food,ensure_ascii=False,separators=(',',':'))))
   # Compare complete parsed objects, not only counts or selected nutrient amounts.
   saved={row[0]:json.loads(row[1]) for row in db.execute('SELECT fdc_id,record_json FROM records WHERE release=?',(release,))}
   assert saved=={food['fdcId']:food for _,food in eligible}
   manifest['completeObjectEqualityVerified']=True
   db.execute('INSERT INTO sources VALUES(?,?)',(release,json.dumps(manifest)))
   manifests.append(manifest)
  assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 temporary.replace(output)
 (output.with_suffix('.manifest.json')).write_text(json.dumps({'schemaVersion':1,'sources':manifests},indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'output':str(output),'bytes':output.stat().st_size,'sources':manifests}))

if __name__=='__main__':build()
