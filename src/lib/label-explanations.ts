/** Source-linked reading help; this does not verify a package or current law. */
const nutritionUrl='https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label';
const claimsUrl='https://www.fssai.gov.in/upload/uploadfiles/files/FAQs_Advertising_Claims_25_08_2020.pdf';
const definitions:Record<string,string>={
 carbohydrate:'Total carbohydrate includes sugars, starches and dietary fibre. Compare the amount with the printed serving basis.',
 protein:'Protein is a nutrient shown for the printed basis; the amount eaten depends on the portion.',
 fat:'Total fat is the amount of fat declared for the printed basis. Its fat types are separate readings.',
 saturatedFat:'Saturated fat is one type of fat; use the declared basis when comparing portions.',
 sodium:'Sodium is a component of salt and is often expressed in milligrams. The amount applies to the printed basis.',
 salt:'Salt and sodium are related but are not the same quantity. Check which one and which unit the panel declares.',
 sugars:'Total sugars can include naturally occurring and added sugars. A less-than sign is a limit, not an exact amount.',
 addedSugars:'Added sugars are distinct from total sugars. A zero reading does not mean the food contains no carbohydrate.',
 fiber:'Dietary fibre is a type of carbohydrate; its printed amount applies to the stated basis.',
 energy:'Energy is commonly stated in kcal or kJ. Keep the unit and printed portion together.',
};
export function nutrientExplanation(key:string|null|undefined){const text=key?definitions[key]:undefined;return text?{text,url:nutritionUrl,source:'FDA · Understanding the nutrition label'}:null;}
export function statementExplanation(kind:string,text:string){
 const value=text.toLocaleLowerCase('en-IN');
 if(kind==='may-contain'||kind==='precaution')return {text:'This is precautionary wording. It is distinct from a declared ingredient and does not establish whether cross-contact occurred.',url:'https://www.fda.gov/consumers/consumer-updates/have-food-allergies-read-label',source:'FDA · Reading allergen labels'};
 if(kind==='contains'&&/oligofructose|inulin/.test(value))return {text:'This is a declaration about an ingredient or component and its printed amount, not by itself a warning. Check the stated basis; it does not establish an individual effect.',url:'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-declaration-certain-isolated-or-synthetic-non-digestible-carbohydrates-dietary',source:'FDA · Dietary fibre guidance'};
 if(kind==='claim'&&/no added sugars?|sugar[ -]?free/.test(value))return {text:'Sugar-free and no-added-sugar are different claims. Neither means carbohydrate-free. The printed claim alone does not establish regulatory compliance.',url:claimsUrl,source:'FSSAI · Advertising and claims FAQ (2020)'};
 return null;
}
