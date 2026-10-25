"""Reconcile selected source assets and emit the single knowledge coverage matrix.

No downloads, provider calls, source-text copying or sensitive data inspection.
Counts refer to declared release units; unknown upstream universes stay unknown.
"""
import hashlib
import json
import sqlite3
import csv
import re
import runpy
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))


def digest(relative):
    h = hashlib.sha256()
    with (ROOT / relative).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def source(identifier, role, urls, scope, access, gaps, license_status='Source-specific reuse review pending; do not infer permission from availability.'):
    return {'id': identifier, 'role': role, 'officialUrls': urls, 'declaredScope': scope,
            'version': None, 'expectedRecords': None, 'importedRecords': None, 'countUnit': None,
            'license': license_status, 'fieldsPreserved': [], 'fieldsNotExposed': [], 'integrity': {},
            'retrievalInterface': access, 'gates': {'A_acquisition': 'NOT_VERIFIED', 'B_preservation': 'NOT_VERIFIED', 'C_access': 'PARTIAL', 'D_agent': 'PARTIAL', 'E_answer_utility': 'NOT_INDEPENDENTLY_VERIFIED'},
            'verifiedCapabilities': [], 'remainingGaps': gaps, 'refresh': 'Explicit versioned source refresh and validation; never silently replace evaluation inputs.'}


sources = []
for release in ['foundation-2026-04', 'fndds-2021-2023']:
    prefix = f'.data/food-composition/fdc-{release}'
    catalog = load(prefix + '.catalog.json')
    metadata, stats = catalog['dataset'], catalog['statistics']
    raw_directory = '.data/fdc-foundation-source-2026-04' if 'foundation' in release else '.data/fdc-fndds-source-2024-10'
    raw_path = raw_directory + '/' + metadata['sourceFile']
    raw = load(raw_path)
    raw_foods = next(value for value in raw.values() if isinstance(value, list))
    eligible = [food for food in raw_foods if isinstance(food, dict) and food.get('fdcId')]
    assert len(raw_foods) == stats['sourceFoodSlots']
    assert {food['fdcId'] for food in eligible} == {food['fdcId'] for food in catalog['foods']}
    assert digest(raw_path) == metadata['sourceSha256']
    assert digest(prefix + '.records.jsonl') == metadata['recordsSha256']
    entry = source(metadata['id'], 'Generic nutritional composition; not branded package truth', [metadata['sourceUrl'], metadata['documentationUrl']], 'Every eligible food in the pinned official JSON release; null food slots accounted separately. Complete source records preserve unavailable amounts; normalized numeric projection excludes nonnumeric amounts.', 'src/lib/server/food-composition.ts; search_food_composition native tool', ['Audit full analytical/derivation/portion metadata against raw source; quantify source-field exclusions and demonstrate broader quantitative use.'], metadata['license'])
    entry.update(version=metadata['releaseDate'], expectedRecords=len(eligible), importedRecords=len(catalog['foods']), countUnit='eligible foods', fieldsPreserved=['food IDs/name/category/date/type', 'numeric nutrient IDs/names/units/amounts/data-points/min/max/median/LOQ/derivation', 'usable portions and gram weights'], fieldsNotExposed=['Full raw source remains local; not all analytical/sample/relationship metadata is exposed by the normalized adapter.'], statistics=stats, integrity={'sourceSha256': metadata['sourceSha256'], 'recordsSha256': metadata['recordsSha256'], 'rawHashVerified': True, 'recordsHashVerified': True, 'eligibleIdSetEqual': True}, importCommand=f'npm exec -- tsx scripts/import-fdc-{"foundation" if "foundation" in release else "fndds"}.mts')
    entry['gates'].update(A_acquisition='VERIFIED_DEFINED_RELEASE', B_preservation='PARTIAL_RICH_RAW_SOURCE_RETAINED', C_access='IMPLEMENTED_STRUCTURED_SEARCH', D_agent='IMPLEMENTED_EXISTING_LIVE_EVIDENCE')
    with sqlite3.connect(ROOT/'.data/food-composition/fdc-source-records.sqlite') as store:
        saved={row[0]:json.loads(row[1]) for row in store.execute('SELECT fdc_id,record_json FROM records WHERE release=?',(metadata['id'],))}
        assert saved=={food['fdcId']:food for food in eligible}
    entry['integrity']['completeSourceObjectEqualityVerified']=True
    entry['fieldsPreserved'].append('Every original source object field, nested nutrient derivation, input-food relation, attributes and portion context in exact detail store')
    entry['fieldsNotExposed']=['Responses are paged; individual source items over 24k characters explicitly require original-source inspection.']
    entry['retrievalInterface']+='; get_food_composition_record exact ID/release/field/page access'
    entry['gates'].update(B_preservation='VERIFIED_COMPLETE_SOURCE_OBJECTS',C_access='IMPLEMENTED_SEARCH_EXACT_PAGED_FIELDS',D_agent='LIVE_SEARCH_AND_DETAIL_TOOLS')
    entry['remainingGaps']=['Final-answer utility partial: live roti detail correctly distinguishes survey recipe from package identity; pre-filter Foundation query returned survey records. Corrected scoped Foundation/nutrient-ID live run reported the original protein value, range and NC derivation. Independently adjudicated answer utility remains pending.']
    entry['importCommand']+='; python scripts/import-fdc-source-records.py'
    sources.append(entry)

foodon = load('data/foodon-index.json')
foodon_importer=runpy.run_path(str(ROOT/'src/modules/knowledge/import_foodon.py'))
_,deprecated=foodon_importer['source_version_and_deprecated'](ROOT/'.data/knowledge/foodon.owl')
source_terms={}
with (ROOT/'.data/knowledge/foodon-synonyms.tsv').open(encoding='utf-8',newline='') as handle:
    rows=csv.reader(handle,delimiter='\t');next(rows)
    for row in rows:
        if len(row)<4: continue
        identifier=re.search(r'FOODON_[0-9]{8}',row[0])
        if not identifier or identifier[0] in deprecated: continue
        term=source_terms.setdefault(identifier[0],{'labels':set(),'aliases':set(),'typedAliases':set(),'parents':set()})
        parent=re.search(r'FOODON_[0-9]{8}',row[1])
        if parent and parent[0] not in deprecated: term['parents'].add(parent[0])
        value=row[3].strip()
        if not value or (foodon_importer['LANGUAGE_SUFFIX'].search(value) and not foodon_importer['ENGLISH_SUFFIX'].search(value)): continue
        value=foodon_importer['ENGLISH_SUFFIX'].sub('',value).strip()
        if len(value)>=2 and value[0]==value[-1]=='"': value=value[1:-1]
        value=re.sub(r'\s+',' ',value.replace('\\"','"').replace('\\\\','\\')).strip()
        if row[2].strip()=='label': term['labels'].add(value.casefold())
        elif row[2].strip() in {'synonym','synonym (exact)','synonym (narrow)','synonym (broad)','label (alternative)'}:
            term['aliases'].add(value.casefold())
            kind={'synonym':'synonym','synonym (exact)':'exact','synonym (narrow)':'narrow','synonym (broad)':'broad','label (alternative)':'alternative-label'}[row[2].strip()]
            term['typedAliases'].add((kind,value.casefold()))
source_terms={key:value for key,value in source_terms.items() if value['labels']}
indexed_terms={term['id']:term for term in foodon['terms']}
eligible_ids=set(source_terms)
assert eligible_ids==set(indexed_terms)
for identifier,term in source_terms.items():
    assert term['typedAliases']=={(alias['kind'],alias['text'].casefold()) for alias in indexed_terms[identifier]['aliases']},identifier
    assert term['parents']&eligible_ids==set(indexed_terms[identifier]['parents']),identifier
foodon_accounting={'labelledSynonymExportConceptIds':len(source_terms),'classIdSetEqual':True,'deprecatedOwnClasses':len(deprecated),'uniqueEnglishAliasesBeforeCaps':sum(len(t['aliases']-t['labels']) for t in source_terms.values()),'aliasTextsAbsentFromCompactIndex':sum(len((t['aliases']-t['labels'])-{a['text'].casefold() for a in indexed_terms[key]['aliases']}) for key,t in source_terms.items()),'sourceAliasesOver180Characters':sum(sum(len(a)>180 for a in t['aliases']-t['labels']) for t in source_terms.values()),'classesExceeding24Aliases':sum(len(t['aliases']-t['labels'])>24 for t in source_terms.values()),'scope':'Pinned TSV labelled own-namespace English terms excluding OWL-deprecated declarations. This does not prove every TSV ID has a current OWL declaration.'}
f = source('foodon', 'Food/ingredient ontology identity and hierarchy; no health or composition authority', [foodon['source']['ontologyUrl'], foodon['source']['synonymExportUrl']], 'Pinned own-namespace labelled OWL/TSV identity projection plus named OWL class-source properties and annotated-source axioms where the source store is verified; no OWL entailment engine.', 'searchFoodOn + readFoodOnConcept; resolve_ingredient + get_ingredient_concept native tools', ['Declared class, typed alias and direct-edge sets reconcile exactly. OWL restrictions/non-taxonomic relations remain outside the projection; final answer had one withheld quantity and broad outcome utility is unverified.'], foodon['source']['license'])
f.update(version=foodon['source']['version'], importedRecords=len(foodon['terms']), countUnit='labelled index concept IDs', fieldsPreserved=['stable FOODON IDs', 'English labels and typed synonyms', 'direct internal parent IDs', 'full original OWL/TSV locally'], statistics={'indexedAliases': sum(len(t['aliases']) for t in foodon['terms']), 'indexedParentEdges': sum(len(t['parents']) for t in foodon['terms'])}, integrity={'ontologySha256': digest('.data/knowledge/foodon.owl'), 'synonymExportSha256': digest('.data/knowledge/foodon-synonyms.tsv')}, importCommand='python src/modules/knowledge/import_foodon.py')
assert f['integrity']['ontologySha256'] == foodon['source']['ontologySha256']
assert f['integrity']['synonymExportSha256'] == foodon['source']['synonymExportSha256']
f['gates'].update(A_acquisition='VERIFIED_PINNED_SOURCE_FILES', B_preservation='VERIFIED_DECLARED_TAXONOMY_ALIAS_PROJECTION', C_access='IMPLEMENTED_EXACT_AND_PAGED_TAXONOMY', D_agent='LIVE_IDENTITY_AND_CONCEPT_TOOL')
record_proof_path=ROOT/'.data/knowledge/foodon-records.verification.json'
if record_proof_path.exists():
    proof=json.loads(record_proof_path.read_text(encoding='utf-8'))
    assert proof['verified'] and proof['sourceSha256']==foodon['source']['ontologySha256']
    with sqlite3.connect(ROOT/'.data/knowledge/foodon-records.sqlite') as records:
        assert records.execute('SELECT COUNT(*) FROM concepts').fetchone()[0]==proof['counts']['classes']
        assert records.execute('SELECT COUNT(*) FROM fields').fetchone()[0]==proof['counts']['fields']
        declared_ids={row[0] for row in records.execute('SELECT id FROM concepts')}
    f['statistics'].update(sourceRecordStore=proof['counts'],synonymExportIdsWithoutClassDeclaration=sorted(eligible_ids-declared_ids))
    f['fieldsPreserved'].append('Every original named class property and annotated-source axiom, including definitions, XML language/datatype, nested restrictions and explicit deprecation in local source-record store')
    f['integrity']['sourceRecordRoundtripReceipt']=str(record_proof_path.relative_to(ROOT))
    f['retrievalInterface']+='; relation=source exposes complete paged source fields with explicit missing/deprecated status'
    f['importCommand']+='; python src/modules/knowledge/import_foodon_records.py; python src/modules/knowledge/import_foodon_records.py --verify'
    f['gates'].update(B_preservation='VERIFIED_NAMED_CLASS_PROPERTIES_AND_AXIOM_ANNOTATIONS',C_access='NATIVE_SOURCE_FIELDS_AND_TAXONOMY',D_agent='LIVE_LEGACY_IDENTITY_NATIVE_SOURCE_READER_NOT_MODEL_ACCEPTED')
    f['remainingGaps']=['No OWL reasoning or imported-ontology expansion. Three TSV IDs have no class declaration; status is not asserted active. Source-record reader verified locally, not accepted by a new provider/photo run. Clinical effects are not ontology entailments. Further expansion is not a semester completion gate.']

f['statistics']['sourceAccounting']=foodon_accounting
f['statistics']['sourceAccounting'].update(typedAliasSetEqual=True,directEligibleParentEdgeSetEqual=True,typedAliases=sum(len(t['typedAliases']) for t in source_terms.values()))
f['verifiedCapabilities']=['Live besan/atta question used FoodOn and existing regional reference sources; separated taxonomy from nutrients/clinical suitability.', 'Live palm-oil question selected exact concept tool after ingredient lookup; correct parent and taxonomy limits; one numerical sentence withheld.', 'Five free Flash-Lite generations, 17117 input / 490 output tokens, 13391 ms provider time, estimated $0. Developer acceptance is not independent scientific evaluation.']
assert foodon_accounting['aliasTextsAbsentFromCompactIndex']==0
sources.append(f)

oft = load('.data/knowledge/openfoodtox-3.0.manifest.json')
receipt = load('.data/knowledge/openfoodtox-3.0.verification.json')
assert receipt['sourceSha256'] == oft['sourceSha256'] and receipt['rows'] == oft['records']
with closing(sqlite3.connect(f'{(ROOT / ".data/knowledge/openfoodtox-3.0.sqlite").as_uri()}?mode=ro', uri=True)) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    absent = db.execute('SELECT COUNT(DISTINCT target_id) FROM links l WHERE NOT EXISTS(SELECT 1 FROM records r WHERE r.document_id=l.target_id)').fetchone()[0]
o = source('efsa-openfoodtox-3', 'Substance hazard/assessment/study context; not dietary exposure or Indian authorization', ['https://doi.org/10.5281/zenodo.19388272'], 'Every nonempty cell and worksheet header in the pinned official workbook; flattened rows and unique documents counted separately.', 'readOpenFoodToxRecords; get_substance_assessments + get_assessment_records native tools', ['Final-answer quality remains partial: initial sodium-benzoate run skipped source detail; initial caffeine answer lost qualifications. Later detail flow improved sodium context but caffeine quantity was withheld. Independent applicability evaluation remains missing. Public headline totals use counting definitions not reconciled with workbook document counts.'], 'CC BY-ND 4.0; local internal research extraction only. Do not redistribute altered/extracted database; deployable redistribution design remains unresolved.')
o.update(version='3.0 / official workbook published 2026-04-30', expectedRecords=oft['records'], importedRecords=oft['records'], countUnit='nonempty workbook rows across 18 sheets', statistics={**oft, 'nonemptySourceCellsVerified': receipt['nonemptySourceCells'], 'unresolvedReferencedDocumentIds': absent}, integrity={'sourceSha256': oft['sourceSha256'], 'cellByCellVerified': True, 'sqliteIntegrity': 'ok'}, fieldsPreserved=['all original worksheet headers and sparse cells, including unnamed/duplicate columns', 'all original UUIDs, parent IDs, declared reference links', 'all reference-value families/units/qualifiers/populations/comments', 'study endpoints, methods, species/exposure, results, summaries, literature and dossiers'], fieldsNotExposed=['Original cells remain in the local store. Bounded exact-record/field access can omit oversized text; consult the original output. Citation previews are also bounded, and not every relationship has a specialized semantic operation.'], importCommand='python src/modules/knowledge/import_openfoodtox.py', verifyCommand='python src/modules/knowledge/verify_openfoodtox.py', verifiedCapabilities=['All 261183 rows / 2513078 nonempty cells match the original workbook.', 'Local caffeine/lead/sodium-benzoate lookup, section counts and rich fields.', 'Actual agent selected detailed sodium-benzoate records; caffeine detail/quantity utility incomplete.'])
o['gates'].update(A_acquisition='VERIFIED_PINNED_WORKBOOK', B_preservation='VERIFIED_ALL_SOURCE_CELLS_AND_DECLARED_LINKS', C_access='VERIFIED_LOCAL_RECORD_AND_RELATION_ACCESS', D_agent='REAL_TOOL_USE_VERIFIED', E_answer_utility='PARTIAL_REAL_FAILURES_RETAINED')
sources.append(o)

descriptors = [
 ('open-food-facts','Community branded-product catalog','https://world.openfoodfacts.org/data','Official India-tagged bulk partition not acquired; current supported v3 and Search-a-licious are on-demand only.','src/lib/server/products.ts; lookup_product',['Establish official snapshot size/version/rights and streaming India filter. No completeness claim for live catalog; preserve ODbL obligations and separate image rights.']),
 ('codex-gsfa','International additive identity/functions/category provisions','https://www.fao.org/gsfaonline/','Complete pinned English hierarchy: 265 category identities/labels, 249 DOM parent links, raw Table3 attributes preserved and independently parsed; additive provisions/notes/details not imported. Bounded official INS lookup retained.','get_codex_category / resolve_ingredient / official Codex API adapter',['Category detail endpoint timed out; provisions/notes and effective-date applicability remain unacquired. Hierarchy is not Indian authorization. Native source handoff retains child/ancestor facts; real first run plus offline replay, not independent scientific acceptance.']),
 ('fssai','Indian food regulation/label/claim instruments','https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php','Dated source-linked summaries and bounded official PDF research; not a consolidated current-law database.','get_nutrition_guidance / search_research(regulation)',['Inventory compendia/amendments/effective dates, permission and category/exception coverage; no package legal verdict from a generic rule.']),
 ('who-jecfa','Additive evaluations, identities and assessment histories','https://apps.who.int/food-additives-contaminants-jecfa-database/','Small selected source references; comprehensive dedicated access not yet implemented.','Existing source summaries/research tools',['Audit official searchable/export access and rights; preserve assessment history, dose, endpoint and qualifiers.']),
 ('pubchem','Chemical registry identity and linked chemistry','https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest','Supported bounded official PUG REST identity/property lookup; no universe bulk import selected.','lookup_chemical_identity',['Current property tool exposes CID/title/formula/IUPAC/InChIKey; review synonym and linked-reference operations and demonstrate multi-entity use.']),
 ('europe-pmc-pubmed','Scientific evidence discovery, not clinical recommendation authority','https://europepmc.org/RestfulWebService','Bounded live literature search; no full literature acquisition selected.','search_research(science)',['Audit abstract/detail access and population/intervention/dose/outcome/source applicability handoff; independently judge relevance and answer use.']),
 ('who-clinical-guidance','Population and condition-scoped dietary guidance','https://www.who.int/publications/who-guidelines','Specific source-linked summaries/typed numeric references, not complete WHO/ADA/KDIGO/AHA guideline corpora.','src/lib/server/nutrition-guidance.ts; get_nutrition_guidance',['Inventory every selected guideline/version/rights scope; preserve population, dose, recommendation strength and individualization limits; expand missing applicable guidance.']),
 ('ifct-icmr-nin','Indian food composition and dietary reference material','https://www.nin.res.in/','No composition dataset licensed/imported for the application; source-access and electronic reuse review outstanding.','Source links / permitted dietary summaries only',['Verify actual IFCT/ICMR-NIN terms and electronic-use permission; public PDF access alone does not authorize database extraction/distribution.']),
 ('indian-nutrient-databank','India-relevant composition source candidate','https://www.anuvaad.org.in/indian-nutrient-databank/','No imported release; source scope/rights/dependencies not yet verified.','Not integrated',['Verify authoritative distribution and permissions; select an authorized release or record explicit alternative.']),
 ('foodb','Food compound source candidate','https://foodb.ca/','Not selected for bulk import pending actual product need and rights review.','Not integrated',['Decide source relevance/permissions; do not download world chemistry merely for count.']),
 ('usda-sr-legacy','Generic reference composition candidate','https://fdc.nal.usda.gov/download-datasets/','2018 official partition not imported; relevance decision pending.','No local SR Legacy adapter',['Official page lists 12.3 MB JSON archive / 205 MB uncompressed; decide incremental food coverage against current Foundation/FNDDS.']),
 ('usda-branded','Mostly US branded-product catalog','https://fdc.nal.usda.gov/download-datasets/','Not selected for full local import: India-first incremental value not demonstrated.','Use appropriate existing live/product sources',['Official April 2026 JSON archive listed 195 MB / 3.1 GB uncompressed. Prefer OFF India relevance; reconsider only with demonstrated need.']),
]
for identifier,role,url,scope,access,gaps in descriptors:
    entry=source(identifier,role,[url],scope,access,gaps)
    if identifier=='who-jecfa':
        entry['declaredScope']='Bounded public filtered name/CAS search with full-result paging, exact chemical record and selected dated evaluation fields; no bulk release acquired.'
        entry['retrievalInterface']='search_jecfa + get_jecfa_record (evaluation year, paged original fields/report links)'
        entry['fieldsPreserved']=['Chemical identity, CAS/INS/synonyms and functional class where supplied', 'Available evaluation years; original ADI/reference text and body-weight units; comments, intake, meeting, specifications-only scope, report/monograph links']
        entry['fieldsPreserved'].append('Compact original dated ADI/TDI/comment history (20 years/8000 text characters, explicit omissions/detail pointers), plus four original WHO EHC240 terminology summaries with edition/page/rights; no inferred ADI adoption date.')
        entry['fieldsNotExposed']=['No complete bulk JECFA corpus or full linked reports; oversized fields/passages bounded. WHO reuse rights not asserted for bulk redistribution.']
        entry['gates'].update(B_preservation='SELECTED_DATED_ORIGINAL_FIELDS',C_access='FULL_FILTERED_SEARCH_PAGING_AND_YEAR_DETAIL',D_agent='REAL_NATIVE_HISTORY_AND_ASSESSMENT_USE',E_answer_utility='PARTIAL_CROSS_SOURCE_USE_SCIENTIFIC_INTERPRETATION_FAILURES_RETAINED')
        entry['remainingGaps']=['Full release scope/rights remain unacquired; two developer source questions do not establish independent toxicological appraisal or broad consumer-answer quality. Original source pages/receipts stay ignored.', 'WHO EHC240 glossary is all-rights-reserved: four original source-linked summaries only, not a complete glossary import or redistribution permission. Model interpretations of status, causality and review completeness still require evaluation.']
        entry['verifiedCapabilities']=['Actual aspartame and exact benzoic-acid assessments, unknown search; autocomplete omission avoided using full filtered endpoint.', 'Two live answers distinguish toxicological versus specifications-only reviews, old/new group reference and unknown package exposure/Indian applicability.']
    if identifier=='europe-pmc-pubmed':
        entry['retrievalInterface']='search_research(science) + get_research_record exact source/id, paged complete abstract passages and source metadata'
        entry['fieldsPreserved']=['Exact source/id, title/date/DOI/PMCID; publication types, original retraction/correction flags where supplied', 'Complete bounded abstract sentences with pagination, explicit absent/oversized passages; bounded original MeSH/chemical/keyword metadata and omission markers']
        entry['fieldsNotExposed']=['Not full-text review, systematic appraisal or universal literature acquisition; overlarge metadata/abstract sentences explicitly omitted.']
        entry['gates'].update(B_preservation='SELECTED_CORE_METADATA_AND_ABSTRACT_PAGES',C_access='EXACT_ID_AND_BOUNDED_DISCOVERY_VERIFIED',D_agent='REAL_NATIVE_PUBLICATION_DETAIL_USE',E_answer_utility='PARTIAL_REAL_STUDY_ANSWER_WITH_LIMITS')
        entry['verifiedCapabilities']=['Two real source detail reads across sodium review and fibre trial.', 'Real lowercase source-code failure fixed by structural normalization; same task reduced six generations/five tools to two/one. Derived population sum withheld; unsupported supervision wording remains an answer-quality limitation.']
    if identifier=='indian-nutrient-databank':
        entry.update(expectedRecords=1014,countUnit='recipes reported by the official portal; workbook not yet reconciled',version='2024 publication / portal; release bytes not pinned')
        entry['remainingGaps'].append('Official portal states per-100-g and per-serving values, derived using IFCT/NVIF/CoFID/USDA sources; reuse/dependency terms must be reviewed before integration.')
    if identifier=='foodb':
        entry['license']='Official compliance page states CC BY-NC 4.0; commercial product reuse needs permission/review.'
        entry['officialUrls'].append('https://foodb.ca/compliance')
    if identifier in ('usda-sr-legacy','usda-branded'):
        entry['license']='USDA FoodData Central CC0; attribution requested. No local release imported for this partition.'
    if identifier=='open-food-facts':
        entry['license']='ODbL database; source-image rights separate. No bulk snapshot is redistributed by this audit.'
        entry['retrievalInterface']+='; get_product_record exact GTIN/section/field/entry/page'
        entry['fieldsPreserved']=['Selected original ingredient tree/percentages and text; distinct allergens/precautionary traces/additives', 'As-sold/prepared nutrient keys, declared entry bases, serving quantities/units and missing fields', 'Identity/revision/modification, source quality and tag provenance where returned']
        entry['fieldsNotExposed']=['Not a universal full-product dump or an acquired complete India partition. Bounded selected sections/items; overlarge items explicitly withheld.']
        entry['gates'].update(B_preservation='PARTIAL_DECLARED_ON_DEMAND_SECTIONS',C_access='EXACT_SECTION_FIELD_ENTRY_PAGED_ACCESS',D_agent='REAL_NATIVE_DETAIL_TOOL_USE',E_answer_utility='PARTIAL_REAL_ANSWERS_AND_WITHHELD_QUANTITIES')
        entry['verifiedCapabilities']=['Three actual Indian GTIN records: original ingredient/nutrition contexts read without photos/profile.', 'Live source-backed ingredient/allergen/trace distinction; second missing-serving case correctly abstained but quantity validation left incomplete prose.']

        entry['officialUrls'].append('https://github.com/openfoodfacts/openfoodfacts-exports')
        entry['remainingGaps'].append('Official organization also publishes Hugging Face bulk exports. The older JSONL mirror reports 7.68 GB; inspect current Parquet release/filter options before a major transfer. No mass API crawl.')
    sources.append(entry)

category_path=ROOT/'.data/knowledge/codex-categories.json'
if category_path.exists():
    categories=load('.data/knowledge/codex-categories.json');account=categories['accounting']
    original=(ROOT/categories['sourceFile']).read_bytes();reference=runpy.run_path(str(ROOT/'src/modules/knowledge/import_codex_categories.py'))['import_categories'](original,categories['retrievedAt'])
    assert reference['sourceSha256']==categories['sourceSha256'] and reference['categories']==categories['categories'] and reference['accounting']==account
    c=source('codex-gsfa-categories','International food-category identities and hierarchy, not additive permission',[categories['sourceUrl'],categories['rights']['termsUrl']],categories['declaredScope'],'get_codex_category exact code/name search, ancestors and paged children',['Detail descriptions/provisions/notes are outside this partition; detail endpoint timed out. Final legal applicability and independent final-answer usefulness unverified.'],categories['rights']['status'])
    c.update(version=categories['retrievedAt'],expectedRecords=account['categoryCount'],importedRecords=len(categories['categories']),countUnit='category-item elements in the pinned English hierarchy page',statistics=account,integrity={'sourceSha256':categories['sourceSha256'],'allIdentityLabelParentAndRawTable3FieldsCompared':True},fieldsPreserved=['Every visible category code, UUID, label, DOM parent and raw Table3 attribute; source details URL'],fieldsNotExposed=['No category detail descriptions, additive provisions, exceptions, notes or effective dates.'],importCommand='npm exec -- tsx scripts/acquire-codex-categories.mts; python src/modules/knowledge/import_codex_categories.py --source-html PINNED_HTML --output .data/knowledge/codex-categories.json --retrieved-at YYYY-MM-DD')
    c['gates'].update(A_acquisition='VERIFIED_DECLARED_CATEGORY_PAGE',B_preservation='VERIFIED_265_IDENTITIES_LABELS_AND_249_PARENTS',C_access='EXACT_SEARCH_AND_HIERARCHY_PAGES_TESTED',D_agent='REAL_NATIVE_CATEGORY_LOOKUP',E_answer_utility='PARTIAL_LIVE_OUTPUT_AND_OFFLINE_HANDOFF_REPLAY')
    sources.append(c)

guideline_db=ROOT/'.data/knowledge/guidelines.sqlite'
if guideline_db.exists():
    manifest=load('data/guideline-sources.json');receipt=load('.data/knowledge/guidelines.verification.json')
    with closing(sqlite3.connect(f'{guideline_db.as_uri()}?mode=ro',uri=True))as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        for document in manifest['sources']:
            count,characters,empty=db.execute('SELECT COUNT(*),SUM(LENGTH(text)),SUM(text="") FROM pages WHERE document_id=?',(document['id'],)).fetchone()
            assert count==document['expectedPages'] and receipt['sourceHashes'][document['id']]==document['sha256']
            item=source('who-guideline-'+document['id'],'Population nutrition guideline with original rationale/remarks',[document['url'],document['downloadUrl']],'Every PDF text-layer page of pinned English guideline; primary recommendation/remarks ranges reviewed, figures/table semantics not reconstructed.','search_guideline_documents + get_guideline_pages',['Independent clinical appraisal and final-answer distribution not established. One live fat answer included an unsupported total/HDL-ratio statement; child answer UI loss fixed by offline actual-response replay. No individual prescription.'],manifest['license'])
            item.update(version=document['publishedAt'],expectedRecords=count,importedRecords=count,countUnit='PDF text-layer pages',statistics={'characters':characters,'emptyTextPages':empty,'recommendationPages':document['recommendationPages']},integrity={'sourceSha256':document['sha256'],'pageTextRoundtripVerified':True,'ftsAllPagesCompared':True},fieldsPreserved=['All page text/line breaks and page hashes, complete PDF retained privately','Primary recommendations, strength, population/age, scope/exclusions, rationale and references accessible by page'],fieldsNotExposed=['Figures and table semantics not reconstructed. Oversized pages/passages explicitly bounded; original PDF available.'],importCommand='npm exec -- tsx scripts/acquire-guideline-documents.mts; python src/modules/knowledge/import_guideline_documents.py; python src/modules/knowledge/import_guideline_documents.py --verify')
            item['gates'].update(A_acquisition='VERIFIED_PINNED_COMPLETE_PDF',B_preservation='VERIFIED_COMPLETE_TEXT_LAYER_ONLY',C_access='CATALOG_FTS_EXACT_HASHED_PAGES',D_agent='REAL_NATIVE_PAGE_RETRIEVAL',E_answer_utility='PARTIAL_THREE_REAL_QUESTIONS_AND_REPLAY')
            sources.append(item)

index = load('data/semantic-index.json')
curated = source('curated-semantic-and-identities','Original attributed explanatory summaries and reviewed identity relationships',['https://www.who.int/','https://www.fao.org/gsfaonline/'],'Finite app-authored records; not complete acquisition of their underlying source databases.','src/modules/knowledge/index.ts; BM25/MiniLM/native ingredient tools',['Source-specific breadth and independent relevance/answer utility remain incomplete; source count is not database completeness.'],'Per-record licenses; Health Canada reviewed ingredient-name extract has a non-commercial reuse restriction requiring product-distribution review.')
curated.update(version=index.get('corpusVersion'),importedRecords=len(index['vectors']),countUnit='embedded app-authored source records',fieldsPreserved=['attribution/source URL/date/jurisdiction/limitations','reviewed exact ingredient-family names and source links'])
sources.append(curated)

output = {'schemaVersion':1,'auditedAt':datetime.now(timezone.utc).isoformat(),'method':'Pinned local-source/hash/count audit plus explicit source dispositions; not independent scientific/legal validation.','sources':sources}
(ROOT/'data/dataset-coverage.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# Dataset coverage and knowledge capability matrix','','Generated by `python scripts/audit-dataset-coverage.py`. This is the source inventory; `COMPLETION_QUEUE.md` owns execution priorities. Acquisition, preservation, access, agent use and answer utility are distinct gates. No source below is claimed operationally complete merely because its records exist.','','| Dataset | Defined/imported coverage | A / B / C / D / E | Access and agent utilization | Remaining gaps |','|---|---|---|---|---|']
for item in sources:
    count=f"{item['importedRecords']} {item['countUnit']}" if item['importedRecords'] is not None else 'No bulk completeness claim'
    gates=' / '.join(item['gates'].values())
    lines.append(f"| {item['id']} | {count}. {item['declaredScope']} | {gates} | {item['retrievalInterface']} | {' '.join(item['remainingGaps'])} |")
lines += ['','Full URLs, versions, hashes, counts, exclusions, retained fields, rights and reproducible commands are in `data/dataset-coverage.json`. EFSA raw/extracted records remain ignored and are not redistributed. Live interfaces do not imply comprehensive upstream acquisition. Unknown expected record counts remain null.','', 'The April 2026 EFSA landing-page headline totals (45,682 study results / 19,452 reference values) are not equated with the workbook’s 46,168 distinct study-document UUIDs / 19,743 reference-value-document UUIDs. The exact workbook-cell scope is verified; the differing counting definitions require clarification before a release-wide scientific-count claim.','']
(ROOT/'docs/DATASET_COVERAGE.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps({'sources':len(sources),'output':'data/dataset-coverage.json','matrix':'docs/DATASET_COVERAGE.md','operationallyCompleteSources':0}))
