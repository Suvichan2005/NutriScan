import { packageSchema, type Nutrient, type NutrientKey, type Observation, type OcrCapture, type PackageData, type ParserDiagnostic } from '../../lib/contracts';

export type ParseOptions = {side?:Observation['side'];origin?:Observation['origin'];confidence?:number|null;observations?:Observation[];ocrCaptures?:OcrCapture[];synthetic?:boolean;userDescription?:string;resolveAdditives?:(text:string)=>string[]};
type Basis = NonNullable<Nutrient['basis']>;
const rows: {key:NutrientKey;pattern:RegExp}[] = [
  {key:'addedSugars',pattern:/^(?:(?:includes?|of which)\s+)?added\s+sugars?(?=\b|\d)/i},
  {key:'saturatedFat',pattern:/^(?:(?:total|of which)\s+)?saturat(?:ed|es)\s*(?:fat)?\b|^(?:dont\s+acides gras satur[ée]s|waarvan\s+verzadigd(?:e|e vetzuren)?|de las cuales saturadas|grasas?\s+saturadas?)\b/i},
  {key:'energy',pattern:/^(?:total\s+)?(?:energy|calories)\b|^(?:[ée]nergie|energ[ií]a|valor energ[ée]tico|contenido energ[ée]tico)\b/i},
  {key:'carbohydrate',pattern:/^(?:total\s+|available\s+)?(?:carbohydrates?|carbohidratos?)(?=\b|\d)|^(?:glucides|koolhydraten|hidratos de carbono)\b/i},
  {key:'sugars',pattern:/^(?:(?:total|of which)\s+)?sugars?(?=\b|\d)|^(?:az[úu]cares?|dont sucres|waarvan suikers|de los cuales az[úu]cares)\b/i},
  {key:'protein',pattern:/^proteins?(?=\b|\d)|^(?:prot[ée]ines?|prote[ií]nas?|eiwitten)\b/i}, {key:'fat',pattern:/^(?:total\s+)?fat\b|^(?:mati[èe]res grasses|vetten|grasas)\b/i},
  {key:'fiber',pattern:/^(?:(?:dietary|alimentaria)\s+)?fib(?:er|re|ra)(?:\s+diet[ée]tica)?\b/i},
  {key:'sodium',pattern:/^(?:sodium|sodio)\b/i}, {key:'salt',pattern:/^(?:salt|sel|zout|sal)\b/i},
];
const tableStructureRowLabel=/^(?:energy|calories|carbohydrates?|sugars?|added sugars?|protein|total\s+fat|fat|saturated(?:\s+fat)?|trans\s+fat|fiber|fibre|sodium|salt|cholesterol|iron|calcium|zinc|magnesium|potassium|phosph(?:orus|ate)|vitamins?(?:\s+[a-z0-9]+)?|thiamin|riboflavin|niacin|folate|biotin|copper|manganese|selenium|iodine|chloride|omega(?:[-\s]?\d)?)\b/i;
type MatchedRow = {row:typeof rows[number];labelStart:number;recoveredPrefix?:string;mergedPrefix?:string};
function matchNutrientRow(line:string,observation?:Observation,allowEmbeddedStructuredRow=false):MatchedRow|undefined {
  const exact=rows.find(row=>row.pattern.test(line));
  if(exact)return {row:exact,labelStart:0};
  const words=observation?.origin==='ocr'&&observation.field==='ocr-line'?observation.ocrWords:undefined;
  if(allowEmbeddedStructuredRow&&observation?.origin==='ocr'&&observation.field==='ocr-line'){
    const embedded:Array<{row:typeof rows[number];labelStart:number;labelLength:number}> = [];
    for(let labelStart=0;labelStart<line.length;labelStart++){
      if(labelStart>0&&/[\p{L}\p{N}]/u.test(line[labelStart-1]))continue;
      const suffix=line.slice(labelStart);
      for(const candidate of rows){
        if(candidate.key==='fat'&&/\btrans\s+$/i.test(line.slice(0,labelStart)))continue;
        const label=suffix.match(candidate.pattern);
        if(!label)continue;
        const afterLabel=suffix.slice(label[0].length);
        const unit=afterLabel.match(/^\s*\(\s*(?:kcal|kj|mg|g)\s*\)/i);
        if(!unit||!/\d/.test(afterLabel.slice(unit[0].length)))continue;
        embedded.push({row:candidate,labelStart,labelLength:label[0].length});
      }
    }
    const specific=embedded.filter(candidate=>!embedded.some(other=>other.labelStart<candidate.labelStart&&candidate.labelStart<other.labelStart+other.labelLength));
    if(specific.length===1){
      const match=specific[0];
      return {row:match.row,labelStart:match.labelStart,mergedPrefix:line.slice(0,match.labelStart).trim()||undefined};
    }
  }
  if(!words?.length)return;
  // Tesseract occasionally inserts a tiny, low-confidence token before a real
  // row label (for example, the decorative mark before "Sugar"). Only skip up
  // to two short alphabetic tokens when every skipped word is very uncertain.
  for(let prefixCount=1;prefixCount<=2&&prefixCount<words.length;prefixCount++){
    const prefix=words.slice(0,prefixCount);
    if(!prefix.every(word=>word.confidence!==null&&word.confidence<=30&&/^[A-Za-z]{1,3}$/.test(word.text)))continue;
    const suffix=words.slice(prefixCount);
    const row=rows.find(candidate=>candidate.pattern.test(suffix.map(word=>word.text).join(' ')));
    if(!row)continue;
    const firstLabel=suffix[0].text;
    const labelStart=line.toLocaleLowerCase().indexOf(firstLabel.toLocaleLowerCase());
    if(labelStart<0)continue;
    return {row,labelStart,recoveredPrefix:prefix.map(word=>word.text).join(' ')};
  }
}
type GeometryNumber={value:number;unit:string|null;center:number};
function numericOcrWords(observation:Observation):GeometryNumber[]|undefined {
  const words=observation.ocrWords;
  if(!words?.length)return;
  const result:GeometryNumber[]=[];
  for(let index=0;index<words.length;index++){
    const word=words[index];
    if(word.text.includes('%'))continue;
    const match=word.text.match(/^(-?(?:\d+(?:[.,]\d+)?|\.\d+))\s*(kcal|kj|mg|g|ml)?[.,;:]?$/i);
    if(!match)continue;
    const value=Number(match[1].replace(',','.'));
    if(!Number.isFinite(value))return;
    let unit=match[2]?.toLowerCase()??null;
    let right=word.bbox.x1;
    if(!unit&&words[index+1]&&/^(kcal|kj|mg|g|ml)$/i.test(words[index+1].text.trim())){
      unit=words[index+1].text.trim().toLowerCase();
      right=words[index+1].bbox.x1;
      index++;
    }else if(!unit&&words[index+1]?.text.trim()==='%'){
      index++;
      continue;
    }
    result.push({value,unit,center:(word.bbox.x0+right)/2});
  }
  return result;
}
function basisGeometryCenters(observation:Observation,bases:Basis[]):number[]|undefined {
  const words=observation.ocrWords;
  if(!words?.length)return;
  const result:number[]=[];
  let searchFrom=0;
  for(const basis of bases){
    const amount=String(basis.amount).replace('.','[.,]');
    const amountPattern=new RegExp(`^(${amount})(?:\\s*(${basis.unit}))?`, 'i');
    let found:number|undefined;
    for(let index=searchFrom;index<words.length;index++){
      const word=words[index];
      let token=word.text.replace(/^(?:per|each|pour|para|par|por)/i,'');
      const prefixLength=word.text.length-token.length;
      const match=token.match(amountPattern);
      if(!match)continue;
      let right=word.bbox.x0+(word.bbox.x1-word.bbox.x0)*(prefixLength+match[0].length)/Math.max(1,word.text.length);
      if(!match[2]){
        const next=words[index+1];
        if(next&&new RegExp(`^${basis.unit}$`,'i').test(next.text.trim()))right=next.bbox.x1;
        else continue;
      }
      let left=word.bbox.x0;
      for(let prior=index;prior>=Math.max(0,index-2);prior--){
        if(/^(?:per|each|pour|para|par|por)$/i.test(words[prior].text.trim())){left=words[prior].bbox.x0;break;}
      }
      found=(left+right)/2;
      searchFrom=index+1;
      break;
    }
    if(found===undefined)return;
    result.push(found);
  }
  return result;
}

type FusedColumnRecovery={tail:string;candidate:Observation;basisIndexes:number[]};

function fusedTableColumnCenters(headers:Observation[],bases:Basis[],capture:OcrCapture):number[]|undefined {
  if(bases.length!==2)return;
  const usableHeaders=headers.filter(header=>header.origin==='ocr'&&header.field==='ocr-line'&&header.ocrWords?.length);
  const explicitCenters=bases.map(basis=>usableHeaders.map(header=>basisGeometryCenters(header,[basis])?.[0]).find((value):value is number=>value!==undefined));
  if(explicitCenters.every((value):value is number=>value!==undefined)&&explicitCenters[0]<explicitCenters[1])return explicitCenters as number[];
  const firstCenter=explicitCenters[0];
  if(firstCenter===undefined||!/(?:serv|portion)/i.test(bases[1].description))return;
  const servingWords=new Map<string,number>();
  for(const header of usableHeaders)for(const word of header.ocrWords??[]){
    if(!/^serv(?:e|ing)\b/i.test(word.text.trim()))continue;
    const center=(word.bbox.x0+word.bbox.x1)/2;
    const key=[word.bbox.x0,word.bbox.y0,word.bbox.x1,word.bbox.y1].join(':');
    if(center>firstCenter+Math.max(4,capture.preparedImage.width*.01))servingWords.set(key,center);
  }
  const secondCenter=Array.from(servingWords.values()).sort((a,b)=>a-b)[0];
  if(secondCenter===undefined||secondCenter-firstCenter<Math.max(12,capture.preparedImage.width*.025))return;
  return [firstCenter,secondCenter];
}

/** Split one fused OCR number token only when its box and unique character split match two printed column centers. */
function reconstructFusedColumnToken(
  tail:string,
  line:string,
  row:Observation|undefined,
  headers:Observation[],
  bases:Basis[],
  captures:OcrCapture[]
):FusedColumnRecovery|undefined {
  if(!row||row.origin!=='ocr'||row.field!=='ocr-line'||!row.imageId||!row.readingOrder?.runId||!row.ocrWords?.length||bases.length!==2)return;
  const runId=row.readingOrder.runId;
  const sameRunHeaders=headers.filter(header=>header.origin==='ocr'&&header.field==='ocr-line'&&header.imageId===row.imageId&&header.readingOrder?.runId===runId);
  const capture=captures.find(item=>item.imageId===row.imageId&&item.runId===runId&&item.bboxCoordinateSpace==='prepared-image-pixels');
  if(!capture||sameRunHeaders.length===0)return;
  const centers=fusedTableColumnCenters(sameRunHeaders,bases,capture);
  if(!centers||centers[0]>=centers[1])return;
  const bestByWord:Array<{word:NonNullable<Observation['ocrWords']>[number];left:string;right:string;boundary:number;score:number}> = [];
  for(const word of row.ocrWords){
    const token=word.text.trim();
    if(!/^\d+(?:[.,]\d{1,3})?\d+(?:[.,]\d{1,3})?$/.test(token)||!tail.includes(token)||!line.includes(token))continue;
    const width=word.bbox.x1-word.bbox.x0;
    if(width<=0||word.bbox.x0>=centers[0]||word.bbox.x1<=centers[1])continue;
    const maxCenterError=Math.max(12,Math.min(width*.2,capture.preparedImage.width*.025));
    const maxBoundaryError=Math.max(5,width*.07);
    const midpoint=(centers[0]+centers[1])/2;
    const splits:Array<{left:string;right:string;boundary:number;score:number}> = [];
    for(let index=1;index<token.length;index++){
      const left=token.slice(0,index),right=token.slice(index);
      if(!/^\d+(?:[.,]\d{1,3})?$/.test(left)||!/^\d+(?:[.,]\d{1,3})?$/.test(right))continue;
      const leftValue=Number(left.replace(',','.')),rightValue=Number(right.replace(',','.'));
      if(!Number.isFinite(leftValue)||!Number.isFinite(rightValue)||leftValue<0||rightValue<0||leftValue>100000||rightValue>100000)continue;
      const leftCenter=word.bbox.x0+width*(index/2)/token.length;
      const rightCenter=word.bbox.x0+width*(index+(token.length-index)/2)/token.length;
      const boundary=word.bbox.x0+width*index/token.length;
      const leftError=Math.abs(leftCenter-centers[0]),rightError=Math.abs(rightCenter-centers[1]),boundaryError=Math.abs(boundary-midpoint);
      if(leftError>maxCenterError||rightError>maxCenterError||boundaryError>maxBoundaryError)continue;
      splits.push({left,right,boundary,score:boundaryError+(leftError+rightError)*.25});
    }
    splits.sort((a,b)=>a.score-b.score);
    if(!splits.length||splits.length>1&&splits[1].score-splits[0].score<Math.max(3,width*.025))continue;
    bestByWord.push({word,...splits[0]});
  }
  if(bestByWord.length!==1)return;
  const {word,left,right,boundary}=bestByWord[0];
  const token=word.text.trim();
  const tokenStart=line.indexOf(token);
  const tailStart=tail.indexOf(token);
  if(tokenStart<0||tailStart<0)return;
  const candidateText=`${line.slice(0,tokenStart)}${left} ${right}${line.slice(tokenStart+token.length)}`;
  const replacementWords=(row.ocrWords??[]).flatMap(original=>{
    if(original.wordIndex!==word.wordIndex)return [{...original}];
    return [
      {...original,text:left,bbox:{...original.bbox,x1:boundary}},
      {...original,text:right,bbox:{...original.bbox,x0:boundary}},
    ];
  }).map((item,wordIndex)=>({...item,wordIndex}));
  const candidate:Observation={
    id:crypto.randomUUID(),field:'nutrition-row-candidate',text:candidateText,side:row.side,
    confidence:null,origin:'ocr',imageId:row.imageId,
    ...(row.bbox?{bbox:{...row.bbox}}:{}),ocrWords:replacementWords,
    readingOrder:{...row.readingOrder},derivedFromObservationIds:[row.id],
  };
  return {tail:`${tail.slice(0,tailStart)}${left} ${right}${tail.slice(tailStart+token.length)}`,candidate,basisIndexes:[0,1]};
}
function geometryValueBasisIndexes(
  numericCandidates:ParserDiagnostic['numericCandidates'],
  rowObservation:Observation|undefined,
  basisObservation:Observation|undefined,
  bases:Basis[],
  captures:OcrCapture[]
):number[]|undefined {
  if(numericCandidates.length<2||numericCandidates.length!==bases.length||!rowObservation||!basisObservation)return;
  if(rowObservation.origin!=='ocr'||basisObservation.origin!=='ocr'||rowObservation.imageId!==basisObservation.imageId)return;
  const rowRun=rowObservation.readingOrder?.runId;
  if(!rowRun||basisObservation.readingOrder?.runId!==rowRun)return;
  const capture=captures.find(item=>item.runId===rowRun&&item.imageId===rowObservation.imageId);
  const basisCenters=basisGeometryCenters(basisObservation,bases);
  const wordValues=numericOcrWords(rowObservation);
  if(!capture||!basisCenters||basisCenters.length!==bases.length||!wordValues||wordValues.length!==numericCandidates.length)return;
  for(let index=0;index<numericCandidates.length;index++){
    const candidate=numericCandidates[index];
    const word=wordValues[index];
    if(candidate.value===null||Math.abs(candidate.value-word.value)>0.000001)return;
    if(candidate.unit&&word.unit&&candidate.unit.toLowerCase()!==word.unit)return;
  }
  const maxDistance=Math.max(20,capture.preparedImage.width*0.075);
  const requiredMargin=Math.max(12,capture.preparedImage.width*0.02);
  const assigned=new Set<number>();
  const result:number[]=[];
  for(const word of wordValues){
    const ranked=basisCenters.map((center,index)=>({index,distance:Math.abs(word.center-center)})).sort((a,b)=>a.distance-b.distance);
    if(!ranked.length||ranked[0].distance>maxDistance||ranked.length>1&&ranked[1].distance-ranked[0].distance<requiredMargin||assigned.has(ranked[0].index))return;
    assigned.add(ranked[0].index);
    result.push(ranked[0].index);
  }
  if(assigned.size!==bases.length)return;
  return result;
}
function geometrySelectedValueIndex(
  numericCandidates:ParserDiagnostic['numericCandidates'],
  rowObservation:Observation|undefined,
  basisObservation:Observation|undefined,
  basis:Basis|undefined,
  captures:OcrCapture[]
):number|undefined {
  if(numericCandidates.length<2||!rowObservation||!basisObservation||!basis)return;
  if(rowObservation.origin!=='ocr'||basisObservation.origin!=='ocr'||rowObservation.imageId!==basisObservation.imageId)return;
  const rowRun=rowObservation.readingOrder?.runId;
  if(!rowRun||basisObservation.readingOrder?.runId!==rowRun)return;
  const capture=captures.find(item=>item.runId===rowRun&&item.imageId===rowObservation.imageId);
  const basisCenters=basisGeometryCenters(basisObservation,[basis]);
  const wordValues=numericOcrWords(rowObservation);
  if(!capture||!basisCenters||!wordValues||wordValues.length!==numericCandidates.length)return;
  for(let index=0;index<numericCandidates.length;index++){
    const candidate=numericCandidates[index];
    const word=wordValues[index];
    if(candidate.value===null||Math.abs(candidate.value-word.value)>0.000001)return;
    if(candidate.unit&&word.unit&&candidate.unit.toLowerCase()!==word.unit)return;
  }
  const ranked=wordValues.map((word,index)=>({index,distance:Math.abs(word.center-basisCenters[0])})).sort((a,b)=>a.distance-b.distance);
  const maxDistance=Math.max(20,capture.preparedImage.width*0.045);
  const requiredMargin=Math.max(12,capture.preparedImage.width*0.03);
  if(ranked[0].distance>maxDistance||(ranked[1].distance-ranked[0].distance)<requiredMargin)return;
  return ranked[0].index;
}
function mass(value:string,unit:string): {value:number;unit:'g'|'ml'} | undefined {
  const n = Number(value.replace(',','.')); const u=unit.toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return;
  return {value:n*(u==='kg'||u==='l'?1000:1),unit:u==='ml'||u==='l'?'ml':'g'};
}
function basesIn(line:string,serving?:PackageData['serving']):Basis[] {
  const result:Basis[]=[];
  for(const match of line.matchAll(/(?:per|each|pour|para|par|por|\/)\s*:?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)) {
    const amount=Number(match[1]); if(amount>0&&amount<=10000) result.push({amount,unit:match[2].toLowerCase() as 'g'|'ml',description:match[0]});
  }
  // Labels often state the serving basis as "par portion 15 g" or "por
  // porción 18 g". Keep the printed quantity as the basis rather than
  // requiring an English "per 15 g" construction.
  for(const match of line.matchAll(/(?:per|each|pour|para|par|por)\s+(?:(?:the|a|an|une|un|una)\s+)?(?:serv(?:e|ing)|portion|porci[oó]n|raci[oó]n)(?:\s+(?:de|of))?\s*(?:size\s*)?\(?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/gi)) {
    const amount=Number(match[1].replace(',','.'));
    if(amount>0&&amount<=10000&&!result.some(item=>item.amount===amount&&item.unit===match[2].toLowerCase()))result.push({amount,unit:match[2].toLowerCase() as 'g'|'ml',description:match[0]});
  }
  // A literal "Per: 100 ml 330 ml" table header states multiple column bases.
  // Retain all rather than assuming the first column is the only declaration.
  if(/^(?:per|pour|para|par|por)\s*:?\s*\d/i.test(line)){
    for(const match of line.matchAll(/(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)){
      const amount=Number(match[1]);const unit=match[2].toLowerCase() as 'g'|'ml';
      if(amount>0&&amount<=10000&&!result.some(b=>b.amount===amount&&b.unit===unit))result.push({amount,unit,description:`per ${match[0]}`});
    }
  }
  if (/per\s+(?:serve|serving|portion)\b/i.test(line) && serving && !/per\s+(?:serve|serving|portion)\s*\(?\s*\d/i.test(line)) result.push({amount:serving.value,unit:serving.unit,description:'per declared serving'});
  const servingInline = line.match(/per\s+(?:serve|serving|portion)\s*\(?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
  if(servingInline) result.push({amount:Number(servingInline[1]),unit:servingInline[2].toLowerCase() as 'g'|'ml',description:servingInline[0]});
  return result;
}

type SplitServingTableHeader={
  headerObservationId:string;
  pairedHeaderObservationId:string;
  imageId:string;
  runId:string;
  bases:Basis[];
};

/**
 * Some Indian panels stack the column labels across two OCR lines, for example
 * `NUTRITION Per | Per | %GDA*` followed by `INFORMATION 100 g serve Per serve`.
 * Recover only this explicit two-column pattern, and retain both source lines.
 */
function splitServingTableHeaders(
  input:Observation[],
  captures:OcrCapture[],
  serving:PackageData['serving']
):Map<string,SplitServingTableHeader>{
  const byRun=new Map<string,Observation[]>();
  for(const observation of input){
    const runId=observation.readingOrder?.runId;
    if(observation.origin!=='ocr'||observation.field!=='ocr-line'||!observation.imageId||!runId)continue;
    const key=`${observation.imageId}\u0000${runId}`;
    byRun.set(key,[...(byRun.get(key)??[]),observation]);
  }
  const result=new Map<string,SplitServingTableHeader>();
  for(const observations of byRun.values()){
    observations.sort((a,b)=>(a.readingOrder?.lineIndex??0)-(b.readingOrder?.lineIndex??0));
    for(let index=0;index<observations.length-1;index++){
      const header=observations[index];
      const subheader=observations[index+1];
      const runId=header.readingOrder?.runId;
      const headerLineIndex=header.readingOrder?.lineIndex;
      const imageId=header.imageId;
      if(!runId||!imageId||headerLineIndex===undefined||subheader.readingOrder?.lineIndex!==headerLineIndex+1)continue;
      if(!captures.some(capture=>capture.runId===runId&&capture.imageId===header.imageId))continue;
      const firstLine=header.text;
      const secondLine=subheader.text;
      const perCount=[...firstLine.matchAll(/\bper\b/gi)].length;
      const servingTerms=[...secondLine.matchAll(/\bserv(?:e|ing)\b/gi)].length;
      if(!/\bnutrition(?:al)?\b/i.test(firstLine)||!/(?:%\s*)?(?:gda|rda)\b/i.test(firstLine)||perCount!==2)continue;
      if(!/\binformation\b/i.test(secondLine)||servingTerms<2||!/\bper\s+serv(?:e|ing)\b/i.test(secondLine)||!serving)continue;
      const firstBasis=secondLine.match(/\b(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
      if(!firstBasis)continue;
      const amount=Number(firstBasis[1].replace(',','.'));
      const unit=firstBasis[2].toLowerCase() as Basis['unit'];
      if(!Number.isFinite(amount)||amount<=0||amount>10000||unit!==serving.unit)continue;
      result.set(header.id,{
        headerObservationId:header.id,
        pairedHeaderObservationId:subheader.id,
        imageId,
        runId,
        bases:[
          {amount,unit,description:`per ${firstBasis[0]} (split table header)`},
          {amount:serving.value,unit:serving.unit,description:'per declared serving (split table header)'},
        ],
      });
    }
  }
  return result;
}

type OcrWordRegion = {
  text:string;
  words:NonNullable<Observation['ocrWords']>;
  bbox:NonNullable<Observation['bbox']>;
  firstWordIndex:number;
};

function ocrWordRegions(observation:Observation):OcrWordRegion[] {
  if(!observation.ocrWords?.length)return [];
  const regions=new Map<string,{bbox:NonNullable<Observation['bbox']>;words:NonNullable<Observation['ocrWords']>}>();
  for(const word of observation.ocrWords){
    const key=[word.bbox.x0,word.bbox.y0,word.bbox.x1,word.bbox.y1].join(':');
    const region=regions.get(key);
    if(region)region.words.push(word);
    else regions.set(key,{bbox:word.bbox,words:[word]});
  }
  return Array.from(regions.values()).map(region=>{
    const words=region.words.sort((a,b)=>a.wordIndex-b.wordIndex);
    return {text:words.map(word=>word.text).join(' ').replace(/\s+/g,' ').trim(),words,bbox:region.bbox,firstWordIndex:words[0]?.wordIndex??0};
  }).sort((a,b)=>a.firstWordIndex-b.firstWordIndex);
}

type GeometricIngredientLine={source:Observation;text:string;words:NonNullable<Observation['ocrWords']>;bbox:NonNullable<Observation['bbox']>};
type GeometricIngredientCandidate={imageId:string;runId:string;lines:GeometricIngredientLine[];score:number};

/**
 * Recover the ingredient column only when OCR word boxes expose a clear
 * left/right split: an explicit INGREDIENTS heading, at least two nutrition
 * row labels in a separate right-hand region, and ingredient words left of the
 * midpoint between those regions. Raw merged OCR lines remain untouched.
 */
function reconstructGeometricIngredientColumns(input:Observation[],captures:OcrCapture[]):GeometricIngredientCandidate[] {
  const byRun=new Map<string,Observation[]>();
  for(const observation of input){
    const runId=observation.readingOrder?.runId;
    if(observation.origin!=='ocr'||observation.field!=='ocr-line'||!observation.imageId||!runId||!observation.ocrWords?.length)continue;
    const key=[observation.imageId,runId].join('\u0000');
    byRun.set(key,[...(byRun.get(key)??[]),observation]);
  }
  const candidates:GeometricIngredientCandidate[]=[];
  for(const runObservations of byRun.values()){
    const first=runObservations[0];
    const runId=first.readingOrder?.runId;
    const imageId=first.imageId;
    if(!runId||!imageId)continue;
    const capture=captures.find(item=>item.runId===runId&&item.imageId===imageId);
    if(!capture||capture.bboxCoordinateSpace!=='prepared-image-pixels')continue;
    runObservations.sort((a,b)=>(a.readingOrder?.lineIndex??0)-(b.readingOrder?.lineIndex??0));
    const regions=runObservations.flatMap(observation=>ocrWordRegions(observation).map(region=>({observation,region})));
    const headings=regions.filter(({region})=>/^ingredients?$/i.test(region.text.replace(/[:：]$/,'').trim()));
    if(headings.length!==1)continue;
    const heading=headings[0];
    const width=capture.preparedImage.width;
    const tableLabels=regions.filter(({observation,region})=>
      region!==heading.region
      &&region.bbox.x0>=heading.region.bbox.x1+width*0.015
      &&(!!matchNutrientRow(region.text.replace(/^[\s"'~•*#\-–—|]+/u,''))||tableStructureRowLabel.test(region.text.replace(/^[\s"'~•*#\-–—|]+/u,'')))
    );
    const distinctRows=tableLabels.filter((item,index)=>tableLabels.findIndex(other=>
      other.observation.id!==item.observation.id
      &&Math.abs((other.region.bbox.y0+other.region.bbox.y1)/2-(item.region.bbox.y0+item.region.bbox.y1)/2)>capture.preparedImage.height*0.025
    )!==-1);
    if(distinctRows.length<2)continue;
    const tableStartX=Math.min(...tableLabels.map(item=>item.region.bbox.x0));
    const tableBottomY=Math.max(...distinctRows.map(item=>item.region.bbox.y1));
    const gap=tableStartX-heading.region.bbox.x1;
    if(gap<width*0.04)continue;
    const ingredientRightBoundary=(tableStartX+heading.region.bbox.x1)/2;
    const headerLineIndex=heading.observation.readingOrder?.lineIndex;
    if(headerLineIndex===undefined)continue;
    let started=false;
    const lines:GeometricIngredientLine[]=[];
    for(const observation of runObservations){
      const lineIndex=observation.readingOrder?.lineIndex;
      if(lineIndex===undefined||lineIndex<headerLineIndex)continue;
      const leftRegions=ocrWordRegions(observation).filter(region=>
        (region.bbox.x0+region.bbox.x1)/2<ingredientRightBoundary
        ||region.bbox.y0>=tableBottomY+capture.preparedImage.height*0.015
      );
      for(const region of leftRegions){
        let text=region.text.trim();
        if(!started){
          if(!/^ingredients?$/i.test(text.replace(/[:：]$/,'').trim()))continue;
          started=true;
          continue;
        }
        if(/^(?:allergen\b|contains\b|may\s+contain\b)/i.test(text))break;
        if(/^(?:nutrition(?:al)?\b|serving\b|net\s+(?:weight|quantity)\b|best\s+before\b|manufactur(?:ed|er)\b|barcode\b)/i.test(text))break;
        const belowTable=(region.bbox.x0+region.bbox.x1)/2>=ingredientRightBoundary
          &&region.bbox.y0>=tableBottomY+capture.preparedImage.height*0.015;
        if(belowTable&&/\b(?:guideline|daily\s+amounts?|amounts?|average\s+adult|gda|rda|\d{3,4}\s*kcal)\b/i.test(text))continue;
        if(/^ingredients?\b/i.test(text))text=text.replace(/^ingredients?\s*[:：-]?\s*/i,'').trim();
        if(!text)continue;
        lines.push({source:observation,text,words:region.words,bbox:region.bbox});
      }
      if(started&&leftRegions.some(region=>/^(?:allergen\b|contains\b|may\s+contain\b)/i.test(region.text.trim())))break;
    }
    if(lines.length<2||lines.reduce((sum,line)=>sum+line.text.length,0)<20)continue;
    const confidenceValues=lines.flatMap(line=>line.words.map(word=>word.confidence).filter((value):value is number=>value!==null));
    const meanConfidence=confidenceValues.length?confidenceValues.reduce((sum,value)=>sum+value,0)/confidenceValues.length:0;
    const wordCount=lines.reduce((sum,line)=>sum+line.words.length,0);
    candidates.push({imageId,runId,lines,score:wordCount*10+lines.length*5+meanConfidence});
  }
  const bestByImage=new Map<string,GeometricIngredientCandidate>();
  for(const candidate of candidates){
    const current=bestByImage.get(candidate.imageId);
    if(!current||candidate.score>current.score)bestByImage.set(candidate.imageId,candidate);
  }
  return Array.from(bestByImage.values());
}

function valueMatchesHaveClearSeparators(values:RegExpMatchArray[],text:string):boolean{
  if(values.length<2)return false;
  for(let index=1;index<values.length;index++){
    const previous=values[index-1];
    const current=values[index];
    if(previous.index===undefined||current.index===undefined)return false;
    const previousValueEnd=previous.index+previous[1].length+(previous[2]?.length??0);
    const separator=text.slice(previousValueEnd,current.index);
    if(!/^\s+$/.test(separator))return false;
  }
  return true;
}

type PositionedNutritionNumber={
  rawText:string;
  value:number;
  unit:string|null;
  center:number;
  y:number;
  observation:Observation;
  words:NonNullable<Observation['ocrWords']>;
};

function positionedNutritionNumbers(observation:Observation):PositionedNutritionNumber[] {
  const words=observation.ocrWords;
  if(!words?.length)return [];
  const result:PositionedNutritionNumber[]=[];
  for(let index=0;index<words.length;index++){
    const word=words[index];
    if(word.text.includes('%'))continue;
    const match=word.text.match(/^(-?(?:\d+(?:[.,]\d+)?|\.\d+))\s*(kcal|kj|mg|g|ml)?[.,;:]?$/i);
    if(!match)continue;
    const value=Number(match[1].replace(',','.'));
    if(!Number.isFinite(value))continue;
    let unit=match[2]?.toLowerCase()??null;
    let right=word.bbox.x1;
    const tokenWords=[word];
    if(!unit&&words[index+1]&&/^(kcal|kj|mg|g|ml)$/i.test(words[index+1].text.trim())){
      unit=words[index+1].text.trim().toLowerCase();
      right=words[index+1].bbox.x1;
      tokenWords.push(words[index+1]);
      index++;
    }else if(!unit&&words[index+1]?.text.trim()==='%'){
      index++;
      continue;
    }
    result.push({
      rawText:tokenWords.map(item=>item.text).join(' '),
      value,
      unit,
      center:(word.bbox.x0+right)/2,
      y:(word.bbox.y0+word.bbox.y1)/2,
      observation,
      words:tokenWords,
    });
  }
  return result;
}

function reconstructionBasisCenters(observation:Observation,bases:Basis[]):number[]|undefined {
  const geometric=basisGeometryCenters(observation,bases);
  if(geometric?.length===bases.length&&Math.max(...geometric)-Math.min(...geometric)>1)return geometric;
  const words=observation.ocrWords;
  if(!words?.length)return geometric;
  const regions=new Map<string,{bbox:NonNullable<Observation['bbox']>;words:NonNullable<Observation['ocrWords']>}>();
  for(const word of words){
    const key=[word.bbox.x0,word.bbox.y0,word.bbox.x1,word.bbox.y1].join(':');
    const current=regions.get(key);
    if(current)current.words.push(word);
    else regions.set(key,{bbox:word.bbox,words:[word]});
  }
  for(const region of regions.values()){
    const text=region.words.sort((a,b)=>a.wordIndex-b.wordIndex).map(word=>word.text).join(' ');
    const matches=[...text.matchAll(/(?:per|each|pour|para|par|por|\/)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/gi)];
    const centers:number[]=[];
    for(const basis of bases){
      const match=matches.find(item=>Math.abs(Number(item[1].replace(',','.'))-basis.amount)<0.000001&&item[2].toLowerCase()===basis.unit);
      if(!match||match.index===undefined){centers.length=0;break;}
      const midpoint=match.index+match[0].length/2;
      centers.push(region.bbox.x0+(region.bbox.x1-region.bbox.x0)*midpoint/Math.max(1,text.length));
    }
    if(centers.length===bases.length&&new Set(centers).size===centers.length)return centers;
  }
  return geometric;
}

/**
 * Rebuild a strongly regular multi-column nutrition table when package curvature
 * has displaced the OCR boxes vertically. Raw lines remain untouched in the
 * observation ledger; this creates traceable parser-only row candidates.
 */
function reconstructCurvedNutritionRows(
  textLines:string[],
  input:Observation[],
  captures:OcrCapture[]
):{lines:string[];observations:Observation[]} {
  const byRun=new Map<string,Observation[]>();
  for(const observation of input){
    const runId=observation.readingOrder?.runId;
    if(observation.origin!=='ocr'||observation.field!=='ocr-line'||!observation.imageId||!runId||!observation.ocrWords?.length)continue;
    const key=`${observation.imageId}\u0000${runId}`;
    byRun.set(key,[...(byRun.get(key)??[]),observation]);
  }
  const replacements=new Map<string,string[]>();
  const suppressed=new Map<string,number>();
  const derived:Observation[]=[];
  const consumedObservationIds=new Set<string>();
  for(const runObservations of byRun.values()){
    const first=runObservations[0];
    const runId=first.readingOrder?.runId;
    const capture=captures.find(item=>item.runId===runId&&item.imageId===first.imageId);
    if(!capture||capture.bboxCoordinateSpace!=='prepared-image-pixels')continue;
    const headers=runObservations.flatMap(observation=>{
      if(matchNutrientRow(observation.text,observation))return [];
      const bases=basesIn(observation.text);
      if(bases.length<2)return [];
      const centers=reconstructionBasisCenters(observation,bases);
      return centers?.length===bases.length?[{observation,bases,centers}]:[];
    });
    if(headers.length!==1)continue;
    const header=headers[0];
    if(header.bases.length<2||header.bases.length>4)continue;
    const numbers=runObservations.filter(observation=>observation.id!==header.observation.id).flatMap(positionedNutritionNumbers);
    const columns=header.bases.map((basis,index)=>({basis,center:header.centers[index],values:[] as PositionedNutritionNumber[]}));
    let ambiguous=false;
    const maxDistance=capture.preparedImage.width*.12;
    const requiredMargin=Math.max(12,capture.preparedImage.width*.02);
    const assignedIds=new Set<string>();
    for(const number of numbers){
      const ranked=columns.map((column,index)=>({index,distance:Math.abs(number.center-column.center)})).sort((a,b)=>a.distance-b.distance);
      if(!ranked.length||ranked[0].distance>maxDistance)continue;
      if(ranked.length>1&&ranked[1].distance-ranked[0].distance<requiredMargin){ambiguous=true;break;}
      columns[ranked[0].index].values.push(number);
      assignedIds.add(number.observation.id);
    }
    if(ambiguous||columns.some(column=>column.values.length<5))continue;
    for(const column of columns)column.values.sort((a,b)=>a.y-b.y||a.center-b.center);
    const columnCenters=columns.map(column=>column.center);
    const labelSeparator=(columnCenters[0]+columnCenters[1])/2;
    const rowGaps=columns.flatMap(column=>column.values.slice(1).map((value,index)=>value.y-column.values[index].y)).filter(gap=>gap>0).sort((a,b)=>a-b);
    const rowSpacing=rowGaps.length?rowGaps[Math.floor(rowGaps.length/2)]:0;
    if(rowSpacing<=0)continue;
    const numericTop=Math.min(...columns.map(column=>column.values[0].y));
    const numericBottom=Math.max(...columns.map(column=>column.values[column.values.length-1].y));
    const wordHeights=runObservations.flatMap(observation=>observation.ocrWords??[]).map(word=>word.bbox.y1-word.bbox.y0).filter(height=>height>0).sort((a,b)=>a-b);
    const typicalWordHeight=wordHeights.length?wordHeights[Math.floor(wordHeights.length/2)]:rowSpacing*.4;
    const labelTolerance=Math.max(8,typicalWordHeight*.42);
    const labelTokens=runObservations.flatMap(observation=>(observation.ocrWords??[]).flatMap(word=>{
      const token=word.text.trim();
      const centerX=(word.bbox.x0+word.bbox.x1)/2;
      const y=(word.bbox.y0+word.bbox.y1)/2;
      if(!/\p{L}/u.test(token)||/\d/.test(token)||/^(?:per|pour|para|par|por|each|g|ml|kcal|kj|mg)$/i.test(token)||centerX>=labelSeparator||y<numericTop-rowSpacing*.85||y>numericBottom+rowSpacing*1.25)return [];
      return [{token,word,observation,y}];
    })).sort((a,b)=>a.y-b.y||a.word.bbox.x0-b.word.bbox.x0||a.observation.readingOrder!.lineIndex-b.observation.readingOrder!.lineIndex||a.word.wordIndex-b.word.wordIndex);
    const labelGroups:Array<{y:number;tokens:typeof labelTokens}> = [];
    for(const token of labelTokens){
      let group=labelGroups.find(item=>Math.abs(item.y-token.y)<=labelTolerance);
      if(!group){group={y:token.y,tokens:[]};labelGroups.push(group);}
      group.tokens.push(token);
      group.y=group.tokens.reduce((sum,item)=>sum+item.y,0)/group.tokens.length;
    }
    const rowLabels=labelGroups.map(group=>{
      const tokens=group.tokens.sort((a,b)=>a.word.bbox.x0-b.word.bbox.x0||a.observation.readingOrder!.lineIndex-b.observation.readingOrder!.lineIndex||a.word.wordIndex-b.word.wordIndex);
      const text=tokens.map(item=>item.token).join(' ').replace(/\s+/g,' ').trim();
      if(/^(?:nutrients?|nutrition(?:al)?(?: information)?|per\b|par\b|por\b)/i.test(text))return undefined;
      const observation=tokens[0]?.observation;
      const matched=observation&&matchNutrientRow(text,{...observation,text});
      const observations=Array.from(new Map(tokens.map(item=>[item.observation.id,item.observation])).values());
      return observation?{text,y:group.y,words:tokens.map(item=>item.word),observations,row:matched?.row}:undefined;
    }).filter((item):item is NonNullable<typeof item>=>Boolean(item)).sort((a,b)=>a.y-b.y||a.observations[0].id.localeCompare(b.observations[0].id));
    const energyIndexes=rowLabels.flatMap((label,index)=>label.row?.key==='energy'?[index]:[]);
    const valueCount=columns[0]?.values.length??0;
    if(rowLabels.length<5||columns.some(column=>column.values.length!==valueCount))continue;
    // Most recognized rows have one value in each declared column. Some
    // packages print energy on two aligned sub-rows (for example, kJ then
    // kcal); support that only when every numeric column has the same single
    // surplus and there is exactly one explicit energy row to own it.
    const rowValueCounts=rowLabels.map(()=>1);
    const extraValues=valueCount-rowLabels.length;
    if(extraValues<0)continue;
    if(extraValues>0){
      if(extraValues!==1||energyIndexes.length!==1)continue;
      rowValueCounts[energyIndexes[0]]=2;
    }
    if(columns.some(column=>column.values.length!==rowValueCounts.reduce((sum,count)=>sum+count,0)))continue;
    const explicitUnitWords=(anchorWords:NonNullable<Observation['ocrWords']>,rowY:number,values:PositionedNutritionNumber[])=>{
      if(values.every(value=>value.unit))return [] as {word:NonNullable<Observation['ocrWords']>[number];observation:Observation}[];
      const knownUnits=new Set(values.map(value=>value.unit).filter((unit):unit is string=>Boolean(unit)));
      const labelRight=Math.max(...anchorWords.map(word=>word.bbox.x1));
      const horizontalMargin=Math.max(4,typicalWordHeight*.12);
      const verticalTolerance=Math.max(labelTolerance,typicalWordHeight*.6);
      const candidates=runObservations.flatMap(observation=>{
        if(observation.text.trim().split(/\s+/).length!==1||!observation.ocrWords?.length)return [];
        return observation.ocrWords.flatMap(word=>{
          const unit=word.text.trim().toLowerCase();
          const centerX=(word.bbox.x0+word.bbox.x1)/2;
          const centerY=(word.bbox.y0+word.bbox.y1)/2;
          if(!/^(?:kcal|kj|mg|g|ml)$/.test(unit)||centerX<labelRight+horizontalMargin||centerX>=columnCenters[0]-horizontalMargin||Math.abs(centerY-rowY)>verticalTolerance)return [];
          if(knownUnits.size&&![...knownUnits].every(existing=>existing===unit))return [];
          return [{word,observation,unit}];
        });
      });
      if(!candidates.length)return [];
      const unitNames=new Set(candidates.map(candidate=>candidate.unit));
      if(unitNames.size!==1)return [];
      const sorted=candidates.sort((a,b)=>Math.abs((a.word.bbox.y0+a.word.bbox.y1)/2-rowY)-Math.abs((b.word.bbox.y0+b.word.bbox.y1)/2-rowY)||a.word.bbox.x0-b.word.bbox.x0);
      const nearestDistance=Math.abs((sorted[0].word.bbox.y0+sorted[0].word.bbox.y1)/2-rowY);
      const tied=sorted.filter(candidate=>Math.abs(Math.abs((candidate.word.bbox.y0+candidate.word.bbox.y1)/2-rowY)-nearestDistance)<=Math.max(2,typicalWordHeight*.15));
      return tied.map(({word,observation})=>({word,observation}));
    };
    const rowValues: {sourceText:string;sourceObservationId:string;candidate:Observation}[]=[];
    let valueOffset=0;
    for(const [index,anchor] of rowLabels.entries()){
      const count=rowValueCounts[index];
      if(!anchor.row){valueOffset+=count;continue;}
      for(let subrow=0;subrow<count;subrow++){
        const values=columns.map(column=>column.values[valueOffset+subrow]);
        if(values.some(value=>!value))continue;
        const valueY=values.reduce((sum,value)=>sum+value.y,0)/values.length;
        const unitEvidence=explicitUnitWords(anchor.words,valueY,values);
        const unitNames=new Set(unitEvidence.map(item=>item.word.text.trim().toLowerCase()));
        if(unitNames.size>1)continue;
        const valueUnits=new Set(values.map(value=>value.unit).filter((unit):unit is string=>Boolean(unit)));
        if(unitNames.size&&valueUnits.size&&[...valueUnits].some(unit=>unit!==[...unitNames][0]))continue;
        const words=[...anchor.words,...unitEvidence.map(item=>item.word),...values.flatMap(value=>value.words)]
          .sort((a,b)=>a.bbox.x0-b.bbox.x0||a.bbox.y0-b.bbox.y0)
          .map((word,wordIndex)=>({...word,wordIndex}));
        const derivedFromObservationIds=Array.from(new Set([
          ...anchor.observations.map(observation=>observation.id),
          ...unitEvidence.map(item=>item.observation.id),
          ...values.map(value=>value.observation.id),
        ]));
        const bbox=words.length?{
          x0:Math.min(...words.map(word=>word.bbox.x0)),y0:Math.min(...words.map(word=>word.bbox.y0)),
          x1:Math.max(...words.map(word=>word.bbox.x1)),y1:Math.max(...words.map(word=>word.bbox.y1)),
        }:undefined;
        const candidate:Observation={
          id:crypto.randomUUID(),field:'nutrition-row-candidate',
          text:[anchor.text,...unitEvidence.map(item=>item.word.text.trim()),...values.map(value=>value.rawText)].join(' '),
          side:anchor.observations[0].side,confidence:null,origin:'ocr',imageId:anchor.observations[0].imageId,
          ...(bbox?{bbox}:{}),ocrWords:words,
          readingOrder:anchor.observations[0].readingOrder,
          derivedFromObservationIds,
        };
        rowValues.push({sourceText:anchor.observations[0].text,sourceObservationId:anchor.observations[0].id,candidate});
      }
      valueOffset+=count;
    }
    const rowCandidates=rowValues;
    for(const row of rowCandidates){
      replacements.set(row.sourceObservationId,[...(replacements.get(row.sourceObservationId)??[]),row.candidate.text]);
      derived.push(row.candidate);
    }
    for(const anchor of rowLabels)for(const observation of anchor.observations)consumedObservationIds.add(observation.id);
    for(const id of assignedIds)consumedObservationIds.add(id);
  }
  if(!derived.length)return {lines:textLines,observations:[]};
  for(const observation of input)if(consumedObservationIds.has(observation.id))suppressed.set(observation.text,(suppressed.get(observation.text)??0)+1);
  const sourceLinesByText=new Map<string,Observation[]>();
  for(const observation of input){
    if(observation.origin!=='ocr'||observation.field!=='ocr-line')continue;
    const key=observation.text.trim();
    sourceLinesByText.set(key,[...(sourceLinesByText.get(key)??[]),observation]);
  }
  const sourceLineIndexes=new Map<string,number>();
  const lines:string[]=[];
  for(const line of textLines){
    const key=line.trim();
    const occurrence=sourceLineIndexes.get(key)??0;
    sourceLineIndexes.set(key,occurrence+1);
    const sourceObservation=sourceLinesByText.get(key)?.[occurrence];
    const replacement=sourceObservation?replacements.get(sourceObservation.id):undefined;
    if(replacement?.length){
      lines.push(...replacement);
      replacement.length=0;
      const count=suppressed.get(line)??0;
      if(count>0)suppressed.set(line,count-1);
      continue;
    }
    const count=suppressed.get(line)??0;
    if(count>0){suppressed.set(line,count-1);continue;}
    lines.push(line);
  }
  return {lines,observations:derived};
}

const nonNamePrefix=/^(?:nutrition|nutritional|valeurs nutrition|contenido\b|informaci[oó]n\b|voedingswaard|voedingsinformatie|per\b|pour\b|para\b|par\b|por\b|ingredients?|contains|allergen|net\b|serving\b|no\.?\s*of\s+servings?\b|soluble\b|insoluble\b|of\s+which\b|energy\b|calories\b|carbohyd|carbs?\b|sugars?\b|added sugars?\b|protein\b|fat\b|saturated\b|trans\b|cholesterol\b|sodium\b|salt\b|fssai\b|licen[cs]e|barcode|total\b|synthetic)/i;
const labelMetadata=/\b(?:servings?\s+per\s+(?:pack|package|container)|serving\s+size|portion\s+size|per\s*\d+(?:\.\d+)?\s*(?:g|ml)|if\s+(?:a|one)\s+serv(?:e|ing)\s+is\s*\d+(?:[.,]\d+)?\s*(?:g|ml)|approximate\s+values?)\b|^\(?\s*(?:\d+(?:[.,]\d+)?|[il|])\s*(?:cucharas?|cucharadas?|cucharaditas?|cuill[eè]res?|spoon(?:ful)?s?|tbsp|tsp)\s*\)?$/i;
const referenceIntake=/\b(?:reference\s+intake|adult[-\s]type|daily\s+value|valeur\s+quotidienne|apport\s+de\s+r[eé]f[eé]rence|assunzioni\s+di\s+riferimento|ingesta\s+de\s+referencia)\b/i;
const nutritionRowTerm=/\b(?:nutrition|information|typical\s+value|energy|calories|carbohydrates?|glucides|koolhydraten|hidratos|sugars?|sucres|suikers|az[uú]cares|protein|prot[eé]ines?|prote[ií]nas?|eiwitten|fat|gras|vetten|saturat(?:ed|es)|fiber|fibre|vezels|fatty|faty|acids?|sodium|sodio|salt|sel|zout|cholesterol|vitamins?|minerals?|[il1]ron|calcium|zinc|magnesium|potassium|phosph(?:orus|ate)|thiamin|riboflavin|niacin|fol(?:ate|ic\s+acid)|biotin|copper|manganese|selenium|iodine|chloride|omega(?:[-\s]?\d)?)\b/i;
const slogan=/^(?:[®™]\s*)?(?:taste(?:\s+the\s+feeling)?|feel\s+good|great\s+taste)\b|\b(?:delicious(?:ly)?|tasty)\b/i;
function isNameCandidate(line:string){
  const candidateText=line.replace(/^[~•*#\-–—|\s]+/u,'');
  const measuredTableValue=/\d/.test(candidateText)&&(/[()]/.test(candidateText)||/\(\s*(?:kcal|kj|mg|g|ml)\s*\)/i.test(candidateText));
  const nutrientValueLine=/\d/.test(candidateText)&&nutritionRowTerm.test(candidateText);
  const nutritionHeading=/\b(?:nutrition|information|typical\s+value)\b/i.test(candidateText)||/^(?:contenido\s+(?:energ|nutric)|informaci[oó]n\s+nutric|valor\s+energ|voedingswaard|voedingsinformatie)/i.test(candidateText);
  const basisOnlyHeader=candidateText.replace(/\b\d+(?:[.,]\d+)?\s*(?:g|ml|kcal|kj|mg|mcg)\b/gi,' ').replace(/[|/,:;()[\]]/g,' ').trim();
  const onlyBasisAndColumnWords=!basisOnlyHeader||/^(?:per|par|por|pour)$/i.test(basisOnlyHeader);
  const hasReadableWord=/\p{L}{3,}/u.test(candidateText);
  return candidateText.length>=3&&hasReadableWord&&!rows.some(row=>row.pattern.test(candidateText))&&!nonNamePrefix.test(candidateText)&&!labelMetadata.test(candidateText)&&!referenceIntake.test(candidateText)&&!nutritionHeading&&!nutrientValueLine&&!slogan.test(candidateText)&&!measuredTableValue&&!onlyBasisAndColumnWords;
}
const nameConfidenceThreshold=80;
function labelName(lines:string[],inputObservations:Observation[],origin:Observation['origin']|undefined){
  const candidates=lines.filter(isNameCandidate);
  if(origin==='ocr'){
    const readableCandidates=candidates.filter(line=>inputObservations.some(observation=>observation.text.trim()===line&&observation.origin==='ocr'&&observation.confidence!==null&&observation.confidence>=nameConfidenceThreshold));
    const imageHasNutritionPanel=(imageId:string)=>{
      const rowKeys=new Set(inputObservations
        .filter(observation=>observation.field==='ocr-line'&&observation.imageId===imageId)
        .map(observation=>matchNutrientRow(observation.text,observation,true)?.row.key)
        .filter((key):key is NutrientKey=>!!key));
      return rowKeys.size>=2;
    };
    const selected=readableCandidates.find(line=>inputObservations.some(observation=>
      observation.text.trim()===line
      &&observation.origin==='ocr'
      &&observation.confidence!==null
      &&observation.confidence>=nameConfidenceThreshold
      &&!!observation.imageId
      &&!imageHasNutritionPanel(observation.imageId)
    ));
    return {
      name:selected?.slice(0,200)??'Unidentified package',
      withheld:!selected,
      withheldFromNutritionPhoto:!selected&&readableCandidates.some(line=>inputObservations.some(observation=>observation.text.trim()===line&&observation.imageId&&imageHasNutritionPanel(observation.imageId))),
    };
  }
  return {name:candidates[0]?.slice(0,200)??'Unidentified package',withheld:false,withheldFromNutritionPhoto:false};
}

/** A conservative text parser: an OCR reading remains an observation. */
export function parseLabel(text:string,options:ParseOptions={}):PackageData {
  if(typeof text!=='string'||text.length>40000) throw new Error('Label text must be at most 40,000 characters.');
  if(options.confidence!==undefined&&options.confidence!==null&&(!Number.isFinite(options.confidence)||options.confidence<0||options.confidence>100)) throw new Error('Confidence must be 0–100.');
  const rawLines=text.replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  const id=crypto.randomUUID();
  const sourceObservations:Observation[]=(options.observations??[]).map(o=>({...o}));
  const reconstructed=reconstructCurvedNutritionRows(rawLines,sourceObservations,options.ocrCaptures??[]);
  const lines=reconstructed.lines;
  const observations:Observation[]=[...sourceObservations,...reconstructed.observations];
  const suppliedObservationCounts=new Map<string,number>();
  const parserObservationCounts=new Map<string,number>();
  const inputObservations=new Map<string,Observation[]>();
  for(const observation of observations){const key=observation.text.trim();inputObservations.set(key,[...(inputObservations.get(key)??[]),observation]);suppliedObservationCounts.set(key,(suppliedObservationCounts.get(key)??0)+1);}
  const warnings:string[]=[];
  if(reconstructed.observations.length)warnings.push('Nutrition rows were aligned by their printed column order to account for a skewed or curved panel; linked OCR readings remain available for review.');
  const hasApproximateNutritionQualifier=lines.some(line=>/\bapproximate\s+values?\b/i.test(line)&&!matchNutrientRow(line)?.row)
    &&lines.some(line=>nutritionRowTerm.test(line)||/\b(?:per|pour|para|par|por)\s*:?[ \t]*\d+(?:[.,]\d+)?\s*(?:g|ml)\b/i.test(line));
  if(hasApproximateNutritionQualifier)warnings.push('The package labels its nutrition values as approximate; calculations based on them are estimates using the printed readings.');
  const nameResult=labelName(lines,options.observations??[],options.origin);
  const selectedNameLineIndex=nameResult.name==='Unidentified package'?-1:lines.findIndex(line=>line===nameResult.name);
  // Leave room for the bounded set of observations added after the line pass
  // (name, optional user description/metadata, and ingredient-code identities).
  const resolveAdditives=options.resolveAdditives??(()=>[]);
  const tailObservationReserve=5+resolveAdditives(text).length;
  const preserveUserTextLine=(line:string,lineIndex:number,occurrenceIndex:number)=>{
    const key=line.trim();
    const representedOccurrenceCount=(suppliedObservationCounts.get(key)??0)+(parserObservationCounts.get(key)??0);
    if(options.origin!=='user'||!key||lineIndex===selectedNameLineIndex||occurrenceIndex<representedOccurrenceCount)return;
    if(observations.length>=4000-tailObservationReserve)return;
    observations.push({id:`${id}-raw${lineIndex}`,field:'raw-text-line',text:line,side:'text',origin:'user',confidence:null});
  };
  const observe=(field:string,line:string,value?:number,unit?:string,sourceOverride?:Observation)=> {
    const originals=inputObservations.get(line.trim());
    const original=sourceOverride??originals?.shift();
    const obs:Observation={id:`${id}-o${observations.length}`,field,text:line,side:original?.side??options.side??'text',origin:original?.origin??options.origin??'user',confidence:original?.confidence??options.confidence??null,...(original?.bbox?{bbox:original.bbox}:{}),...(original?.imageId?{imageId:original.imageId}:{}),...(original?.readingOrder?{readingOrder:original.readingOrder}:{}),...(original?{derivedFromObservationIds:[original.id]}:{}),...(value!==undefined?{value}:{}),...(unit?{unit}:{})};
    observations.push(obs);
    if(!original){const key=obs.text.trim();parserObservationCounts.set(key,(parserObservationCounts.get(key)??0)+1);}
    return obs.id;
  };
  const sourceOcrObservationForId=(observationId:string|undefined):Observation|undefined=>{
    if(!observationId)return;
    const derived=observations.find(item=>item.id===observationId);
    if(derived?.origin==='ocr'&&(derived.field==='ocr-line'||derived.field==='nutrition-row-candidate')&&derived.ocrWords?.length)return derived;
    const sourceIds=derived?.derivedFromObservationIds??[observationId];
    return observations.find(item=>sourceIds.includes(item.id)&&item.origin==='ocr'&&(item.field==='ocr-line'||item.field==='nutrition-row-candidate'));
  };
  const servingMatch=text.match(/(?:(?:serv(?:e|ing)\s+(?:size|measure|mass|quantity)|portion\s+(?:size|measure|mass|quantity)|serveasure|(?:per|each|pour|para|par|por)\s+(?:(?:the|a|an|une|un|una)\s+)?(?:serv(?:e|ing)|portion|porci[oó]n|raci[oó]n)(?:\s+(?:de|of))?)|if\s+(?:a|one)\s+serv(?:e|ing)\s+is)[ \t]*[:\-]?[ \t]*(?:[^\n\d]{0,20})?(\d+(?:[.,]\d+)?)[ \t]*(g|ml)\b/i);
  const serving=servingMatch?mass(servingMatch[1],servingMatch[2]):undefined;
  const weightMatch=text.match(/(?:net\s*(?:weight|wt\.?|quantity|qty\.?)|pack\s*size)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|ml|g|l)\b/i);
  const netWeight=weightMatch?mass(weightMatch[1],weightMatch[2]):undefined;
  const servingSourceObservation=servingMatch?sourceObservations.find(observation=>observation.origin==='ocr'&&observation.field==='ocr-line'&&observation.text.includes(servingMatch[0])):undefined;
  const servingObservationId=servingMatch?observe('serving',servingMatch[0],undefined,undefined,servingSourceObservation):undefined;
  if(weightMatch) observe('netWeight',weightMatch[0]);
  const ingredients:string[]=[]; const allergens:string[]=[]; const claims:string[]=[];
  let ingredientsOpen=false; let basis:Basis|null=null; let columnBases:Basis[]=[]; let basisObservationIds:string[]=[]; let columnHeaderObservationIds:string[]=[]; let ambiguousBasis=false;
  const nutrients:Nutrient[]=[];
  const parserDiagnostics:ParserDiagnostic[]=[];
  const splitHeaders=splitServingTableHeaders(sourceObservations,options.ocrCaptures??[],serving);
  const pairedSplitHeaderIds=new Set(Array.from(splitHeaders.values(),header=>header.pairedHeaderObservationId));
  let orderedSplitHeader:{imageId:string;runId:string}|undefined;
  const lineOccurrenceCounts=new Map<string,number>();
  for(let lineIndex=0;lineIndex<lines.length;lineIndex++) {
    const line=lines[lineIndex];
    const occurrenceIndex=lineOccurrenceCounts.get(line)??0;
    lineOccurrenceCounts.set(line,occurrenceIndex+1);
    const ingredientLine=line.match(/^ingredients?\s*[:：]\s*(.*)/i);
    if(ingredientLine){ingredientsOpen=true;ingredients.push(ingredientLine[1]);observe('ingredients',line);preserveUserTextLine(line,lineIndex,occurrenceIndex);continue;}
    if(/^(?:contains|may contain|allergen)/i.test(line)){ingredientsOpen=false;allergens.push(line);observe('allergens',line);preserveUserTextLine(line,lineIndex,occurrenceIndex);continue;}
    if(/\b(?:sugar[ -]free|no added sugar|high protein|organic|ORS|oral rehydration)\b/i.test(line)){claims.push(line);observe('claim',line);}
    // OCR frequently glues an all-caps column heading to a title-cased basis,
    // e.g. "NUTRIENTSPer 100g". Normalize only the parser view; keep the
    // original observation text unchanged for user review and provenance.
    const parserLine=line.replace(/([A-Z]{4,})(?=(?:Per|Pour|Para|Par|Por)\s*:?\s*\d)/i,'$1 ');
    const sourceLines=inputObservations.get(line.trim())??[];
    const rawOcrRow=sourceLines.find(observation=>splitHeaders.has(observation.id)||pairedSplitHeaderIds.has(observation.id))??sourceLines[0];
    const rowUsesMatchingSplitHeader=!!orderedSplitHeader&&rawOcrRow?.imageId===orderedSplitHeader.imageId&&rawOcrRow.readingOrder?.runId===orderedSplitHeader.runId;
    const matchedRow=matchNutrientRow(parserLine,rawOcrRow,rowUsesMatchingSplitHeader);
    const nutrientRow=matchedRow?.row;
    const splitHeader=rawOcrRow?splitHeaders.get(rawOcrRow.id):undefined;
    if(splitHeader){
      ingredientsOpen=false;
      ambiguousBasis=false;
      columnBases=splitHeader.bases;
      basis=null;
      const basisObservationId=observe('basis',line);
      basisObservationIds=[basisObservationId,splitHeader.pairedHeaderObservationId,...(servingObservationId?[servingObservationId]:[])];
      columnHeaderObservationIds=[basisObservationId,splitHeader.pairedHeaderObservationId];
      orderedSplitHeader={imageId:splitHeader.imageId,runId:splitHeader.runId};
      preserveUserTextLine(line,lineIndex,occurrenceIndex);
      continue;
    }
    if(rawOcrRow&&pairedSplitHeaderIds.has(rawOcrRow.id)){
      preserveUserTextLine(line,lineIndex,occurrenceIndex);
      continue;
    }
    if(orderedSplitHeader&&!nutrientRow&&/(?:%\s*)?(?:gda|rda)\b/i.test(parserLine)){
      preserveUserTextLine(line,lineIndex,occurrenceIndex);
      continue;
    }
    const basisText=/^(?:per|pour|para|par|por)\s*:?\s*$/i.test(parserLine)?`${parserLine} ${lines[lineIndex+1]??''}`:parserLine;
    const foundBases=basesIn(basisText,serving);
    const hasBasis=foundBases.length>0||/\b(?:per|pour|para|par|por)\s*:?\s*(?:\d|serv|port|portion|porci[oó]n|raci[oó]n)/i.test(basisText)||/\/\s*\d+\s*(?:g|ml)\b/i.test(basisText);
    if(!nutrientRow&&hasBasis){
      ingredientsOpen=false;
      ambiguousBasis=foundBases.length>1;
      columnBases=foundBases;
      basis=foundBases.length===1?foundBases[0]:null;
      orderedSplitHeader=undefined;
      const basisObservationId=observe('basis',line);
      basisObservationIds=[basisObservationId,...(foundBases.some(item=>item.description==='per declared serving')&&servingObservationId?[servingObservationId]:[])];
      columnHeaderObservationIds=[basisObservationId];
      if(ambiguousBasis) warnings.push('Multiple nutrition columns detected. Their values and bases need visual confirmation before scaling.');
      else if(!basis) warnings.push('Serving basis is stated but its mass or volume is missing.');
      preserveUserTextLine(line,lineIndex,occurrenceIndex);
      continue;
    }
    if(!nutrientRow){
      if(/^(?:nutrition|nutritional|serving|net|storage|manufactur|best before|fssai|licen[cs]e|barcode)/i.test(line)) ingredientsOpen=false;
      if(ingredientsOpen){ingredients.push(line);observe('ingredients',line);}
      preserveUserTextLine(line,lineIndex,occurrenceIndex);
      continue;
    }
    ingredientsOpen=false;
    if(matchedRow.mergedPrefix)warnings.push(`${nutrientRow.key}: the unit-labeled row was located inside a merged OCR line; the original line remains in the evidence.`);
    if(matchedRow.recoveredPrefix)warnings.push(`${nutrientRow.key}: ignored a very low-confidence leading OCR token before the recognized row label; original text is retained.`);
    const basisCandidates=foundBases.length?foundBases:(columnBases.length?columnBases:(basis?[basis]:[]));
    let tail=parserLine.slice(matchedRow.labelStart).replace(nutrientRow.pattern,'');
    tail=tail.replace(/(?:per|pour|para|par|por|\/)\s*:?\s*\d+(?:\.\d+)?\s*(?:g|ml)\b/gi,'').replace(/(?:per|par|por)\s+(?:serving|serve|portion|porci[oó]n)(?:\s*\(?\s*\d+(?:\.\d+)?\s*(?:g|ml)\)?)?/gi,'');
    // A single decimal comma followed by a unit is unambiguous. Thousands or
    // otherwise unlabeled comma sequences remain multiple values and withheld.
    tail=tail.replace(/\b0,(\d{1,6})(?=\s*(?:kcal|kj|mg|g)\b)/gi,'0.$1').replace(/(\d+),(\d{1,2})(?=\s*(?:kcal|kj|mg|g)\b)/gi,'$1.$2');
    const rawSourceRow=rawOcrRow?sourceOcrObservationForId(rawOcrRow.id)??rawOcrRow:undefined;
    const columnHeaderSources=columnHeaderObservationIds.map(id=>sourceOcrObservationForId(id)).filter((observation):observation is Observation=>!!observation);
    const fusedRecovery=reconstructFusedColumnToken(tail,line,rawSourceRow,columnHeaderSources,basisCandidates,options.ocrCaptures??[]);
    if(fusedRecovery){
      tail=fusedRecovery.tail;
      observations.push(fusedRecovery.candidate);
      warnings.push(`${nutrientRow.key}: a fused numeric token was split using its character span and the two printed column headers; the original OCR token remains linked.`);
    }
    // Percentage columns do not represent additional gram amounts.
    tail=tail.replace(/\d+(?:\.\d+)?\s*%/g,'');
    const values=[...tail.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(kcal|kj|mg|g)?\b/gi)];
    const rowUnit=tail.match(/\b(kcal|kj|mg|g)\b/i)?.[1];
    const orderedEnergyUnits=nutrientRow.key==='energy'?tail.match(/^\s*[:\-]?\s*\(\s*(kJ|kcal)\s*\/\s*(kJ|kcal)\s*\)/i):null;
    const obsId=observe(nutrientRow.key,fusedRecovery?.candidate.text??line,undefined,undefined,fusedRecovery?.candidate);
    const baseSourceObservationIds=[obsId,...(foundBases.length===0?basisObservationIds:[])];
    const numericCandidates=values.map((value,valueIndex)=>{
      const n=Number(value[1]);const unit=(value[2]??(orderedEnergyUnits&&values.length===2?orderedEnergyUnits[valueIndex+1]:rowUnit))?.toLowerCase()??null;
      return {rawValueText:value[1],value:Number.isFinite(n)?n:null,unit};
    });
    const pairedEnergyValueIndex=nutrientRow.key==='energy'&&basisCandidates.length===1&&numericCandidates.length===2
      &&numericCandidates.some(candidate=>candidate.unit==='kj')&&numericCandidates.some(candidate=>candidate.unit==='kcal')
      &&/\b\d+(?:[.,]\d+)?\s*kJ\s*\(\s*\d+(?:[.,]\d+)?\s*kcal\s*\)/i.test(tail)
      ?numericCandidates.findIndex(candidate=>candidate.unit==='kcal'):undefined;
    const evidenceIds=(observationId:string,seen=new Set<string>()):string[]=>{
      if(seen.has(observationId))return [];
      seen.add(observationId);
      const parents=observations.find(item=>item.id===observationId)?.derivedFromObservationIds;
      return parents?.length?Array.from(new Set(parents.flatMap(parent=>evidenceIds(parent,seen)))):[observationId];
    };
    const numericEvidenceObservationIds=evidenceIds(obsId);
    const basisObservationIdCandidates=foundBases.length?[obsId]:basisObservationIds;
    const basisEvidenceObservationIds=Array.from(new Set(basisObservationIdCandidates.flatMap(observationId=>evidenceIds(observationId))));
    const sourceObservationIds=Array.from(new Set([...baseSourceObservationIds,...numericEvidenceObservationIds,...basisEvidenceObservationIds]));
    const diagnose=(decision:ParserDiagnostic['decision'],reasonCodes:ParserDiagnostic['reasonCodes'])=>parserDiagnostics.push({field:nutrientRow.key,decision,reasonCodes:Array.from(new Set<ParserDiagnostic['reasonCodes'][number]>(reasonCodes)),sourceObservationIds,numericEvidenceObservationIds,basisEvidenceObservationIds,numericCandidates,basisCandidates});
    if(/[<>≤≥~]|\b(?:trace|less\s+than|under|approx(?:imate(?:ly)?|imately)?|menos\s+de|inferior\s+a|por\s+debajo\s+de|moins\s+de|inf[eé]rieur(?:e)?\s+[àa]|environ)\b|\b(?:men[od0]s|m[o0]ins)\s*de(?=\s|\d)/i.test(tail)){warnings.push(`${nutrientRow.key}: bounded or approximate value retained in text; exact calculation withheld.`);diagnose('rejected',['approximate-or-bounded']);continue;}
    if(/-\s+\d/.test(tail)){warnings.push(`${nutrientRow.key}: invalid or ambiguous signed value withheld.`);diagnose('rejected',['signed-or-ambiguous']);continue;}
    if(!values.length){warnings.push(`${nutrientRow.key}: no readable numerical value.`);diagnose('rejected',['no-numeric-value']);continue;}
    const geometryBasisId=foundBases.length?obsId:basisObservationIds[0];
    const rowSourceObservation=sourceOcrObservationForId(obsId);
    const basisSourceObservation=sourceOcrObservationForId(geometryBasisId);
    const geometryMappedBasisIndexes=values.length>1?geometryValueBasisIndexes(numericCandidates,rowSourceObservation,basisSourceObservation,basisCandidates,options.ocrCaptures??[]):undefined;
    const rowMatchesSplitHeader=!!orderedSplitHeader&&rowSourceObservation?.imageId===orderedSplitHeader.imageId&&rowSourceObservation.readingOrder?.runId===orderedSplitHeader.runId&&basisCandidates.length===2;
    const mappedByTextOrder=geometryMappedBasisIndexes===undefined&&!fusedRecovery&&rowMatchesSplitHeader&&numericCandidates.length===basisCandidates.length&&valueMatchesHaveClearSeparators(values,tail);
    const mappedBasisIndexes=geometryMappedBasisIndexes??fusedRecovery?.basisIndexes??(mappedByTextOrder?basisCandidates.map((_,index)=>index):undefined);
    const mappedValueIndex=values.length>1&&basisCandidates.length===1
      ?geometrySelectedValueIndex(numericCandidates,rowSourceObservation,basisSourceObservation,basisCandidates[0],options.ocrCaptures??[])??pairedEnergyValueIndex
      :undefined;
    const mappedEveryColumn=mappedBasisIndexes!==undefined&&mappedBasisIndexes.length===values.length;
    const conflicting=(ambiguousBasis||foundBases.length>1)&&!mappedEveryColumn||(values.length>1&&mappedValueIndex===undefined&&!mappedEveryColumn);
    if(pairedEnergyValueIndex!==undefined&&mappedValueIndex===pairedEnergyValueIndex)warnings.push('energy: the parenthetical kcal reading is retained with its explicit serving basis; the paired kJ text remains in the source evidence.');
    else if(fusedRecovery)warnings.push(`${nutrientRow.key}: split numeric candidates align with both declared columns by OCR-span geometry; confirm from the original photo if the label layout differs.`);
    else if(mappedEveryColumn&&mappedByTextOrder)warnings.push(`${nutrientRow.key}: values were assigned in printed column order from a split OCR header; cell-level geometry was unavailable and the original lines remain linked.`);
    else if(mappedEveryColumn)warnings.push(`${nutrientRow.key}: each recognized value aligns with a separate printed nutrition column; values retain their matched bases.`);
    else if(values.length>1&&mappedValueIndex!==undefined)warnings.push(`${nutrientRow.key}: one value aligns with the recognized ${basisCandidates[0].amount} ${basisCandidates[0].unit} column; other row values remain unassigned.`);
    else if(values.length>1) warnings.push(`${nutrientRow.key}: multiple numeric values retained; confirm the intended column.`);
    const reasonCodes:ParserDiagnostic['reasonCodes']=[];
    if(values.length>1)reasonCodes.push('multiple-values');
    if(ambiguousBasis||foundBases.length>1)reasonCodes.push('ambiguous-basis');
    if(!basisCandidates.length)reasonCodes.push('missing-basis');
    let emitted=0;
    for(const [valueIndex,value] of values.entries()){
      if(mappedEveryColumn&&(!mappedBasisIndexes||mappedBasisIndexes[valueIndex]===undefined))continue;
      if(mappedValueIndex!==undefined&&valueIndex!==mappedValueIndex)continue;
      const n=Number(value[1]); const unit=(value[2]??(orderedEnergyUnits&&values.length===2?orderedEnergyUnits[valueIndex+1]:rowUnit))?.toLowerCase();
      if(!Number.isFinite(n)||n<0||n>100000){warnings.push(`${nutrientRow.key}: invalid value withheld.`);reasonCodes.push('invalid-value');continue;}
      if(!unit){warnings.push(`${nutrientRow.key}: unit missing; no unit was guessed.`);reasonCodes.push('missing-unit');continue;}
      const validUnit=unit==='kj'?'kJ':unit as Nutrient['unit'];
      if((nutrientRow.key==='energy'&&!['kcal','kJ'].includes(validUnit))||(nutrientRow.key!=='energy'&&!['g','mg'].includes(validUnit))){warnings.push(`${nutrientRow.key}: incompatible unit withheld.`);reasonCodes.push('incompatible-unit');continue;}
      const usedHeaderBasis=foundBases.length===0?basisObservationIds:[];
      const assignedBasis=mappedEveryColumn&&mappedBasisIndexes?basisCandidates[mappedBasisIndexes[valueIndex]]:(mappedValueIndex!==undefined?basisCandidates[0]:(basisCandidates.length===1?basisCandidates[0]:null));
      nutrients.push({key:nutrientRow.key,value:n,unit:validUnit,basis:conflicting?null:assignedBasis,observationIds:[obsId,...usedHeaderBasis],status:conflicting?'conflict':'observed'});
      emitted++;
    }
    diagnose(emitted===0?'rejected':conflicting?'conflict':'accepted',reasonCodes);
    preserveUserTextLine(line,lineIndex,occurrenceIndex);
  }
  // Preserve duplicate readings. Mark disagreement on the same explicit basis.
  if(ingredients.length===0&&observations.length<3900){
    const geometricIngredients=reconstructGeometricIngredientColumns(sourceObservations,options.ocrCaptures??[])[0];
    if(geometricIngredients){
      for(const [index,line] of geometricIngredients.lines.slice(0,80).entries()){
        ingredients.push(line.text);
        observations.push({
          id:`${id}-ingredient-geometry-${index}`,
          field:'ingredients',
          text:line.text,
          side:line.source.side,
          origin:'ocr',
          confidence:null,
          bbox:line.bbox,
          imageId:line.source.imageId,
          readingOrder:line.source.readingOrder,
          derivedFromObservationIds:[line.source.id],
        });
      }
      warnings.push('Ingredient text was separated from mixed OCR lines using a clear label heading and table geometry; original readings remain linked, and uncertain or obscured text may still need review.');
    }
  }
  for(const nutrient of nutrients){
    const normalized=nutrient.value*(nutrient.unit==='mg'?.001:nutrient.unit==='kJ'?1/4.184:1);
    const conflict=nutrients.some(other=>other!==nutrient&&other.key===nutrient.key&&other.basis?.amount===nutrient.basis?.amount&&other.basis?.unit===nutrient.basis?.unit&&Math.abs(other.value*(other.unit==='mg'?.001:other.unit==='kJ'?1/4.184:1)-normalized)>Math.max(.000001,normalized*.01));
    if(conflict){nutrient.status='conflict';warnings.push(`${nutrient.key}: conflicting readings retained; calculation withheld.`);}
    if(!nutrient.basis) warnings.push(`${nutrient.key}: an unambiguous mass or volume basis is required.`);
  }
  for(const diagnostic of parserDiagnostics){
    const rowObservationId=diagnostic.sourceObservationIds[0];
    const hasCrossReadingConflict=nutrients.some(nutrient=>nutrient.key===diagnostic.field&&nutrient.status==='conflict'&&nutrient.observationIds.includes(rowObservationId));
    if(hasCrossReadingConflict&&diagnostic.decision==='accepted'){
      diagnostic.decision='conflict';
      diagnostic.reasonCodes=Array.from(new Set<ParserDiagnostic['reasonCodes'][number]>([...diagnostic.reasonCodes,'cross-reading-conflict']));
    }
  }
  // Additive identifiers are meaningful here only when attached to the label's
  // ingredient section. OCR noise elsewhere (for example, `E000` misread near
  // a barcode or nutrition table) must not become a product ingredient.
  const additiveCodes=resolveAdditives(ingredients.join('\n'));
  for(const code of additiveCodes){const line=ingredients.find(l=>resolveAdditives(`Ingredients: ${l}`).includes(code));observe(`additive:${code}`,line??code);}
  if(nameResult.withheldFromNutritionPhoto)warnings.push('An OCR name candidate appeared only in photos that also contain nutrition tables, so package identity remains unresolved; add a front-of-pack photo or a verified product identifier.');
  else if(nameResult.withheld)warnings.push('Product name was not established from readable label text; enter a name or check a verified product identifier.');
  if(nameResult.name!=='Unidentified package')observe('name',nameResult.name);
  const userDescription=options.userDescription?.trim().slice(0,4000);
  if(userDescription)observations.push({id:`${id}-user-description`,field:'user-description',text:userDescription,side:'text',origin:'user',confidence:null});
  const brand=text.match(/^brand\s*[:：]\s*([^\n]{1,120})/im)?.[1];
  const barcode=text.match(/(?:barcode|ean|upc)\s*[:\-]?\s*(\d{8,14})\b/i)?.[1];
  const license=text.match(/(?:fssai|licen[cs]e)(?:\s*(?:licen[cs]e|no\.?|number))?\s*[:\-]?\s*(\d{14})\b/i)?.[1];
  if(barcode)observe('barcode',barcode); if(license)observe('license',license);
  if(!nutrients.length)warnings.push('No usable nutrition values were extracted. Missing values are unknown, not zero.');
  if(brand)observe('brand',brand);
  return packageSchema.parse({id,name:nameResult.name,...(brand?{brand}:{}),...(barcode?{barcode}:{}),...(userDescription?{userDescription}:{}),...(license?{license}:{}),...(serving?{serving}:{}),...(netWeight?{netWeight}:{}),ingredients,additives:additiveCodes,allergens,claims,nutrients,observations,...(options.ocrCaptures?.length?{ocrCaptures:options.ocrCaptures}:{}),parserDiagnostics,rawText:text,warnings:[...new Set(warnings)],synthetic:options.synthetic??options.origin==='fixture',createdAt:new Date().toISOString()});
}
