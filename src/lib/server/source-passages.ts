import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { searchGuidelines, readGuidelinePages, guidelineCatalog } from './guideline-documents';

export const passageQuerySchema = z.object({ query: z.string().trim().min(2).max(180) }).strict();
const stop = new Set('what which where when how does this that have food foods product products with from about their some only there they because good useful would could should ingredients ingredient containing contains per daily advice tell please nutrition health person people can for the and are'.split(' '));
/** Searches the installed, locally licensed WHO PDF text index. No model or network call. */
export async function retrieveSourcePassages(query: string) {
  const parsed = passageQuerySchema.parse({query});
  const terms = [...new Set((parsed.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(t=>!stop.has(t)))].slice(0,8);
  if (!terms.length) return {status:'empty' as const, passages:[]};
  // Definitions are a separate official collection; exact term only avoids
  // confusing similar but distinct nutrient labels.
  try {
    const file=process.env.NUTRISCAN_DEFINITIONS_FILE??path.join(process.cwd(),'.data/knowledge/medlineplus-nutrition-definitions.json');
    const data=JSON.parse(readFileSync(file,'utf8')) as {updated:string;entries:Array<{term:string;text:string;publisher:string;url:string}>};
    const match=data.entries.find(item=>item.term.toLocaleLowerCase()===parsed.query.toLocaleLowerCase());
    if(match){const first=match.text.match(/^.{15,450}?[.!?](?:\s|$)/u)?.[0]?.trim();if(first&&!/[\u0080-\u009f\ufffd]/u.test(first))return {status:'ok' as const,passages:[{id:'medline-definition-'+createHash('sha256').update(match.term+first).digest('hex').slice(0,16),text:first,title:`${match.term} — Nutrition definitions`,publisher:match.publisher,url:match.url,page:0,publishedAt:data.updated,retrievedAt:'2026-10-31',license:'MedlinePlus content; attribution required. No endorsement implied.'}]};}
  } catch { /* Optional corpus; use other installed sources. */ }
  // Local source corpus: match the subject against the source title or its
  // indexed synonyms, not a passing mention buried in body text.
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(process.env.NUTRISCAN_MEDLINE_DATABASE??path.join(process.cwd(),'.data/knowledge/medlineplus-2026-10-31.sqlite'),{readOnly:true});
    const match=terms.map(t=>'"'+t.replace(/"/g,'')+'"').join(' AND ');
    const rows=db.prepare(`SELECT p.id,p.title,p.url,p.aliases,p.text FROM passage_fts f JOIN passages p ON f.id=p.id WHERE passage_fts MATCH ? ORDER BY bm25(passage_fts,0,8,4,1) LIMIT 40`).all(match) as Array<{id:string;title:string;url:string;aliases:string;text:string}>;
    const anchor=(x:string)=>x.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const subject=anchor(parsed.query);
    const matchedTitle=rows.find(row=>anchor(row.title)===subject)?.title;
    const topicRows=matchedTitle?db.prepare('SELECT id,title,url,aliases,text FROM passages WHERE title = ?').all(matchedTitle) as typeof rows:[];
    const hit=topicRows.filter(row=>/^.{35,450}?\.(?:\s|$)/u.test(row.text)).sort((a,b)=>Number(a.id.split('-').at(-1))-Number(b.id.split('-').at(-1)))[0];
    if(hit){const text=hit.text.match(/^.{35,450}?[.!?](?:\s|$)/u)?.[0]?.trim();if(text)return {status:'ok' as const,passages:[{id:hit.id,text,title:hit.title,publisher:'MedlinePlus, U.S. National Library of Medicine',url:hit.url,page:0,publishedAt:'',retrievedAt:'2026-10-31',license:'MedlinePlus content; attribution required. No endorsement implied.'}]};}
  } catch { /* The optional local corpus is not installed. Continue to WHO. */ } finally {db?.close();}
  const subject=terms.length===1?terms[0].replace(/s$/,''):'';
  const titleMatch=subject?guidelineCatalog.find(doc=>doc.title.toLowerCase().includes(subject)):undefined;
  const searchTerms=terms.map(term=>term.length>5?term.replace(/s$/,''):term);
  const search=await searchGuidelines({query:searchTerms.join(' '),scope:'recommendations',limit:8,...(titleMatch?{documentId:titleMatch.id}:{})});
  if(search.status==='unavailable') return {status:'unavailable' as const,passages:[]};
  const passages:Array<{id:string;text:string;title:string;publisher:string;url:string;page:number;publishedAt:string;retrievedAt:string;license:string;score:number}>=[];
  for(const hit of search.results){
    const page=await readGuidelinePages({documentId:hit.documentId,pages:[hit.pdfPage]});
    if(page.status!=='ok'||!page.pages.length) continue;
    const text=page.pages[0].text.replace(/\s+/g,' ').trim();
    const sentences=text.match(/[^.!?]{20,450}[.!?](?:\s|$)/g) ?? [];
    const ranked=sentences.map(sentence=>({sentence:sentence.trim(), count:terms.filter(term=>new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/s$/,'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}s?(?![\\p{L}\\p{N}])`,'iu').test(sentence)).length})).filter(item=>item.count===terms.length && /^[A-Z]/.test(item.sentence) && !/^(?:For further guidance|See also|References|Contents)\b/i.test(item.sentence)).sort((a,b)=>Number(/^WHO recommends\b/i.test(b.sentence))-Number(/^WHO recommends\b/i.test(a.sentence)) || b.count-a.count || a.sentence.length-b.sentence.length);
    if(!ranked.length)continue;
    const excerpt=ranked[0].sentence;
    const firstTerm=excerpt.toLocaleLowerCase().indexOf(terms[0].replace(/s$/,''));
    if(firstTerm<0 || firstTerm>100)continue;
    const score=(titleMatch?.id===hit.documentId?100:0)+(firstTerm<45?30:0)+( /^WHO recommends\b/i.test(excerpt)?10:0)-Math.min(excerpt.length,450)/100;
    passages.push({score,id:'who-passage-'+createHash('sha256').update(hit.documentId+'|'+hit.pdfPage+'|'+excerpt).digest('hex').slice(0,16),text:excerpt,title:page.source.title,publisher:'World Health Organization',url:`${page.source.downloadUrl}#page=${hit.pdfPage}`,page:hit.pdfPage,publishedAt:page.source.publishedAt,retrievedAt:page.source.retrievedAt,license:page.source.license});

  }
  passages.sort((a,b)=>b.score-a.score);
  const selected=passages.slice(0,1).map(({score,...passage})=>passage);
  return {status:selected.length?'ok' as const:'empty' as const,passages:selected};
}
