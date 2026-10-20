import { packageSchema, type Nutrient, type NutrientKey, type Observation, type PackageData } from './contracts';
import { detectAdditives } from './knowledge';

type ParseOptions = {side?:Observation['side'];origin?:Observation['origin'];confidence?:number|null;observations?:Observation[];synthetic?:boolean};
type Basis = NonNullable<Nutrient['basis']>;
const rows: {key:NutrientKey;pattern:RegExp}[] = [
  {key:'addedSugars',pattern:/^(?:(?:includes?|of which)\s+)?added\s+sugars?\b/i},
  {key:'saturatedFat',pattern:/^(?:(?:total|of which)\s+)?saturat(?:ed|es)\s*(?:fat)?\b|^(?:dont\s+acides gras satur[ée]s|waarvan\s+verzadigd(?:e|e vetzuren)?|de las cuales saturadas)\b/i},
  {key:'energy',pattern:/^(?:total\s+)?(?:energy|calories)\b|^(?:[ée]nergie|energ[ií]a|valor energ[ée]tico)\b/i},
  {key:'carbohydrate',pattern:/^(?:total\s+|available\s+)?carbohydrates?\b|^(?:glucides|koolhydraten|hidratos de carbono)\b/i},
  {key:'sugars',pattern:/^(?:(?:total|of which)\s+)?sugars?\b|^(?:dont sucres|waarvan suikers|de los cuales az[úu]cares)\b/i},
  {key:'protein',pattern:/^proteins?\b|^(?:prot[ée]ines?|prote[ií]nas?|eiwitten)\b/i}, {key:'fat',pattern:/^(?:total\s+)?fat\b|^(?:mati[èe]res grasses|vetten|grasas)\b/i},
  {key:'fiber',pattern:/^(?:dietary\s+)?fib(?:er|re)\b/i},
  {key:'sodium',pattern:/^(?:sodium|sodio)\b/i}, {key:'salt',pattern:/^(?:salt|sel|zout|sal)\b/i},
];
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
const labelName = (lines:string[]) => (lines.find(line=>line.length>=3&&!rows.some(row=>row.pattern.test(line))&&!/^(?:nutrition|nutritional|valeurs nutrition|per\b|pour\b|para\b|ingredients?|contains|allergen|net\b|serving\b|fssai\b|licen[cs]e|barcode|total\b|synthetic)/i.test(line)) ?? 'Unidentified package').slice(0,200);

/** A conservative text parser: an OCR reading remains an observation. */
export function parseLabel(text:string,options:ParseOptions={}):PackageData {
  if(typeof text!=='string'||text.length>40000) throw new Error('Label text must be at most 40,000 characters.');
  if(options.confidence!==undefined&&options.confidence!==null&&(!Number.isFinite(options.confidence)||options.confidence<0||options.confidence>100)) throw new Error('Confidence must be 0–100.');
  const lines=text.replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  const id=crypto.randomUUID();
  const observations:Observation[]=(options.observations??[]).map(o=>({...o}));
  const warnings:string[]=[];
  const observe=(field:string,line:string,value?:number,unit?:string)=> {
    const original=(options.observations??[]).find(o=>o.text.trim()===line);
    const obs:Observation={id:`${id}-o${observations.length}`,field,text:line,side:original?.side??options.side??'text',origin:original?.origin??options.origin??'user',confidence:original?.confidence??options.confidence??null,...(original?.bbox?{bbox:original.bbox}:{}),...(value!==undefined?{value}:{}),...(unit?{unit}:{})};
    observations.push(obs); return obs.id;
  };
  const servingMatch=text.match(/(?:serving\s+size|serve\s+size|portion\s+size)\s*[:\-]?\s*(?:[^\n\d]{0,20})?(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
  const serving=servingMatch?mass(servingMatch[1],servingMatch[2]):undefined;
  const weightMatch=text.match(/(?:net\s*(?:weight|wt\.?|quantity|qty\.?)|pack\s*size)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|ml|g|l)\b/i);
  const netWeight=weightMatch?mass(weightMatch[1],weightMatch[2]):undefined;
  if(servingMatch) observe('serving',servingMatch[0]);
  if(weightMatch) observe('netWeight',weightMatch[0]);
  const ingredients:string[]=[]; const allergens:string[]=[]; const claims:string[]=[];
  let ingredientsOpen=false; let basis:Basis|null=null; let ambiguousBasis=false;
  const nutrients:Nutrient[]=[];
  for(let lineIndex=0;lineIndex<lines.length;lineIndex++) {
    const line=lines[lineIndex];
    const ingredientLine=line.match(/^ingredients?\s*[:：]\s*(.*)/i);
    if(ingredientLine){ingredientsOpen=true;ingredients.push(ingredientLine[1]);observe('ingredients',line);continue;}
    if(/^(?:contains|may contain|allergen)/i.test(line)){ingredientsOpen=false;allergens.push(line);observe('allergens',line);continue;}
    if(/\b(?:sugar[ -]free|no added sugar|high protein|organic|ORS|oral rehydration)\b/i.test(line)){claims.push(line);observe('claim',line);}
    const nutrientRow=rows.find(row=>row.pattern.test(line));
    const basisText=/^(?:per|pour|para)\s*:?\s*$/i.test(line)?`${line} ${lines[lineIndex+1]??''}`:line;
    const foundBases=basesIn(basisText,serving);
    const hasBasis=/\b(?:per|pour|para)\s*:?\s*(?:\d|serv|port)/i.test(basisText)||/\/\s*\d+\s*(?:g|ml)\b/i.test(basisText);
    if(!nutrientRow&&hasBasis){
      ingredientsOpen=false;
      ambiguousBasis=foundBases.length>1;
      basis=foundBases.length===1?foundBases[0]:null;
      observe('basis',line);
      if(ambiguousBasis) warnings.push('Multiple nutrition columns detected. Their values and bases need visual confirmation before scaling.');
      else if(!basis) warnings.push('Serving basis is stated but its mass or volume is missing.');
      continue;
    }
    if(!nutrientRow){
      if(/^(?:nutrition|nutritional|serving|net|storage|manufactur|best before|fssai|licen[cs]e|barcode)/i.test(line)) ingredientsOpen=false;
      if(ingredientsOpen){ingredients.push(line);observe('ingredients',line);}
      continue;
    }
    ingredientsOpen=false;
    let tail=line.replace(nutrientRow.pattern,'');
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
    if(/[<>≤≥~]|\b(?:trace|less than|approx)/i.test(tail)){warnings.push(`${nutrientRow.key}: bounded or approximate value retained in text; exact calculation withheld.`);continue;}
    if(/-\s+\d/.test(tail)){warnings.push(`${nutrientRow.key}: invalid or ambiguous signed value withheld.`);continue;}
    if(!values.length){warnings.push(`${nutrientRow.key}: no readable numerical value.`);continue;}
    const conflicting=ambiguousBasis||values.length>1||foundBases.length>1;
    if(values.length>1) warnings.push(`${nutrientRow.key}: multiple numeric values retained; confirm the intended column.`);
    for(const [valueIndex,value] of values.entries()){
      const n=Number(value[1]); const unit=(value[2]??(orderedEnergyUnits&&values.length===2?orderedEnergyUnits[valueIndex+1]:rowUnit))?.toLowerCase();
      if(!Number.isFinite(n)||n<0||n>100000){warnings.push(`${nutrientRow.key}: invalid value withheld.`);continue;}
      if(!unit){warnings.push(`${nutrientRow.key}: unit missing; no unit was guessed.`);continue;}
      const validUnit=unit==='kj'?'kJ':unit as Nutrient['unit'];
      if((nutrientRow.key==='energy'&&!['kcal','kJ'].includes(validUnit))||(nutrientRow.key!=='energy'&&!['g','mg'].includes(validUnit))){warnings.push(`${nutrientRow.key}: incompatible unit withheld.`);continue;}
      nutrients.push({key:nutrientRow.key,value:n,unit:validUnit,basis:conflicting?null:(foundBases[0]??basis),observationIds:[obsId],status:conflicting?'conflict':'observed'});
    }
  }
  // Preserve duplicate readings. Mark disagreement on the same explicit basis.
  for(const nutrient of nutrients){
    const normalized=nutrient.value*(nutrient.unit==='mg'?.001:nutrient.unit==='kJ'?1/4.184:1);
    const conflict=nutrients.some(other=>other!==nutrient&&other.key===nutrient.key&&other.basis?.amount===nutrient.basis?.amount&&other.basis?.unit===nutrient.basis?.unit&&Math.abs(other.value*(other.unit==='mg'?.001:other.unit==='kJ'?1/4.184:1)-normalized)>Math.max(.000001,normalized*.01));
    if(conflict){nutrient.status='conflict';warnings.push(`${nutrient.key}: conflicting readings retained; calculation withheld.`);}
    if(!nutrient.basis) warnings.push(`${nutrient.key}: an unambiguous mass or volume basis is required.`);
  }
  const additiveCodes=detectAdditives(text);
  for(const code of additiveCodes){const line=lines.find(l=>detectAdditives(`Ingredients: ${l}`).includes(code));observe(`additive:${code}`,line??code);}
  const name=labelName(lines);observe('name',name);
  const brand=text.match(/^brand\s*[:：]\s*([^\n]{1,120})/im)?.[1];
  const barcode=text.match(/(?:barcode|ean|upc)\s*[:\-]?\s*(\d{8,14})\b/i)?.[1];
  const license=text.match(/(?:fssai|licen[cs]e)(?:\s*(?:licen[cs]e|no\.?|number))?\s*[:\-]?\s*(\d{14})\b/i)?.[1];
  if(barcode)observe('barcode',barcode); if(license)observe('license',license);
  if(!nutrients.length)warnings.push('No usable nutrition values were extracted. Missing values are unknown, not zero.');
  if(brand)observe('brand',brand);
  return packageSchema.parse({id,name,...(brand?{brand}:{}),...(barcode?{barcode}:{}),...(license?{license}:{}),...(serving?{serving}:{}),...(netWeight?{netWeight}:{}),ingredients,additives:additiveCodes,allergens,claims,nutrients,observations,rawText:text,warnings:[...new Set(warnings)],synthetic:options.synthetic??options.origin==='fixture',createdAt:new Date().toISOString()});
}
