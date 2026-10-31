import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({search:vi.fn(),read:vi.fn()}));
vi.mock('./guideline-documents',()=>({searchGuidelines:mock.search,readGuidelinePages:mock.read,guidelineCatalog:[]}));
import {retrieveSourcePassages} from './source-passages';
describe('source passage retrieval',()=>{
 beforeEach(()=>{vi.stubEnv('NUTRISCAN_MEDLINE_DATABASE','__missing_test_corpus__.sqlite');vi.stubEnv('NUTRISCAN_DEFINITIONS_FILE','__missing_definitions__.json');});
 afterEach(()=>vi.unstubAllEnvs());
 it('returns an attributable source sentence only when all query terms occur',async()=>{
  mock.search.mockResolvedValue({status:'ok',results:[{documentId:'example',pdfPage:4,title:'Example'}]});
  mock.read.mockResolvedValue({status:'ok',source:{title:'Original guideline',downloadUrl:'https://example.org/source.pdf',publishedAt:'2023-01-01',retrievedAt:'2026-01-01',license:'Attribution required'},pages:[{page:4,text:'This discussion concerns sodium only. Sodium and potassium are discussed together in this guideline.'}]});
  const result=await retrieveSourcePassages('sodium potassium');
  expect(result.passages).toHaveLength(1);
  expect(result.passages[0]).toMatchObject({text:'Sodium and potassium are discussed together in this guideline.',url:'https://example.org/source.pdf#page=4',page:4});
 });
 it('does not turn unrelated lexical matches into evidence',async()=>{
  mock.search.mockResolvedValue({status:'ok',results:[{documentId:'example',pdfPage:4}]});
  mock.read.mockResolvedValue({status:'ok',source:{title:'Example',downloadUrl:'https://example.org/x',license:'Attribution'},pages:[{page:4,text:'This discussion mentions sodium but not the other substance.'}]});
  expect((await retrieveSourcePassages('sodium whey')).passages).toEqual([]);
 });
 it('returns a single relevant candidate instead of several passing mentions',async()=>{
  mock.search.mockResolvedValue({status:'ok',results:[{documentId:'a',pdfPage:1},{documentId:'b',pdfPage:2}]});
  mock.read.mockImplementation(async ({documentId}:{documentId:string})=>({status:'ok',source:{title:'Guideline',downloadUrl:'https://example.org/guideline',license:'Attribution'},pages:[{page:documentId==='a'?1:2,text:documentId==='a'?'Different fats were compared with carbohydrates in the study.':'WHO recommends that carbohydrate intake should come from whole grains, vegetables and fruits.'}]}));
  const result=await retrieveSourcePassages('carbohydrates');
  expect(result.passages).toHaveLength(1);
  expect(result.passages[0].text).toContain('carbohydrate intake');
 });
 it('reports unavailable source stores without inventing a passage',async()=>{mock.search.mockResolvedValue({status:'unavailable',results:[]});expect(await retrieveSourcePassages('carbohydrate')).toEqual({status:'unavailable',passages:[]});});
});
