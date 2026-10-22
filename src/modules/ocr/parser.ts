import { packageSchema, type Nutrient, type NutrientKey, type Observation, type OcrCapture, type PackageData, type ParserDiagnostic } from '../../lib/contracts';

export type ParseOptions = {side?:Observation['side'];origin?:Observation['origin'];confidence?:number|null;observations?:Observation[];ocrCaptures?:OcrCapture[];synthetic?:boolean;userDescription?:string;resolveAdditives?:(text:string)=>string[]};
type Basis = NonNullable<Nutrient['basis']>;
const rows: {key:NutrientKey;pattern:RegExp}[] = [
  {key:'addedSugars',pattern:/^(?:(?:includes?|of which)\s+)?added\s+sugars?(?=\b|\d)/i},
  {key:'saturatedFat',pattern:/^(?:(?:total|of which)\s+)?saturat(?:ed|es)\s*(?:fat)?\b|^(?:dont\s+acides gras satur[ée]s|waarvan\s+verzadigd(?:e|e vetzuren)?|de las cuales saturadas)\b/i},
  {key:'energy',pattern:/^(?:total\s+)?(?:energy|calories)\b|^(?:[ée]nergie|energ[ií]a|valor energ[ée]tico)\b/i},
  {key:'carbohydrate',pattern:/^(?:total\s+|available\s+)?carbohydrates?(?=\b|\d)|^(?:glucides|koolhydraten|hidratos de carbono)\b/i},
  {key:'sugars',pattern:/^(?:(?:total|of which)\s+)?sugars?(?=\b|\d)|^(?:dont sucres|waarvan suikers|de los cuales az[úu]cares)\b/i},
  {key:'protein',pattern:/^proteins?(?=\b|\d)|^(?:prot[ée]ines?|prote[ií]nas?|eiwitten)\b/i}, {key:'fat',pattern:/^(?:total\s+)?fat\b|^(?:mati[èe]res grasses|vetten|grasas)\b/i},
  {key:'fiber',pattern:/^(?:dietary\s+)?fib(?:er|re)\b/i},
  {key:'sodium',pattern:/^(?:sodium|sodio)\b/i}, {key:'salt',pattern:/^(?:salt|sel|zout|sal)\b/i},
];
type MatchedRow = {row:typeof rows[number];labelStart:number;recoveredPrefix?:string};
function matchNutrientRow(line:string,observation?:Observation):MatchedRow|undefined {
  const exact=rows.find(row=>row.pattern.test(line));
  if(exact)return {row:exact,labelStart:0};
  const words=observation?.origin==='ocr'&&observation.field==='ocr-line'?observation.ocrWords:undefined;
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
      let token=word.text.replace(/^(?:per|pour|para)/i,'');
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
        if(/^(?:per|pour|para)$/i.test(words[prior].text.trim())){left=words[prior].bbox.x0;break;}
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
  const n = Number(value); const u=unit.toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return;
  return {value:n*(u==='kg'||u==='l'?1000:1),unit:u==='ml'||u==='l'?'ml':'g'};
}
function basesIn(line:string,serving?:PackageData['serving']):Basis[] {
  const result:Basis[]=[];
  for(const match of line.matchAll(/(?:per|each|pour|para|\/)\s*:?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)) {
    const amount=Number(match[1]); if(amount>0&&amount<=10000) result.push({amount,unit:match[2].toLowerCase() as 'g'|'ml',description:match[0]});
  }
  // A literal "Per: 100 ml 330 ml" table header states multiple column bases.
  // Retain all rather than assuming the first column is the only declaration.
  if(/^(?:per|pour|para)\s*:?\s*\d/i.test(line)){
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
const nonNamePrefix=/^(?:nutrition|nutritional|valeurs nutrition|contenido\b|informaci[oó]n\b|voedingswaard|voedingsinformatie|per\b|pour\b|para\b|ingredients?|contains|allergen|net\b|serving\b|no\.?\s*of\s+servings?\b|soluble\b|insoluble\b|of\s+which\b|energy\b|calories\b|carbohyd|carbs?\b|sugars?\b|added sugars?\b|protein\b|fat\b|saturated\b|trans\b|cholesterol\b|sodium\b|salt\b|fssai\b|licen[cs]e|barcode|total\b|synthetic)/i;
const labelMetadata=/\b(?:servings?\s+per\s+(?:pack|package|container)|serving\s+size|portion\s+size|per\s*\d+(?:\.\d+)?\s*(?:g|ml)|approximate\s+values?)\b/i;
const referenceIntake=/\b(?:reference\s+intake|adult[-\s]type|daily\s+value|valeur\s+quotidienne|apport\s+de\s+r[eé]f[eé]rence|assunzioni\s+di\s+riferimento|ingesta\s+de\s+referencia)\b/i;
const nutritionRowTerm=/\b(?:nutrition|information|typical\s+value|energy|calories|carbohydrates?|glucides|koolhydraten|hidratos|sugars?|sucres|suikers|az[uú]cares|protein|prot[eé]ines?|prote[ií]nas?|eiwitten|fat|gras|vetten|saturat(?:ed|es)|fiber|fibre|vezels|fatty|faty|acids?|sodium|sodio|salt|sel|zout|cholesterol|vitamins?|minerals?|[il1]ron|calcium|zinc|magnesium|potassium|phosph(?:orus|ate)|thiamin|riboflavin|niacin|fol(?:ate|ic\s+acid)|biotin|copper|manganese|selenium|iodine|chloride|omega(?:[-\s]?\d)?)\b/i;
const slogan=/^(?:[®™]\s*)?(?:taste(?:\s+the\s+feeling)?|feel\s+good|great\s+taste)\b|\b(?:delicious(?:ly)?|tasty)\b/i;
function isNameCandidate(line:string){
  const measuredTableValue=/\d/.test(line)&&(/[()]/.test(line)||/\(\s*(?:kcal|kj|mg|g|ml)\s*\)/i.test(line));
  const nutrientValueLine=/\d/.test(line)&&nutritionRowTerm.test(line);
  const nutritionHeading=/\b(?:nutrition|information|typical\s+value)\b/i.test(line)||/^(?:contenido\s+(?:energ|nutric)|informaci[oó]n\s+nutric|valor\s+energ|voedingswaard|voedingsinformatie)/i.test(line);
  const basisOnlyHeader=line.replace(/\b\d+(?:[.,]\d+)?\s*(?:g|ml|kcal|kj|mg|mcg)\b/gi,' ').replace(/[|/,:;()[\]]/g,' ').trim();
  const onlyBasisAndColumnWords=!basisOnlyHeader||/^(?:per|par|por|pour)$/i.test(basisOnlyHeader);
  const hasReadableWord=/\p{L}{3,}/u.test(line);
  return line.length>=3&&hasReadableWord&&!rows.some(row=>row.pattern.test(line))&&!nonNamePrefix.test(line)&&!labelMetadata.test(line)&&!referenceIntake.test(line)&&!nutritionHeading&&!nutrientValueLine&&!slogan.test(line)&&!measuredTableValue&&!onlyBasisAndColumnWords;
}
const nameConfidenceThreshold=80;
function labelName(lines:string[],inputObservations:Observation[],origin:Observation['origin']|undefined){
  const candidates=lines.filter(isNameCandidate);
  if(origin==='ocr'){
    const selected=candidates.find(line=>inputObservations.some(observation=>observation.text.trim()===line&&observation.origin==='ocr'&&observation.confidence!==null&&observation.confidence>=nameConfidenceThreshold));
    return {name:selected?.slice(0,200)??'Unidentified package',withheld:!selected};
  }
  return {name:candidates[0]?.slice(0,200)??'Unidentified package',withheld:false};
}

/** A conservative text parser: an OCR reading remains an observation. */
export function parseLabel(text:string,options:ParseOptions={}):PackageData {
  if(typeof text!=='string'||text.length>40000) throw new Error('Label text must be at most 40,000 characters.');
  if(options.confidence!==undefined&&options.confidence!==null&&(!Number.isFinite(options.confidence)||options.confidence<0||options.confidence>100)) throw new Error('Confidence must be 0–100.');
  const lines=text.replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  const id=crypto.randomUUID();
  const observations:Observation[]=(options.observations??[]).map(o=>({...o}));
  const suppliedObservationCounts=new Map<string,number>();
  const parserObservationCounts=new Map<string,number>();
  const inputObservations=new Map<string,Observation[]>();
  for(const observation of options.observations??[]){const key=observation.text.trim();inputObservations.set(key,[...(inputObservations.get(key)??[]),observation]);suppliedObservationCounts.set(key,(suppliedObservationCounts.get(key)??0)+1);}
  const warnings:string[]=[];
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
  const observe=(field:string,line:string,value?:number,unit?:string)=> {
    const originals=inputObservations.get(line.trim());
    const original=originals?.shift();
    const obs:Observation={id:`${id}-o${observations.length}`,field,text:line,side:original?.side??options.side??'text',origin:original?.origin??options.origin??'user',confidence:original?.confidence??options.confidence??null,...(original?.bbox?{bbox:original.bbox}:{}),...(original?.imageId?{imageId:original.imageId}:{}),...(original?.readingOrder?{readingOrder:original.readingOrder}:{}),...(original?{derivedFromObservationIds:[original.id]}:{}),...(value!==undefined?{value}:{}),...(unit?{unit}:{})};
    observations.push(obs);
    if(!original){const key=obs.text.trim();parserObservationCounts.set(key,(parserObservationCounts.get(key)??0)+1);}
    return obs.id;
  };
  const sourceOcrObservationForId=(observationId:string|undefined):Observation|undefined=>{
    if(!observationId)return;
    const derived=observations.find(item=>item.id===observationId);
    const sourceIds=derived?.derivedFromObservationIds??[observationId];
    return (options.observations??[]).find(item=>sourceIds.includes(item.id)&&item.origin==='ocr'&&item.field==='ocr-line');
  };
  const servingMatch=text.match(/(?:serving\s+size|serve\s+size|portion\s+size)\s*[:\-]?\s*(?:[^\n\d]{0,20})?(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
  const serving=servingMatch?mass(servingMatch[1],servingMatch[2]):undefined;
  const weightMatch=text.match(/(?:net\s*(?:weight|wt\.?|quantity|qty\.?)|pack\s*size)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|ml|g|l)\b/i);
  const netWeight=weightMatch?mass(weightMatch[1],weightMatch[2]):undefined;
  const servingObservationId=servingMatch?observe('serving',servingMatch[0]):undefined;
  if(weightMatch) observe('netWeight',weightMatch[0]);
  const ingredients:string[]=[]; const allergens:string[]=[]; const claims:string[]=[];
  let ingredientsOpen=false; let basis:Basis|null=null; let columnBases:Basis[]=[]; let basisObservationIds:string[]=[]; let ambiguousBasis=false;
  const nutrients:Nutrient[]=[];
  const parserDiagnostics:ParserDiagnostic[]=[];
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
    const parserLine=line.replace(/([A-Z]{4,})(?=(?:Per|PER|Pour|POUR|Para|PARA)\s*:?\s*\d)/,'$1 ');
    const rawOcrRow=inputObservations.get(line.trim())?.[0];
    const matchedRow=matchNutrientRow(parserLine,rawOcrRow);
    const nutrientRow=matchedRow?.row;
    const basisText=/^(?:per|pour|para)\s*:?\s*$/i.test(parserLine)?`${parserLine} ${lines[lineIndex+1]??''}`:parserLine;
    const foundBases=basesIn(basisText,serving);
    const hasBasis=/\b(?:per|pour|para)\s*:?\s*(?:\d|serv|port)/i.test(basisText)||/\/\s*\d+\s*(?:g|ml)\b/i.test(basisText);
    if(!nutrientRow&&hasBasis){
      ingredientsOpen=false;
      ambiguousBasis=foundBases.length>1;
      columnBases=foundBases;
      basis=foundBases.length===1?foundBases[0]:null;
      const basisObservationId=observe('basis',line);
      basisObservationIds=[basisObservationId,...(foundBases.some(item=>item.description==='per declared serving')&&servingObservationId?[servingObservationId]:[])];
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
    if(matchedRow.recoveredPrefix)warnings.push(`${nutrientRow.key}: ignored a very low-confidence leading OCR token before the recognized row label; original text is retained.`);
    let tail=parserLine.slice(matchedRow.labelStart).replace(nutrientRow.pattern,'');
    tail=tail.replace(/(?:per|pour|para|\/)\s*:?\s*\d+(?:\.\d+)?\s*(?:g|ml)\b/gi,'').replace(/per\s+(?:serving|serve|portion)(?:\s*\(?\s*\d+(?:\.\d+)?\s*(?:g|ml)\)?)?/gi,'');
    // A single decimal comma followed by a unit is unambiguous. Thousands or
    // otherwise unlabeled comma sequences remain multiple values and withheld.
    tail=tail.replace(/\b0,(\d{1,6})(?=\s*(?:kcal|kj|mg|g)\b)/gi,'0.$1').replace(/(\d+),(\d{1,2})(?=\s*(?:kcal|kj|mg|g)\b)/gi,'$1.$2');
    // Percentage columns do not represent additional gram amounts.
    tail=tail.replace(/\d+(?:\.\d+)?\s*%/g,'');
    const values=[...tail.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(kcal|kj|mg|g)?\b/gi)];
    const rowUnit=tail.match(/\b(kcal|kj|mg|g)\b/i)?.[1];
    const orderedEnergyUnits=nutrientRow.key==='energy'?tail.match(/^\s*[:\-]?\s*\(\s*(kJ|kcal)\s*\/\s*(kJ|kcal)\s*\)/i):null;
    const obsId=observe(nutrientRow.key,line);
    const baseSourceObservationIds=[obsId,...(foundBases.length===0?basisObservationIds:[])];
    const numericCandidates=values.map((value,valueIndex)=>{
      const n=Number(value[1]);const unit=(value[2]??(orderedEnergyUnits&&values.length===2?orderedEnergyUnits[valueIndex+1]:rowUnit))?.toLowerCase()??null;
      return {rawValueText:value[1],value:Number.isFinite(n)?n:null,unit};
    });
    const basisCandidates=foundBases.length?foundBases:(columnBases.length?columnBases:(basis?[basis]:[]));
    const evidenceIds=(observationId:string)=>observations.find(item=>item.id===observationId)?.derivedFromObservationIds??[observationId];
    const numericEvidenceObservationIds=evidenceIds(obsId);
    const basisObservationIdCandidates=foundBases.length?[obsId]:basisObservationIds;
    const basisEvidenceObservationIds=Array.from(new Set(basisObservationIdCandidates.flatMap(evidenceIds)));
    const sourceObservationIds=Array.from(new Set([...baseSourceObservationIds,...numericEvidenceObservationIds,...basisEvidenceObservationIds]));
    const diagnose=(decision:ParserDiagnostic['decision'],reasonCodes:ParserDiagnostic['reasonCodes'])=>parserDiagnostics.push({field:nutrientRow.key,decision,reasonCodes:Array.from(new Set<ParserDiagnostic['reasonCodes'][number]>(reasonCodes)),sourceObservationIds,numericEvidenceObservationIds,basisEvidenceObservationIds,numericCandidates,basisCandidates});
    if(/[<>≤≥~]|\b(?:trace|less than|approx)/i.test(tail)){warnings.push(`${nutrientRow.key}: bounded or approximate value retained in text; exact calculation withheld.`);diagnose('rejected',['approximate-or-bounded']);continue;}
    if(/-\s+\d/.test(tail)){warnings.push(`${nutrientRow.key}: invalid or ambiguous signed value withheld.`);diagnose('rejected',['signed-or-ambiguous']);continue;}
    if(!values.length){warnings.push(`${nutrientRow.key}: no readable numerical value.`);diagnose('rejected',['no-numeric-value']);continue;}
    const geometryBasisId=foundBases.length?obsId:basisObservationIds[0];
    const rowSourceObservation=sourceOcrObservationForId(obsId);
    const basisSourceObservation=sourceOcrObservationForId(geometryBasisId);
    const mappedBasisIndexes=values.length>1?geometryValueBasisIndexes(numericCandidates,rowSourceObservation,basisSourceObservation,basisCandidates,options.ocrCaptures??[]):undefined;
    const mappedValueIndex=values.length>1&&basisCandidates.length===1?geometrySelectedValueIndex(numericCandidates,rowSourceObservation,basisSourceObservation,basisCandidates[0],options.ocrCaptures??[]):undefined;
    const mappedEveryColumn=mappedBasisIndexes!==undefined&&mappedBasisIndexes.length===values.length;
    const conflicting=(ambiguousBasis||foundBases.length>1)&&!mappedEveryColumn||(values.length>1&&mappedValueIndex===undefined&&!mappedEveryColumn);
    if(mappedEveryColumn)warnings.push(`${nutrientRow.key}: each recognized value aligns with a separate printed nutrition column; values retain their matched bases.`);
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
  if(nameResult.withheld)warnings.push('Product name was not established from readable label text; enter a name or check a verified product identifier.');
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
