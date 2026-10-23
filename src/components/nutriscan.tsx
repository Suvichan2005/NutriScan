'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, Camera, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Download, FileText, FlaskConical, History, ImagePlus, Leaf, LoaderCircle, LockKeyhole, MessageCircle, Plus, ScanLine, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { buildAudit } from '@/lib/engine';
import { observeAsyncRead } from '@/lib/async-read-deadline';
import { reconcileInterpretedNutrition } from '@/lib/interpreted-nutrients';
import { assistEvidenceContext, packageForAssist } from '@/lib/assist-evidence';
import { parseLabel } from '@/lib/parser';
import { defaultPortion, resolveQuestionPortion } from '@/lib/portion';
import { productEvidenceSource } from '@/lib/product-evidence';
import { buildProductLookupRequest, defaultProductLookup, productQuerySource } from '@/lib/product-query';
import { appendVisionEvidence } from '@/lib/reconcile';
import { mergePackageEvidence, mergeSecondaryOcrEvidence } from '@/lib/merge-evidence';
import { readPaddleOcrImages, selectPaddleFallbackAssets, shouldRunPaddleFallback } from '@/modules/ocr';
import { conversationContextForAssist, resolveLocalFollowUpQuestion } from '@/lib/conversation-context';
import { buildLocalAuditConversationReply, buildLocalEvidenceFollowUp, buildLocalEvidenceUnavailableFollowUp, parseLocalEvidenceResponse, safeConversationEvidence, shouldSearchLocalEvidence } from '@/lib/followup-evidence';
import { requestLocalEvidence } from '@/lib/local-evidence-client';
import { presentConversationAnswer } from '@/lib/conversation-answer';
import { packageDisplayIdentity, savedConversationTurns, type ThreadMessage } from '@/lib/thread-presentation';
import { applyBarcodeReadings } from '@/lib/barcode';
import { ThreadPublicProductRecord } from './thread-public-product-record';
import { ThreadPackageLabelDetails } from './thread-package-label-details';
import { ThreadGenerativeUI } from './thread-generative-ui';
import { isLowSignalPackageOcrLine } from '@/lib/package-label-evidence';
import { clonePhotoEditState, photoHasEdits, PackagePhotoCard, pristinePhotoEditState, renderPhotoEdit, type PhotoEditState, type PhotoReviewAsset } from './package-photo-card';
import { applyNutrientCorrection, type NutrientCorrection } from '@/lib/correction';
import { assistantUiComponentSchema, calculationEvidenceText, conversationEvidenceSourceSchema, defaultProfile, hasUserContext, nutrientKeys, packageSchema, tentativeStructuredCandidateSchema, type AssistantUiComponent, type Audit, type EvidenceSource, type ImageAsset, type NutrientKey, type Observation, type PackageData, type ProductRecord, type Profile, type ResearchItem, type TentativeStructuredCandidate } from '@/lib/contracts';
import { lookupAdditive } from '@/lib/knowledge';
import { clearHistory, completeOnboardingSession, deleteRememberedProfile, deleteSessionProfile, downloadJson, hasCompletedOnboardingSession, imageBase64, loadImage, prepareImage, readHistory, readImages, readRememberedProfile, readSessionProfile, removeSavedScan, saveRememberedProfile, saveScan, saveSessionProfile, type SavedScan } from '@/lib/browser';

type Panel='onboarding'|'profile'|'privacy'|'history'|'text'|'correct'|'ocr-region'|'camera'|'scanner'|null;
type Message=ThreadMessage;
type Status={gemini?:{enabled?:boolean;configured?:boolean;model?:string;tier?:'free'|'paid'|null;searchEnabled?:boolean};[key:string]:unknown};
type OcrRegionPreview={url:string;width:number;height:number;bbox:NonNullable<Observation['bbox']>;text:string;confidence:number|null};
type GeminiRunContext={packageData?:PackageData;question?:string;auditData?:Audit|null;imageAssets?:ImageAsset[];messages?:Message[];replaceTurnAt?:string;portion?:number;unit?:'g'|'ml';interpretedCandidates?:TentativeStructuredCandidate[]};
const nutrientLabel:Record<NutrientKey,string>={energy:'Energy',carbohydrate:'Carbohydrate',sugars:'Total sugars',addedSugars:'Added sugars',protein:'Protein',fat:'Total fat',saturatedFat:'Saturated fat',fiber:'Fibre',sodium:'Sodium',salt:'Salt'};
const defaultLookup=defaultProductLookup;
const hasProfile=hasUserContext;
const onboardingGoalOptions=[
 {id:'nutrition',label:'Understand nutrition and portions',value:'Understand nutrition and portions on packaged foods.'},
 {id:'ingredients',label:'Check ingredients and allergens',value:'Check ingredients, allergens and dietary preferences on package labels.'},
 {id:'compare',label:'Compare packaged foods',value:'Compare relevant package information across food products.'},
 {id:'claims',label:'Understand a food claim',value:'Understand food-package claims and the evidence behind them.'},
 {id:'custom',label:'Set my own focus',value:''},
];
const exampleText=`NUTRISCAN EXAMPLE CRACKERS\nSynthetic test label, not a real product\nNet weight: 150 g\nServing size: 30 g\nNutrition information per 100 g\nEnergy 420 kcal\nCarbohydrate 65 g\nTotal sugars 2 g\nAdded sugars 0 g\nProtein 10 g\nTotal fat 15 g\nSaturated fat 3 g\nFibre 6 g\nSodium 850 mg\nIngredients: Whole wheat flour, vegetable oil, salt, sweetener (INS 955).\nContains: Wheat (gluten). May contain milk.\nSugar free`;

function ConversationEvidence({sources}:{sources?:Message['evidence']}){
 const safe=safeConversationEvidence(sources);
 if(!safe.length)return null;
 const card=(source:typeof safe[number])=><article key={source.id}><span className="eyebrow">SOURCE CHECKED BY NUTRISCAN · REVIEW SCOPE</span><h3><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></h3><p>{source.summary}</p><small>{source.publisher} · {source.jurisdiction} · Published {source.publishedAt??'not established'} · Retrieved {new Date(source.retrievedAt).toLocaleDateString('en-IN')}</small><p className="fine-print">{source.limitations}</p></article>;
 return <details className="conversation-evidence" aria-label="Sources for this answer"><summary><span>Evidence · {safe[0].title}{safe.length>1?` + ${safe.length-1} more`:''}</span><ChevronDown size={14}/></summary><div className="conversation-evidence-content">{card(safe[0])}{safe.length>1&&<div className="research-results">{safe.slice(1).map(card)}</div>}</div></details>;
}

function GeminiPackageInterpretation({candidates,nutrition,audit}:{candidates:TentativeStructuredCandidate[];nutrition:ReturnType<typeof reconcileInterpretedNutrition>;audit:Audit|null}){
 if(!candidates.length)return null;
 const readingIds=new Set(nutrition.readings.flatMap(reading=>reading.candidateIds));
 const usedIds=new Set((audit?.calculations??[]).flatMap(calculation=>calculation.interpretationIds??[]));
 return <section className="thread-ui-card thread-gemini-readings" aria-label="Gemini package readings" data-testid="gemini-package-readings">
  <div className="thread-ui-heading"><span className="eyebrow">PACKAGE READINGS · UNVERIFIED</span><span className="badge neutral">{candidates.length} candidate{candidates.length===1?'':'s'}</span></div>
  <p className="thread-ui-caveat">Gemini’s possible label readings remain unverified. A complete reading linked to the exact printed value, unit and basis in OCR words or an attached photo region can support clearly labeled arithmetic.</p>
  <ul className="thread-gemini-reading-list">{candidates.map(candidate=>{
   const used=usedIds.has(candidate.candidateId);
   const linked=readingIds.has(candidate.candidateId);
   const reason=nutrition.withheld.find(item=>item.candidateId===candidate.candidateId)?.reason;
   const value=candidate.numericValue===null?candidate.proposedValue:[candidate.numericValue,candidate.unit].filter(Boolean).join(' ');
   const source=candidate.visualEvidence?.length?'photo-linked':'OCR-linked';
   const status=used?`Used for labeled arithmetic · ${source} · unverified`:linked?`${source} · not used for this amount`:'Not used in calculations';
   return <li key={candidate.candidateId}>
    <div className="thread-gemini-reading-main"><strong>{candidate.field}</strong><span>{value}{candidate.basis?` · per ${candidate.basis.amount} ${candidate.basis.unit}`:candidate.kind==='nutrient'?' · basis unresolved':''}</span><small>{candidate.kind} · {status}</small></div>
    <details><summary>Evidence and uncertainty</summary><p>{reason??candidate.uncertainty}{used?' This arithmetic estimate still depends on an unverified model interpretation.':''}</p>{candidate.normalizedEntity&&candidate.normalizedEntity!==candidate.field&&<p>Possible normalization: {candidate.normalizedEntity}</p>}{candidate.supportingSpans.map((span,index)=><p key={'text-'+span.kind+'-'+span.id+'-'+index}><small>{span.kind} evidence</small><br/><q>{span.quote}</q></p>)}{(candidate.visualEvidence??[]).map((evidence,index)=><p key={'image-'+evidence.imageId+'-'+index}><small>Gemini-reported photo text · unverified{evidence.region?` · region ${Math.round(evidence.region.x*100)}%, ${Math.round(evidence.region.y*100)}%, ${Math.round(evidence.region.width*100)}% × ${Math.round(evidence.region.height*100)}%`:''}</small><br/><q>{evidence.visibleText}</q></p>)}</details>
   </li>;
  })}</ul>
 </section>;
}
function selectGeminiImageAssets(images:ImageAsset[],pkg:PackageData){
 const ranked=images.map((image,index)=>{
  const lines=pkg.observations.filter(observation=>observation.origin==='ocr'&&observation.imageId===image.id&&observation.field==='ocr-line');
  const text=lines.map(line=>line.text.toLowerCase()).join(' ');
  const roleScore=image.role==='nutrition'||image.role==='ingredients'?8:image.role==='front'?4:0;
  const contentScore=(/nutrition|energy|carbohyd|protein|sodium|fat|sugar/.test(text)?6:0)+(/ingredient|contains|allergen|may contain/.test(text)?6:0);
  return {image,index,score:Math.min(lines.length,20)+roleScore+contentScore};
 });
 return ranked.sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3).map(item=>item.image);
}

async function compactGeminiImage(source:Blob){
 const bitmap=await createImageBitmap(source);
 try{
  for(const edge of [2000,1700,1400]){
   const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not prepare this image for Gemini.');
   context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [0.86,0.76,0.66]){
    const compressed=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image compression failed.')),'image/jpeg',quality));
    if(compressed.size<=900_000)return compressed;
   }
  }
 }finally{bitmap.close();}
 throw new Error('A selected photo could not be reduced to the safe size limit. Remove it or use a smaller image.');
}

export default function NutriScan(){
 const [images,setImages]=useState<PhotoReviewAsset[]>([]);
  const scannerSnapshot=useRef<PhotoReviewAsset[]>([]);
  const retiredPhotos=useRef<PhotoReviewAsset[]>([]);
  const [scannerActiveImageId,setScannerActiveImageId]=useState('');
 const [visionImageId,setVisionImageId]=useState('');
 const [pkg,setPkg]=useState<PackageData|null>(null);
 const [rawText,setRawText]=useState('');
 const [productDescription,setProductDescription]=useState('');
 const [profile,setProfile]=useState<Profile>(defaultProfile);
 const [rememberProfile,setRememberProfile]=useState(false);const [profileReady,setProfileReady]=useState(false);const [profileSaving,setProfileSaving]=useState(false);
 const [onboardingGoalChoice,setOnboardingGoalChoice]=useState('');const [onboardingCustomGoal,setOnboardingCustomGoal]=useState('');const onboardingGateChecked=useRef(false);
 const profileTouched=useRef(false);const profileReadSettled=useRef(false);const rememberedProfileAvailable=useRef(false);
 const [portion,setPortion]=useState(100);const [unit,setUnit]=useState<'g'|'ml'>('g');
 const [question,setQuestion]=useState('');const [activeQuestion,setActiveQuestion]=useState('');const [auditQuestion,setAuditQuestion]=useState('');
 const [messages,setMessages]=useState<Message[]>([]);
 const [localEvidenceBusy,setLocalEvidenceBusy]=useState(false);const pendingLocalEvidenceRequests=useRef(new Set<symbol>());
 const [busy,setBusy]=useState(false);const [photoEditBusy,setPhotoEditBusy]=useState(false);const [progress,setProgress]=useState({label:'',value:0});
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [panel,setPanel]=useState<Panel>(null);const dialog=useRef<HTMLDialogElement>(null);const [ocrRegion,setOcrRegion]=useState<OcrRegionPreview|null>(null);const [ocrRegionBusy,setOcrRegionBusy]=useState('');const [showAllOcrObservations,setShowAllOcrObservations]=useState(false);
 const [contrast,setContrast]=useState(false);const [invert,setInvert]=useState(false);const [cropEnabled,setCropEnabled]=useState(false);const [cropTarget,setCropTarget]=useState('');const [crop,setCrop]=useState({x:0,y:0,width:100,height:100});
 const cropDrag=useRef<{x:number;y:number}|null>(null);
 const [history,setHistory]=useState<SavedScan[]>([]);const [remember,setRemember]=useState(false);const [rememberConversation,setRememberConversation]=useState(false);
 const cropImage=images.find(image=>image.id===cropTarget);
 const [status,setStatus]=useState<Status>({});const geminiTierDisclosure=status.gemini?.tier==='free'?'This free-tier request has no generation charge, but Google may use submitted content to improve its products.':status.gemini?.tier==='paid'?'Paid-tier API charges may apply; Google’s data-handling terms apply.':'';const abort=useRef<AbortController|null>(null);const epoch=useRef(0);
 const geminiRequest=useRef<{controller:AbortController;intentional:boolean}|null>(null);
 const cameraVideo=useRef<HTMLVideoElement|null>(null);const cameraStream=useRef<MediaStream|null>(null);const [cameraError,setCameraError]=useState('');
 const processedImages=useRef(new Map<string,string>());
 const [remoteBusy,setRemoteBusy]=useState('');const [remoteNotice,setRemoteNotice]=useState('');const [productLookupNotice,setProductLookupNotice]=useState('');
 const [products,setProducts]=useState<ProductRecord[]>([]);const [selectedProduct,setSelectedProduct]=useState<ProductRecord|null>(null);
 const [research,setResearch]=useState<ResearchItem[]>([]);const [lookup,setLookup]=useState('');
 const [topic,setTopic]=useState('science');const [cloudMode,setCloudMode]=useState(true);const [includeProfileWithGemini,setIncludeProfileWithGemini]=useState(false);
  const [remoteCandidates,setRemoteCandidates]=useState<TentativeStructuredCandidate[]>([]);const displayIdentity=useMemo(()=>pkg?packageDisplayIdentity(pkg,remoteCandidates):null,[pkg,remoteCandidates]);const [correction,setCorrection]=useState({name:'',key:'sodium' as NutrientKey,value:'',unit:'mg',basis:'',basisUnit:'' as ''|'g'|'ml'});
 const threadScrollRef=useRef<HTMLDivElement|null>(null);
  const emptyAdvancedRef=useRef<HTMLDetailsElement|null>(null);
 const profilePersistenceQueue=useRef<Promise<void>>(Promise.resolve());
 function queueProfilePersistence(remember:boolean,value:Profile):Promise<void>{
  const next=profilePersistenceQueue.current.catch(()=>{}).then(async()=>{
   if(remember){await saveRememberedProfile(value);deleteSessionProfile();}
   else{await deleteRememberedProfile();saveSessionProfile(value);}
  });
  profilePersistenceQueue.current=next.catch(()=>{setNotice('Could not update remembered context in this browser. Your current session still works.');});
  return next;
 }
 async function chooseRememberedProfile(remember:boolean){
  if(!profileReady||profileSaving)return;
  profileTouched.current=true;
  const previous=rememberProfile;setRememberProfile(remember);
  setProfileSaving(true);
  try{await queueProfilePersistence(remember,profile);rememberedProfileAvailable.current=remember&&hasProfile(profile);setNotice(remember?'Your context is saved separately on this device.':'The remembered copy was removed. Your context remains in this session.');}
  catch{setRememberProfile(previous);setNotice('Could not update remembered context in this browser. Your current session still works.');}
  finally{setProfileSaving(false);}
 }
 function clearProfileContext(){
  profileTouched.current=true;setProfile(defaultProfile);setRememberProfile(false);rememberedProfileAvailable.current=false;
  if(profileReady)void queueProfilePersistence(false,defaultProfile).then(()=>setNotice('Current and remembered context cleared from this browser.')).catch(()=>{});
 }
 async function finishOnboarding(){
  const selected=onboardingGoalOptions.find(option=>option.id===onboardingGoalChoice);
  const goal=onboardingGoalChoice==='custom'?onboardingCustomGoal.trim():selected?.value??'';
  if(!goal){setNotice('Choose a focus or write your own before continuing.');return;}
  profileTouched.current=true;const nextProfile={...profile,goals:goal};setProfile(nextProfile);setProfileSaving(true);
  let saveFailed=false;const remember=rememberProfile;
  try{
   if(remember){await queueProfilePersistence(true,nextProfile);rememberedProfileAvailable.current=hasProfile(nextProfile);}
   else{saveSessionProfile(nextProfile);if(profileReadSettled.current&&rememberedProfileAvailable.current){await deleteRememberedProfile();rememberedProfileAvailable.current=false;}}
  }catch{saveFailed=true;setRememberProfile(false);}
  try{completeOnboardingSession();}catch{saveFailed=true;}
   onboardingGateChecked.current=true;setPanel(null);setProfileSaving(false);
   setNotice(saveFailed?'Your goal is active for this visit, but NutriScan could not save the session context in this browser.':'');
 }
 function cropPoint(event:ReactPointerEvent<HTMLDivElement>){const bounds=event.currentTarget.getBoundingClientRect();return{x:Math.round(Math.min(100,Math.max(0,(event.clientX-bounds.left)/bounds.width*100))),y:Math.round(Math.min(100,Math.max(0,(event.clientY-bounds.top)/bounds.height*100)))};}
 function updateCropFromPointer(event:ReactPointerEvent<HTMLDivElement>){const start=cropDrag.current;if(!start)return;const point=cropPoint(event);const x=Math.min(start.x,point.x),y=Math.min(start.y,point.y);setCrop({x:Math.min(99,x),y:Math.min(99,y),width:Math.max(1,Math.min(100-x,Math.abs(point.x-start.x))),height:Math.max(1,Math.min(100-y,Math.abs(point.y-start.y)))});}
 function startCropPointer(event:ReactPointerEvent<HTMLDivElement>){if(!cropTarget)return;event.preventDefault();const point=cropPoint(event);cropDrag.current=point;setCrop({x:Math.min(point.x,99),y:Math.min(point.y,99),width:1,height:1});event.currentTarget.setPointerCapture(event.pointerId);}
 function endCropPointer(event:ReactPointerEvent<HTMLDivElement>){if(!cropDrag.current)return;updateCropFromPointer(event);cropDrag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 const [inspection,setInspection]=useState<{handle:string;reason:string;crop?:{x:number;y:number;width:number;height:number}}|null>(null);
 const [semantic,setSemantic]=useState<(EvidenceSource&{score:number})[]>([]);
 const inspectorRef=useRef<HTMLDetailsElement>(null);const sourceRef=useRef<HTMLDetailsElement>(null);const lookupInputRef=useRef<HTMLInputElement>(null);
 const attachedImageIds=images.map(image=>image.id);
 const interpretedNutrition=useMemo(()=>pkg?reconcileInterpretedNutrition(pkg,remoteCandidates,attachedImageIds):{readings:[],withheld:[]},[pkg,remoteCandidates,images]);
 const audit:Audit|null=useMemo(()=>pkg?buildAudit(pkg,portion,unit,profile,auditQuestion||activeQuestion,remoteCandidates,attachedImageIds):null,[pkg,portion,unit,profile,auditQuestion,activeQuestion,remoteCandidates,images]);
 const selectedProductSource=useMemo(()=>selectedProduct?productEvidenceSource(selectedProduct):null,[selectedProduct]);
 const threadSources=useMemo(()=>{
  const unique=new Map<string,EvidenceSource>();
  for(const source of [...(audit?.sources??[]),...(selectedProductSource?[selectedProductSource]:[]),...messages.flatMap(turn=>turn.evidence??[])])if(source.url.startsWith('https://')&&!unique.has(source.id))unique.set(source.id,source);
  return [...unique.values()].slice(0,30);
 },[audit,selectedProductSource,messages]);
 const readSignature=(image:PhotoReviewAsset)=>JSON.stringify([image.editVersion??0,image.width,image.height,image.blob.size,image.editState??null,image.side,contrast,invert,cropEnabled&&cropTarget===image.id?crop:null]);
 const pendingPhotoCount=images.filter(image=>processedImages.current.get(image.id)!==readSignature(image)).length;

 useEffect(()=>{
  let active=true;
  const loadingNotice='Saved context is taking longer than usual. You can continue in this tab; the saved copy will not be changed unless you choose to save or clear it.';
  const stopProfileRead=observeAsyncRead(readRememberedProfile,2500,{
   onTimeout:()=>{
    if(!profileTouched.current){const sessionProfile=readSessionProfile();if(sessionProfile)setProfile(sessionProfile);}
    setProfileReady(true);setNotice(loadingNotice);
   },
   onValue:value=>{
    profileReadSettled.current=true;rememberedProfileAvailable.current=!!value;
    if(!profileTouched.current){
     if(value){setProfile(value);setRememberProfile(true);if(value.goals.trim()){try{completeOnboardingSession();}catch{}onboardingGateChecked.current=true;setPanel(null);}}
     else{const sessionProfile=readSessionProfile();if(sessionProfile)setProfile(sessionProfile);}
    }
    setNotice(current=>current===loadingNotice?'':current);setProfileReady(true);
   },
   onError:()=>{
    profileReadSettled.current=true;
    if(!profileTouched.current)setNotice('Remembered context could not be loaded. You can continue with an empty session profile.');
    else setNotice(current=>current===loadingNotice?'':current);
    setProfileReady(true);
   },
  });
  fetch('/api/status').then(x=>x.json()).then(value=>{if(active)setStatus(value);}).catch(()=>{});
  readHistory().then(value=>{if(active)setHistory(value);}).catch(()=>{});
  return()=>{active=false;stopProfileRead();abort.current?.abort();if(geminiRequest.current){geminiRequest.current.intentional=true;geminiRequest.current.controller.abort();}};
 },[]);
 useEffect(()=>{if(!profileReady||profileSaving)return;if(rememberProfile){const timer=window.setTimeout(()=>{void queueProfilePersistence(true,profile).catch(()=>{});},250);return()=>window.clearTimeout(timer);}if(hasCompletedOnboardingSession()){try{saveSessionProfile(profile);}catch{setNotice('Session context could not be updated in this browser.');}}},[profile,profileReady,profileSaving,rememberProfile]);
 useEffect(()=>{const thread=threadScrollRef.current;if(!thread)return;const latest=thread.querySelector<HTMLElement>('.thread-turn:last-of-type');if(!latest)return;const targetTop=thread.scrollTop+latest.getBoundingClientRect().top-thread.getBoundingClientRect().top-8;thread.scrollTo({top:Math.max(0,targetTop),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[messages,remoteCandidates]);
 useEffect(()=>{if(!profileReady||onboardingGateChecked.current)return;onboardingGateChecked.current=true;if(hasCompletedOnboardingSession()||profile.goals.trim()){if(profile.goals.trim()){try{completeOnboardingSession();}catch{}}return;}setPanel('onboarding');},[profile,profileReady]);
 useEffect(()=>{if(panel&&!dialog.current?.open)dialog.current?.showModal();if(!panel&&dialog.current?.open)dialog.current?.close();},[panel]);
 useEffect(()=>{
  if(panel!=='camera'){
   cameraStream.current?.getTracks().forEach(track=>track.stop());cameraStream.current=null;
   return;
  }
  let cancelled=false;
  setCameraError('');
  if(!navigator.mediaDevices?.getUserMedia){setCameraError('Live camera preview is not available in this browser. Use Add another side to choose a photo or open the device camera.');return;}
  void navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}).then(stream=>{
   if(cancelled){stream.getTracks().forEach(track=>track.stop());return;}
   cameraStream.current=stream;
   if(cameraVideo.current)cameraVideo.current.srcObject=stream;
  }).catch(()=>{if(!cancelled)setCameraError('NutriScan could not open the camera. Allow camera access or choose an existing photo instead.');});
  return()=>{cancelled=true;cameraStream.current?.getTracks().forEach(track=>track.stop());cameraStream.current=null;};
 },[panel]);
 useEffect(()=>{if(!ocrRegion)return;return()=>URL.revokeObjectURL(ocrRegion.url);},[ocrRegion]);
 useEffect(()=>{if((remember||rememberConversation)&&pkg)saveScan({id:pkg.id,name:pkg.name,createdAt:pkg.createdAt,package:pkg,portion,unit,...(rememberConversation?{conversation:savedConversationTurns(messages)}:{})}).then(()=>readHistory()).then(setHistory).catch(()=>setNotice('This browser could not save the scan. You can still export it.'));},[remember,rememberConversation,pkg,portion,unit,messages]);

  function photoUrls(asset:PhotoReviewAsset){return [asset.url,asset.originalUrl,asset.editedUrl].filter((url):url is string=>Boolean(url));}
  function releasePhotosNotRetained(candidates:PhotoReviewAsset[],retained:PhotoReviewAsset[]){
   const keep=new Set(retained.flatMap(photoUrls));const released=new Set<string>();
   for(const asset of candidates)for(const url of photoUrls(asset))if(!keep.has(url)&&!released.has(url)){URL.revokeObjectURL(url);released.add(url);}
  }
  function beginScanner(imageId?:string){if(!profileReady){setNotice('Preparing your workspace. Try again in a moment.');return;}scannerSnapshot.current=images.map(image=>({...image}));retiredPhotos.current=[];setScannerActiveImageId(imageId??images[0]?.id??'');setError('');setCameraError('');setPanel('scanner');}
  function saveScanner(close:boolean){
   const saved=images.map(image=>({...image}));
   releasePhotosNotRetained(retiredPhotos.current,saved);retiredPhotos.current=[];
   scannerSnapshot.current=saved;
   setImages(saved);if(saved.length)setVisionImageId(current=>saved.some(image=>image.id===current)?current:saved[0].id);
   setNotice('Saved '+saved.length+' package side'+(saved.length===1?'':'s')+' on this device.');
   if(close)setPanel(null);
  }
  function cancelScanner(){
   const restore=scannerSnapshot.current.map(image=>({...image}));
   releasePhotosNotRetained([...images,...retiredPhotos.current],restore);retiredPhotos.current=[];
   setImages(restore);setScannerActiveImageId(restore[0]?.id??'');setPanel(null);
  }
  async function addFiles(files:FileList|null){
  if(!files?.length)return;setError('');
  const remaining=Math.max(0,10-images.length);if(!remaining){setError('Add up to 10 relevant photos to one investigation.');return;}
  const selected=Array.from(files).slice(0,remaining);if(files.length>remaining)setNotice('Only the first 10 photos in this investigation were added.');
  const added:PhotoReviewAsset[]=[];
  for(const file of selected){try{added.push(await loadReviewedPhoto(file,file.name));}catch(e){setError(e instanceof Error?e.message:'Could not open one of the photos.');}}
   if(added.length){setImages(previous=>[...previous,...added]);setScannerActiveImageId(previous=>previous||added[0].id);setVisionImageId(previous=>previous||added[0].id);}
 }
 async function loadReviewedPhoto(file:Blob,name:string):Promise<PhotoReviewAsset>{
   const original=await loadImage(file,'extra',name);
  return {...original,originalBlob:original.blob,originalUrl:original.url,originalWidth:original.width,originalHeight:original.height,originalOrientation:original.rotation??0,isOriginal:true,editVersion:0,editState:clonePhotoEditState(pristinePhotoEditState),editHistory:[clonePhotoEditState(pristinePhotoEditState)],editHistoryIndex:0,role:'unknown',description:'',rotation:0};
 }
  async function replaceImage(id:string,file:File){try{const replacement=await loadReviewedPhoto(file,file.name);setImages(previous=>previous.map(image=>{if(image.id!==id)return image;retiredPhotos.current.push(image);return {...replacement,role:image.role,description:image.description};}));processedImages.current.delete(id);setVisionImageId(current=>current===id?replacement.id:current);setCropTarget(current=>current===id?replacement.id:current);setScannerActiveImageId(current=>current===id?replacement.id:current);}catch(e){setError(e instanceof Error?e.message:'Could not replace this photo.');}}
 function releasePhoto(image:PhotoReviewAsset){for(const url of new Set([image.url,image.originalUrl,image.editedUrl].filter((value):value is string=>Boolean(value))))URL.revokeObjectURL(url);}
 async function restorePhotoEdit(image:PhotoReviewAsset,state:PhotoEditState,history:PhotoEditState[],historyIndex:number){
  const originalBlob=image.originalBlob??image.blob;
  const originalUrl=image.originalUrl??image.url;
  const nextState=clonePhotoEditState(state);
  const result=await renderPhotoEdit(originalBlob,nextState);
  const hasEdits=photoHasEdits(nextState);
  const url=hasEdits?URL.createObjectURL(result.blob):originalUrl;
  retiredPhotos.current.push(image);
  setImages(previous=>previous.map(current=>current.id!==image.id?current:{
   ...current,
   originalBlob,
   originalUrl,
   originalWidth:current.originalWidth??current.width,
   originalHeight:current.originalHeight??current.height,
   originalOrientation:current.originalOrientation??current.rotation??0,
   blob:result.blob,
   url,
   width:result.width,
   height:result.height,
   editedBlob:hasEdits?result.blob:undefined,
   editedUrl:hasEdits?url:undefined,
   editedWidth:hasEdits?result.width:undefined,
   editedHeight:hasEdits?result.height:undefined,
   isOriginal:!hasEdits,
   editState:nextState,
   editHistory:history.map(clonePhotoEditState),
   editHistoryIndex:historyIndex,
   editVersion:(current.editVersion??0)+1,
   rotation:0,
  }));
 }
 async function commitPhotoEdit(id:string,state:PhotoEditState){
  const image=images.find(item=>item.id===id);if(!image)return;
  setPhotoEditBusy(true);
  try{
   const history=(image.editHistory?.length?image.editHistory:[clonePhotoEditState(pristinePhotoEditState)]).map(clonePhotoEditState);
   const currentIndex=Math.max(0,Math.min(image.editHistoryIndex??history.length-1,history.length-1));
   const currentState=history[currentIndex]??image.editState??pristinePhotoEditState;
   const nextState=clonePhotoEditState(state);
   if(JSON.stringify(currentState)===JSON.stringify(nextState))return;
   const nextHistory=history.slice(0,currentIndex+1);
   nextHistory.push(nextState);
   await restorePhotoEdit(image,nextState,nextHistory,nextHistory.length-1);
  } finally {setPhotoEditBusy(false);}
 }
 async function stepPhotoEditHistory(id:string,direction:-1|1){
  const image=images.find(item=>item.id===id);if(!image)return;
  const history=image.editHistory?.length?image.editHistory:[clonePhotoEditState(pristinePhotoEditState)];
  const nextIndex=(image.editHistoryIndex??history.length-1)+direction;
  if(nextIndex<0||nextIndex>=history.length)return;
  setPhotoEditBusy(true);
  try{await restorePhotoEdit(image,history[nextIndex],history,nextIndex);}
  finally{setPhotoEditBusy(false);}
 }
 function undoPhotoEdit(id:string){return stepPhotoEditHistory(id,-1);}
 function redoPhotoEdit(id:string){return stepPhotoEditHistory(id,1);}
  function removePhoto(id:string){
   const removed=images.find(image=>image.id===id);if(removed)retiredPhotos.current.push(removed);
   processedImages.current.delete(id);setImages(previous=>previous.filter(image=>image.id!==id));
   if(cropTarget===id)setCropTarget('');
   if(visionImageId===id)setVisionImageId(images.find(image=>image.id!==id)?.id??'');
   if(scannerActiveImageId===id)setScannerActiveImageId(images.find(image=>image.id!==id)?.id??'');
  }
 async function addCameraCapture(){
  const video=cameraVideo.current;if(!video?.videoWidth||!video.videoHeight){setCameraError('The camera is not ready yet. Wait for the preview, or choose a saved photo.');return;}
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const context=canvas.getContext('2d');if(!context){setCameraError('Your browser could not prepare this camera image.');return;}
  context.drawImage(video,0,0);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94));
  if(!blob){setCameraError('The camera image could not be captured. Try again or choose a saved photo.');return;}
  if(images.length>=10){setCameraError('This investigation already has 10 photos. Remove one before adding another.');return;}
   try{const asset=await loadReviewedPhoto(blob,'Camera side '+(images.length+1)+'.jpg');setImages(previous=>[...previous,asset]);setScannerActiveImageId(asset.id);setVisionImageId(value=>value||asset.id);setNotice('Photo added as-is. Original pixels are unchanged.');setPanel('scanner');}
  catch(error){setCameraError(error instanceof Error?error.message:'Could not keep this camera photo.');}
 }
 function searchLocalEvidenceForTurn(prompt:string,baseAnswer:string,at:string,stamp:number,shouldSearch:boolean){
  if(!shouldSearch)return;
  const requestId=Symbol();pendingLocalEvidenceRequests.current.add(requestId);setLocalEvidenceBusy(true);
  void (async()=>{
   try{
    const hits=await requestLocalEvidence(prompt);if(stamp!==epoch.current)return;const sources=hits.map(hit=>hit.source);
    setSemantic(hits.map(({source,score})=>({...source,score})));
    setMessages(previous=>previous.map(turn=>turn.at===at&&turn.answer===baseAnswer?{...turn,answer:buildLocalEvidenceFollowUp(baseAnswer,sources),...(sources.length?{evidence:sources}:{})}:turn));
   }catch{
    if(stamp===epoch.current)setMessages(previous=>previous.map(turn=>turn.at===at&&turn.answer===baseAnswer?{...turn,answer:buildLocalEvidenceUnavailableFollowUp(baseAnswer)}:turn));
   }finally{
    pendingLocalEvidenceRequests.current.delete(requestId);setLocalEvidenceBusy(pendingLocalEvidenceRequests.current.size>0);
   }
  })();
 }
  function acceptPackage(data:PackageData,initialQuestion=''){
   const stamp=++epoch.current;pendingLocalEvidenceRequests.current.clear();setLocalEvidenceBusy(false);setBusy(false);setRemoteNotice('');setRemoteBusy('');setRemember(false);setRememberConversation(false);setShowAllOcrObservations(false);setPkg(data);
   const firstQuestion=initialQuestion.trim();const selected=resolveQuestionPortion(firstQuestion,defaultPortion(data),data.netWeight);setPortion(selected.value);setUnit(selected.unit);
    const firstAudit=firstQuestion?buildAudit(data,selected.value,selected.unit,profile,firstQuestion):null;const turnAt=new Date().toISOString();
    const useGemini=!!firstQuestion&&cloudMode&&status.gemini?.enabled&&!data.synthetic;
    const firstReply=firstAudit&&!useGemini?buildLocalAuditConversationReply(firstAudit,firstQuestion):null;
    const firstTurn:Message|null=firstQuestion?{question:firstQuestion,answer:firstReply?.answer??'',answerOrigin:useGemini?'gemini':'local',at:turnAt,...(useGemini?{status:'pending' as const}:{}),...(firstReply?.evidence?{evidence:firstReply.evidence}:{})}:null;
    setMessages(firstTurn?[firstTurn]:[]);
    setRemoteCandidates([]);setProducts([]);setProductLookupNotice('');setResearch([]);setSelectedProduct(null);setSemantic([]);setActiveQuestion(initialQuestion);setAuditQuestion(initialQuestion);setQuestion('');setInspection(null);setLookup(defaultLookup(data));
    if(firstTurn&&firstAudit&&!useGemini)searchLocalEvidenceForTurn(firstQuestion,firstTurn.answer,turnAt,stamp,shouldSearchLocalEvidence(firstAudit));
   setTimeout(()=>threadScrollRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80);return firstTurn;
  }
 async function scan(){
   if(!profileReady){setNotice('Loading this browser’s optional context. Try again in a moment.');return;}
  if(!images.length)return;const stamp=epoch.current;const initialQuestion=question.trim();setError('');setNotice('');setBusy(true);abort.current=new AbortController();
  const pending=images.filter(image=>processedImages.current.get(image.id)!==readSignature(image));
  const selected=pending.length?pending:images;
  try{
   const options={rotation:0,contrast,invert,crop:cropEnabled?crop:undefined,cropTarget};
   const result=await readImages(selected,(label,value)=>setProgress({label,value}),abort.current.signal,options);
   if(stamp!==epoch.current)return;
   if(result.text.trim().length<8&&!result.barcodes.length&&productDescription.trim().length<3)throw new Error('There is not enough readable text yet. Try a closer photograph, add a clear label close-up, or enter a product barcode in the details field.');
   let parsed=parseLabel(result.text,{origin:'ocr',confidence:result.confidence,observations:result.observations,ocrCaptures:result.captures,side:'extra',userDescription:productDescription.trim()});
   let secondaryUsed=false;
   let secondaryUnavailable=false;
   if(shouldRunPaddleFallback(parsed,selected)){
    const candidates=selectPaddleFallbackAssets(selected,result.observations,parsed.name==='Unidentified package');
    if(candidates.length){
     try{
      const recovered=await readPaddleOcrImages(candidates,(label,value)=>setProgress({label,value}),abort.current.signal,options,result.observations);
      if(stamp!==epoch.current)return;
      if(recovered.observations.length){
       const recoveredPackage=parseLabel(recovered.text,{origin:'ocr',confidence:recovered.confidence,observations:recovered.observations,ocrCaptures:recovered.captures,side:'extra',userDescription:productDescription.trim()});
       parsed=mergeSecondaryOcrEvidence(parsed,recoveredPackage);
       secondaryUsed=true;
      }
     }catch(error){
      if(abort.current?.signal.aborted)throw error;
      secondaryUnavailable=true;
     }
    }
   }
   const data=applyBarcodeReadings(parsed,result.barcodes);
   const combined=pkg&&!pkg.synthetic?mergePackageEvidence(pkg,data):null;
   const next=combined??data;
   setRawText(next.rawText);
   if(combined){
     epoch.current++;setBusy(false);setPkg(next);setRemoteCandidates([]);setProducts([]);setProductLookupNotice('');setResearch([]);setSemantic([]);setSelectedProduct(null);setRemoteNotice('');setRemoteBusy('');setRemember(false);setRememberConversation(false);setInspection(null);setLookup(defaultLookup(next));setMessages(previous=>previous.map(({uiComponents:_uiComponents,...turn})=>({...turn,outdated:true})));
     setNotice(secondaryUsed?'The new photos added label evidence. Conflicting readings remain separate and are not used in calculations.':secondaryUnavailable?'We kept the first reading. Some text on the package may still be missing.':`Added label evidence from ${selected.length} photo${selected.length===1?'':'s'}. Earlier findings and your conversation are still here; review any conflicts.`);
     if(initialQuestion){
      const selectedPortion=resolveQuestionPortion(initialQuestion,defaultPortion(next),next.netWeight);setPortion(selectedPortion.value);setUnit(selectedPortion.unit);setActiveQuestion(initialQuestion);setAuditQuestion(initialQuestion);
      const response=buildAudit(next,selectedPortion.value,selectedPortion.unit,profile,initialQuestion);const turnAt=new Date().toISOString();const useGemini=cloudMode&&status.gemini?.enabled&&!next.synthetic;const localReply=useGemini?null:buildLocalAuditConversationReply(response,initialQuestion);
      setMessages(previous=>[...previous,{question:initialQuestion,answer:localReply?.answer??'',answerOrigin:useGemini?'gemini':'local',at:turnAt,...(useGemini?{status:'pending' as const}:{}),...(localReply?.evidence?{evidence:localReply.evidence}:{})}]);if(!useGemini&&localReply)searchLocalEvidenceForTurn(initialQuestion,localReply.answer,turnAt,epoch.current,shouldSearchLocalEvidence(response));setQuestion('');
      if(cloudMode&&!status.gemini?.enabled&&!next.synthetic)setRemoteNotice('Gemini is unavailable right now. This local reply is limited to the recorded label observations and calculations.');
       if(useGemini)void gemini(false,{packageData:next,question:initialQuestion,auditData:response,imageAssets:images,messages:[],replaceTurnAt:turnAt,portion:selectedPortion.value,unit:selectedPortion.unit});
       }else if(cloudMode&&status.gemini?.enabled&&!next.synthetic){const turnAt=new Date().toISOString(),turnQuestion='What can you tell me about this updated package?';setMessages(previous=>[...previous,{question:turnQuestion,answer:'',answerOrigin:'gemini',at:turnAt,status:'pending'}]);void gemini(false,{packageData:next,question:turnQuestion,imageAssets:images,messages:[],replaceTurnAt:turnAt,portion,unit});}
      else if(cloudMode&&!status.gemini?.enabled&&!next.synthetic)setRemoteNotice('Gemini is unavailable right now. Your photos and local label reading remain here.');
   }else{
    if(pkg?.synthetic)processedImages.current.clear();
    const firstTurn=acceptPackage(data,initialQuestion);
     if(cloudMode&&!status.gemini?.enabled&&!data.synthetic)setRemoteNotice('Cloud analysis is not available right now. Your local label reading is ready and your scans are still here.');
     if(cloudMode&&status.gemini?.enabled&&!data.synthetic){const selectedPortion=resolveQuestionPortion(initialQuestion,defaultPortion(data),data.netWeight);const auditData=buildAudit(data,selectedPortion.value,selectedPortion.unit,includeProfileWithGemini?profile:defaultProfile,initialQuestion);void gemini(false,{packageData:data,question:initialQuestion,auditData,imageAssets:images,messages:[],replaceTurnAt:firstTurn?.at,portion:selectedPortion.value,unit:selectedPortion.unit});}
    if(secondaryUsed)setNotice('The new photos added label evidence. Conflicting readings remain separate and are not used in calculations.');
    else if(secondaryUnavailable)setNotice('We kept the first reading. Some text on the package may still be missing.');
    if(result.barcodes.length){const codes=[...new Set(result.barcodes.map(item=>item.code))];setNotice(data.barcode?'Barcode decoded locally. You can look up its public product record; market and package identity still need checking.':codes.length>1?'Multiple or conflicting barcodes were detected. No product record was selected; check which package each photo shows.':'Barcode readings conflict with the printed/OCR code. No product record was selected; verify the number on the package.');}
   }
   for(const image of selected)processedImages.current.set(image.id,readSignature(image));
  }
  catch(e){if(stamp===epoch.current)setError(e instanceof Error?e.message:'The label reader stopped. Try a closer photograph.');}
   finally{if(stamp===epoch.current)setBusy(false);}
 }
 function example(){if(!profileReady)return;images.forEach(releasePhoto);setImages([]);processedImages.current.clear();setInspection(null);setRawText(exampleText);acceptPackage(parseLabel(exampleText,{origin:'fixture',synthetic:true}));setNotice('You are exploring a synthetic label. These values do not describe a real food product.');}
  function analyzeText(){
   if(!profileReady){setNotice('Loading this browser’s optional context. Try again in a moment.');return;}
   if(rawText.trim().length<8){setError('Paste at least one readable label line.');return;}
   const textPackage=parseLabel(rawText,{origin:'user',userDescription:productDescription.trim()});setPanel(null);setError('');setInspection(null);
   if(pkg&&!pkg.synthetic){
    const next=mergePackageEvidence(pkg,textPackage);epoch.current++;setPkg(next);setRawText(next.rawText);setRemoteCandidates([]);setProducts([]);setProductLookupNotice('');setResearch([]);setSemantic([]);setSelectedProduct(null);setRemoteNotice('');setRemoteBusy('');setRemember(false);setRememberConversation(false);setLookup(defaultLookup(next));
    setMessages(current=>current.map(({uiComponents:_uiComponents,...turn})=>({...turn,outdated:true})));
    setNotice('Added your label text. Earlier answers are marked as based on the previous label evidence.');
    const prompt=question.trim()||'What can you tell me about this package?';const selected=resolveQuestionPortion(prompt,defaultPortion(next),next.netWeight);setPortion(selected.value);setUnit(selected.unit);setActiveQuestion(prompt);setAuditQuestion(prompt);
    const response=buildAudit(next,selected.value,selected.unit,profile,prompt);const at=new Date().toISOString();const useGemini=cloudMode&&status.gemini?.enabled&&!next.synthetic;const localReply=useGemini?null:buildLocalAuditConversationReply(response,prompt);
    setMessages(current=>[...current,{question:prompt,answer:localReply?.answer??'',answerOrigin:useGemini?'gemini':'local',at,...(useGemini?{status:'pending' as const}:{}),...(localReply?.evidence?{evidence:localReply.evidence}:{})}]);setQuestion('');
     if(useGemini)void gemini(false,{packageData:next,question:prompt,auditData:response,imageAssets:images,messages:[],replaceTurnAt:at,portion:selected.value,unit:selected.unit,interpretedCandidates:remoteCandidates});
    else if(localReply&&shouldSearchLocalEvidence(response))searchLocalEvidenceForTurn(prompt,localReply.answer,at,epoch.current,true);
    return;
   }
   setRawText(textPackage.rawText);const firstTurn=acceptPackage(textPackage,question.trim());
   if(cloudMode&&status.gemini?.enabled&&!textPackage.synthetic){const selectedPortion=resolveQuestionPortion(question.trim(),defaultPortion(textPackage),textPackage.netWeight);const auditData=buildAudit(textPackage,selectedPortion.value,selectedPortion.unit,includeProfileWithGemini?profile:defaultProfile,question.trim());void gemini(false,{packageData:textPackage,question:question.trim(),auditData,imageAssets:images,messages:[],replaceTurnAt:firstTurn?.at,portion:selectedPortion.value,unit:selectedPortion.unit});}
   if(images.length)setNotice('Label text is added to the investigation. Your photos remain attached; read them to combine their evidence.');
  }
  function startFromDescription(){if(!profileReady){setNotice('Loading this browser’s optional context. Try again in a moment.');return;}const text=productDescription.trim();if(text.length<3){setError('Add a product name or a few details first.');return;}setError('');const parsedBase=parseLabel(text,{origin:'user',userDescription:text});const parsed={...parsedBase,warnings:[...parsedBase.warnings,'No package photo or verified product record has been supplied.'],name:parsedBase.name||'Product details only'};const firstTurn=acceptPackage(parsed,question.trim());if(cloudMode&&status.gemini?.enabled){const selectedPortion=resolveQuestionPortion(question.trim(),defaultPortion(parsed),parsed.netWeight);const auditData=buildAudit(parsed,selectedPortion.value,selectedPortion.unit,includeProfileWithGemini?profile:defaultProfile,question.trim());void gemini(false,{packageData:parsed,question:question.trim(),auditData,imageAssets:[],messages:[],replaceTurnAt:firstTurn?.at,portion:selectedPortion.value,unit:selectedPortion.unit});}}
 function reset(){epoch.current++;pendingLocalEvidenceRequests.current.clear();setLocalEvidenceBusy(false);abort.current?.abort();setBusy(false);setRemoteBusy('');setRemoteNotice('');setProductLookupNotice('');setPkg(null);setRawText('');setProductDescription('');setMessages([]);setProducts([]);setResearch([]);setNotice('');setError('');setRemember(false);setRememberConversation(false);setRemoteCandidates([]);setSelectedProduct(null);setSemantic([]);setInspection(null);setContrast(false);setInvert(false);setCropEnabled(false);setCropTarget('');setVisionImageId('');setQuestion('');setActiveQuestion('');setAuditQuestion('');processedImages.current.clear();images.forEach(releasePhoto);setImages([]);window.scrollTo({top:0,behavior:'smooth'});}
 function ask(text=question){
   if(!profileReady){setNotice('Loading this browser’s optional context. Try again in a moment.');return;}if(!pkg||!text.trim())return;const prompt=text.trim().slice(0,1000);const selected=resolveQuestionPortion(prompt,{value:portion,unit},pkg.netWeight);setPortion(selected.value);setUnit(selected.unit);
  const localQuestion=resolveLocalFollowUpQuestion(prompt,messages);setActiveQuestion(prompt);setAuditQuestion(localQuestion);const response=buildAudit(pkg,selected.value,selected.unit,profile,localQuestion,remoteCandidates,images.map(image=>image.id));
   const at=new Date().toISOString();const useGemini=cloudMode&&status.gemini?.enabled&&!pkg.synthetic;const localReply=useGemini?null:buildLocalAuditConversationReply(response,localQuestion);
   setMessages(prev=>[...prev,{question:prompt,answer:localReply?.answer??'',answerOrigin:useGemini?'gemini':'local',at,...(useGemini?{status:'pending' as const}:{}),...(localReply?.evidence?{evidence:localReply.evidence}:{})}]);setQuestion('');
   if(!useGemini&&shouldSearchLocalEvidence(response)){setSemantic([]);searchLocalEvidenceForTurn(localQuestion,localReply?.answer??'',at,epoch.current,true);}
   if(useGemini)void gemini(false,{packageData:pkg,question:prompt,auditData:response,imageAssets:images,messages,replaceTurnAt:at,portion:selected.value,unit:selected.unit,interpretedCandidates:remoteCandidates});
 }
 function prepareAdditiveResearch(code:string){
  const normalized=code.trim().match(/^(?:INS\s*)?(\d{3,4}(?:[a-z]|\([ivx]+\))?)$/i)?.[1].toUpperCase();
  if(!normalized)return;
  const known=lookupAdditive(normalized);
  setLookup(`${known?`${known.name} `:''}INS ${normalized} additive`);
  setTopic('regulation');setProducts([]);setProductLookupNotice('');setResearch([]);setSemantic([]);
  setRemoteNotice('Search prepared from this label code. Review the terms, then choose Research sources to make a public lookup.');
  if(inspectorRef.current)inspectorRef.current.open=true;
  if(sourceRef.current)sourceRef.current.open=true;
  sourceRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
  window.setTimeout(()=>lookupInputRef.current?.focus(),250);
 }
  function reopenSavedScan(scan:SavedScan){const data=packageSchema.safeParse(scan.package);if(!data.success){setNotice('This saved scan could not be opened.');return;}images.forEach(releasePhoto);setImages([]);if(!rememberProfile)setProfile(defaultProfile);acceptPackage(data.data);setRemember(true);setRememberConversation(!!scan.conversation?.length);setPortion(scan.portion);setUnit(scan.unit);setRawText(data.data.rawText);const conversation=scan.conversation??[];setMessages(conversation);const lastQuestion=conversation.at(-1)?.question??'';setActiveQuestion(lastQuestion);setAuditQuestion(resolveLocalFollowUpQuestion(lastQuestion,conversation.slice(0,-1)));setPanel(null);setNotice(conversation.length?`Reopened ${conversation.length} saved conversation turns. Your separately remembered context remains available.`:'Saved scan reopened. Its saved record contains no profile context.');}
 function changeConversationSaving(enabled:boolean){setRememberConversation(enabled);if(enabled||!pkg)return;const update=remember?saveScan({id:pkg.id,name:pkg.name,createdAt:pkg.createdAt,package:pkg,portion,unit}):removeSavedScan(pkg.id);void update.then(()=>readHistory()).then(setHistory).catch(()=>setNotice('This browser could not update saved history.'))}
 async function remote(kind:'products'|'research'|'semantic',alternatives=false,textOverride?:string){
   if(!profileReady){setNotice('Loading this browser’s optional context. Try again in a moment.');return;}const text=(textOverride??lookup).trim();if(!text)return;const stamp=epoch.current;setRemoteBusy(kind);setRemoteNotice('');if(kind==='products'){setProducts([]);setSelectedProduct(null);setProductLookupNotice('');}if(kind==='research')setResearch([]);if(kind==='semantic')setSemantic([]);
  try{
   const endpoint=kind==='semantic'?'evidence':kind;
    const body=kind==='products'?buildProductLookupRequest({text,alternatives,country:profile.country,productName:pkg?.name,productBarcode:pkg?.barcode}):kind==='research'?{query:text,topic}:{query:text,limit:3};
   const response=await fetch(`/api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
   const data=await response.json();if(stamp!==epoch.current)return;
   if(kind==='products'){
    const records=Array.isArray(data.products)?data.products as ProductRecord[]:[];
    setProducts(records);
    setProductLookupNotice(response.ok?(records.length?'':data.message??'No community product record was returned for this search.'):data.message??data.error??'Open Food Facts could not return a product record.');
   }
   if(kind==='research')setResearch(data.items??[]);
   if(kind==='semantic'){
    const parsed=parseLocalEvidenceResponse(data);
    setSemantic(parsed.hits.map(({source,score})=>({...source,score})));
    setRemoteNotice(parsed.message??(parsed.hits.length?'Local source candidates retrieved. Review their scope before applying them.':'No local source candidate was returned.'));
   }else if(kind!=='products')setRemoteNotice(data.message??data.error??(response.ok?'Sources retrieved. Read their scope before applying them.':'This source could not be reached.'));
  }catch{if(stamp===epoch.current){setRemoteNotice('The lookup could not finish. Your scan and calculations are still available.');if(kind==='products')setProductLookupNotice('The public product lookup could not finish. Your scan, photos and calculations remain in this browser.');}}finally{if(stamp===epoch.current)setRemoteBusy('');}
 }
 async function gemini(vision=false,context?:GeminiRunContext){
  const targetPackage=context?.packageData??pkg;const targetImages=context?.imageAssets??images;const targetMessages=context?.messages??messages;
  const targetQuestion=context?.question??activeQuestion;const visibleQuestion=targetQuestion.trim()||'What can you tell me about this package?';const amount=context?.portion??portion;const amountUnit=context?.unit??unit;
  const targetProfile=includeProfileWithGemini&&hasProfile(profile)?profile:defaultProfile;
  const targetCandidates=context?.interpretedCandidates??remoteCandidates;
  const targetAudit=context&&Object.prototype.hasOwnProperty.call(context,'auditData')?context.auditData??null:targetPackage?buildAudit(targetPackage,amount,amountUnit,targetProfile,targetQuestion,targetCandidates,images.map(image=>image.id)):audit;
  if(!cloudMode||!status.gemini?.enabled||!targetPackage||targetPackage.synthetic)return;
  if(geminiRequest.current){geminiRequest.current.intentional=true;geminiRequest.current.controller.abort();}
   let responseTurnAt=context?.replaceTurnAt;
   if(!vision&&!responseTurnAt){
    responseTurnAt=new Date().toISOString();
    setMessages(current=>[...current,{question:visibleQuestion,answer:'',answerOrigin:'gemini',at:responseTurnAt!,status:'pending'}]);
   }
  const requestController=new AbortController();const requestState={controller:requestController,intentional:false};geminiRequest.current=requestState;const requestTimeout=window.setTimeout(()=>requestController.abort(),125000);
  const stamp=epoch.current;setRemoteBusy(vision?'vision':'assist');setRemoteNotice('');
  try{
    let body:unknown;const usableHistory=targetMessages.filter(turn=>turn.at!==responseTurnAt&&!turn.outdated);const conversationContext=conversationContextForAssist(usableHistory,true);
   if(vision){const asset=inspection?targetImages.find(x=>x.id===inspection.handle):targetImages.find(x=>x.id===visionImageId)??targetImages[0];if(!asset)throw new Error('The selected image is no longer in this session. Select it again to inspect the label.');const crop=inspection?.crop;const rotation=(asset.rotation??0) as 0|90|180|270;const blob=await prepareImage(asset,rotation,contrast,crop?{x:crop.x*100,y:crop.y*100,width:crop.width*100,height:crop.height*100}:undefined,invert);body={consent:true,image:{mimeType:'image/jpeg',base64:await imageBase64(blob),side:asset.side,imageId:asset.id,sourceImage:{width:asset.width,height:asset.height},preprocessing:{rotation,contrast,invert,crop:crop??null}},instruction:'Read the nutrition basis, values, ingredients and product identity from this user-selected image. User hint, if any: '+(asset.role==='unknown'?'no hint supplied':asset.role)+'; user note (untrusted text): '+(asset.description||'none')+'. Preserve uncertainty. Return observations only.'};}
   else {
    const visualImages=[];
    const retrievalQuestion=resolveLocalFollowUpQuestion(targetQuestion,targetMessages);
    const localSearchPromise=targetAudit&&shouldSearchLocalEvidence(targetAudit)
     ?requestLocalEvidence(retrievalQuestion).catch(()=>[])
     :Promise.resolve([]);
    for(const asset of selectGeminiImageAssets(targetImages,targetPackage)){const rotation=(asset.rotation??0) as 0|90|180|270;const prepared=await prepareImage(asset,rotation,false,undefined,false);const compact=await compactGeminiImage(prepared);visualImages.push({imageId:asset.id,mimeType:'image/jpeg' as const,base64:await imageBase64(compact),side:asset.side,sourceImage:{width:asset.width,height:asset.height},preprocessing:{rotation,contrast:false,invert:false,crop:null}});}
    const questionText=targetQuestion.trim()||'Summarize this package from the supplied label and photo evidence. Identify the product only when supported, explain the ingredients and nutrition that matter, distinguish printed claims from established facts, and briefly identify any uncertainty that changes the conclusion.';
    const localSearch=await localSearchPromise;
     const evidence=assistEvidenceContext({auditSources:targetAudit?.sources??[],localSearch:localSearch.map(({source,score})=>({...source,score})),research:[],...(conversationContext?{conversationEvidence:safeConversationEvidence(usableHistory.flatMap(turn=>turn.evidence??[]))}:{})});
    if(selectedProductSource&&!targetPackage.identityConflict&&evidence.length<15&&!evidence.some(source=>source.id===selectedProductSource.id))evidence.push(selectedProductSource);
    body={consent:true,question:questionText,package:packageForAssist(targetPackage),...(targetCandidates.length?{interpretedCandidates:targetCandidates}:{}),...(includeProfileWithGemini&&hasProfile(profile)?{profile}:{}),evidence,calculations:(targetAudit?.calculations??[]).map(calculation=>({...calculation,evidenceText:calculationEvidenceText(calculation)})),images:targetImages.slice(0,10).map(x=>({handle:x.id,side:x.side,width:x.width,height:x.height,role:x.role,description:x.description})),...(visualImages.length?{visualImages}:{}),...(conversationContext?{conversationContext}:{})};
   }
   const response=await fetch('/api/'+(vision?'vision':'assist'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:requestController.signal});const data=await response.json();if(stamp!==epoch.current)return;
   if(!response.ok)throw new Error(data.message??data.error??'Gemini is not available.');
   if(vision&&data.observations?.length){setPkg(appendVisionEvidence(targetPackage,data.visionCapture,data.observations));setInspection(null);setNotice('Image observations were added to the evidence inspector. They remain unverified and do not change package facts or calculations.');}
   else {const parsedCandidates=tentativeStructuredCandidateSchema.array().max(20).safeParse(data.tentativeCandidates??[]);if(parsedCandidates.success&&parsedCandidates.data.length)setRemoteCandidates(parsedCandidates.data);const parsedComponents=assistantUiComponentSchema.array().max(6).safeParse(data.uiComponents??[]);const uiComponents=parsedComponents.success?parsedComponents.data:[];const parsedSources=conversationEvidenceSourceSchema.array().max(12).safeParse(data.agentEvidence??[]);const evidence=safeConversationEvidence(parsedSources.success?parsedSources.data:[]);const answer=data.answer??data.message??'No grounded answer was returned.';if(responseTurnAt)setMessages(current=>current.map(turn=>turn.at===responseTurnAt?{...turn,answer,answerOrigin:'gemini',status:undefined,statusDetail:undefined,uiComponents,evidence:safeConversationEvidence([...evidence,...(turn.evidence??[])])}:turn));setInspection(data.inspectImage??null);}
  }catch(e){if(stamp===epoch.current&&!requestState.intentional){if(!vision&&responseTurnAt){const local=targetAudit?buildLocalAuditConversationReply(targetAudit,visibleQuestion):{answer:'The package evidence is still here, but a local answer could not be established. Retry Gemini or ask about a specific label detail.'};setMessages(current=>current.map(turn=>turn.at===responseTurnAt?{...turn,answer:local.answer,answerOrigin:'local',status:'fallback',statusDetail:'Gemini could not complete this answer. This local summary uses only recorded package observations and calculations.',...(local.evidence?{evidence:local.evidence}:{})}:turn));setRemoteNotice('');}else setRemoteNotice(requestController.signal.aborted?'Gemini took too long to respond. Retry when it is available.':'Gemini could not inspect that image. Your current package readings remain available.');}}finally{window.clearTimeout(requestTimeout);if(geminiRequest.current===requestState){geminiRequest.current=null;if(stamp===epoch.current)setRemoteBusy('');}}
 }
  function applyTableCorrection(value:NutrientCorrection):boolean{
   if(!pkg)return false;
   let validated:PackageData;
   try{validated=applyNutrientCorrection(pkg,value);}catch{setNotice('That correction is outside supported ranges. Check the units.');return false;}
   if(geminiRequest.current){geminiRequest.current.intentional=true;geminiRequest.current.controller.abort();geminiRequest.current=null;}
    epoch.current++;setRemoteBusy('');setRemoteNotice('');setRemoteCandidates([]);setMessages(current=>current.map(({uiComponents:_uiComponents,...turn})=>({...turn,outdated:true})));setInspection(null);setPkg(validated);setPanel(null);setNotice('Correction saved as your reading. Calculations and future questions use it; earlier answers are marked as based on the previous label. Original OCR evidence remains linked.');return true;
  }
  function correct(){
   const value=Number(correction.value),basis=Number(correction.basis);if(!correction.value||!Number.isFinite(value)||value<0||!Number.isFinite(basis)||basis<=0||!correction.basisUnit){setNotice('Enter the label value and its printed positive basis, including the basis unit.');return;}
   applyTableCorrection({key:correction.key,value,unit:correction.unit as NutrientCorrection['unit'],basisAmount:basis,basisUnit:correction.basisUnit,productName:correction.name});
  }
 function canInspectOcrRegion(observation:Observation){
  if(observation.origin!=='ocr'||!observation.imageId||!observation.bbox||!observation.readingOrder?.runId)return false;
  return !!pkg?.ocrCaptures?.some(capture=>capture.imageId===observation.imageId&&capture.runId===observation.readingOrder?.runId)&&images.some(image=>image.id===observation.imageId);
 }
 async function inspectOcrRegion(observation:Observation){
  const bbox=observation.bbox,imageId=observation.imageId,runId=observation.readingOrder?.runId;
  if(!bbox||!imageId||!runId){setNotice('This OCR line has no usable image-region link. Its original text remains available.');return;}
  const capture=pkg?.ocrCaptures?.find(item=>item.imageId===imageId&&item.runId===runId),asset=images.find(item=>item.id===imageId);
  if(!capture||!asset){setNotice('The original photo is not available in this browser session. Its OCR text and coordinates remain in the evidence record.');return;}
  setNotice('');setOcrRegionBusy(observation.id);
  try{
   const crop=capture.processing.cropPercent??undefined;
   const prepared=await prepareImage(asset,capture.processing.rotation,capture.processing.contrast,crop??undefined,capture.processing.invert);
   const bitmap=await createImageBitmap(prepared);const dimensionsMatch=bitmap.width===capture.preparedImage.width&&bitmap.height===capture.preparedImage.height;bitmap.close();
   if(!dimensionsMatch)throw new Error('The saved OCR region does not match the photo prepared for this scan. Use the original photo above to check the text.');
   setOcrRegion({url:URL.createObjectURL(prepared),width:capture.preparedImage.width,height:capture.preparedImage.height,bbox,text:observation.text,confidence:observation.confidence});setPanel('ocr-region');
  }catch(error){setNotice(error instanceof Error?error.message:'This photo region could not be prepared in the browser.');}
  finally{setOcrRegionBusy('');}
 }
 function exportReport(){if(!pkg||!audit)return;downloadJson(`nutriscan-${pkg.id.slice(0,8)}.json`,{schemaVersion:1,exportedAt:new Date().toISOString(),package:pkg,audit,portion,unit,externalProducts:products,research,disclosure:'Contains extracted label text, user-provided product details, and any user-entered corrections. Does not include original photos or private profile text.'});}

 const correctionObservations=pkg?.observations.filter(observation=>observation.origin==='user'&&(observation.supersedesObservationIds?.length??0)>0)??[];
 const correctionLedger=correctionObservations.map(observation=>{
  const replaced=(pkg?.observations??[]).filter(source=>observation.supersedesObservationIds?.includes(source.id));
  const excerpts=replaced.slice(0,3).map(source=>source.text);
  return <div className="observation-entry correction-observation" key={observation.id} data-observation-id={observation.id} data-supersedes-count={replaced.length}><p><span>User correction · {observation.field}</span><span className="ocr-line-text">{observation.text}</span></p>{replaced.length>0&&<small>Replaces prior reading{replaced.length===1?'':'s'}: {excerpts.join(' · ')}{replaced.length>excerpts.length?` · ${replaced.length-excerpts.length} more linked readings`:''}</small>}</div>;
 });
 const allOcrLineObservations=pkg?.observations.filter(observation=>observation.origin==='ocr'&&observation.field==='ocr-line')??[];
 const readableOcrLineObservations=allOcrLineObservations.filter(observation=>!isLowSignalPackageOcrLine(observation));
 const hasAdditionalOcrLines=allOcrLineObservations.length>Math.min(readableOcrLineObservations.length,10);
 const ocrLineObservations=showAllOcrObservations?allOcrLineObservations:readableOcrLineObservations.slice(0,10);

 return <div className={pkg?'app-shell has-package':'app-shell'}>
  <aside className="sidebar" aria-label="Main navigation">
   <a href="#" className="brand" aria-label="NutriScan home" onClick={e=>{e.preventDefault();reset();}}><span className="brand-mark"><ScanLine size={23}/></span>nutriscan<span className="brand-dot">.</span></a>
    <div className="sidebar-section"><span className="eyebrow">YOUR FOOD, UNDERSTOOD</span><button className="nav-item active" onClick={reset}><ScanLine size={19}/>New investigation<Plus size={16} className="push"/></button><button className="nav-item" onClick={()=>setPanel('history')} disabled={!profileReady}><History size={19}/>Recent scans{history.length>0&&<span className="count">{history.length}</span>}</button><button className="nav-item" onClick={()=>setPanel('profile')} disabled={!profileReady}><Settings2 size={19}/>Optional context{hasProfile(profile)&&<span className="small-dot"/>}</button></div>
   <div className="sidebar-note"><Leaf size={20}/><p>A clearer label.<br/><strong>A more informed choice.</strong></p><span>Evidence, with room for uncertainty.</span></div>
   <div className="sidebar-bottom"><button className="nav-item" onClick={()=>setPanel('privacy')}><LockKeyhole size={17}/>Privacy & data</button><div className="local-status"><span/>Local workspace<small>v0.1 · research preview</small></div></div>
  </aside>
  <div className="app-content">
     <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{pkg?'Your investigation':'New investigation'}</strong></div><button className="context-button" onClick={()=>setPanel('profile')} disabled={!profileReady}><span className="avatar">{hasProfile(profile)?'✓':'+'}</span>{hasProfile(profile)?'Context added':'Add optional context'}<ChevronDown size={14}/></button></header>
    <main id="main-content" className={pkg&&audit?'thread-main':undefined}>
         {pkg&&<section className="intro"><h1>Let’s look a little closer.</h1><p>Your package observations are the starting point. Review what we can read, calculate and explain.</p></section>}
     {notice&&<div className="notice" role="status"><CircleHelp size={17}/><span>{notice}</span><button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></div>}
     {error&&<div className="notice error" role="alert"><CircleHelp size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      {!pkg&&<section className="empty-thread-workspace" aria-label="Start a food conversation">
       <div className="empty-thread-main"><div className="empty-thread-intro"><span className="empty-thread-mark"><ScanLine size={22}/></span><span className="eyebrow">FOOD, WITH CONTEXT</span><h1>What are we looking at?</h1><p>Scan a food package, then ask what matters to you. Label observations and calculations stay linked to their evidence.</p>{images.length===0&&<button className="primary-button empty-thread-scan" type="button" onClick={()=>beginScanner()} disabled={busy||!profileReady}><Camera size={18}/>Scan a package</button>}</div>
        {images.length>0&&<div className="scan-gallery empty-thread-gallery" aria-label="Photos added to this scan">{images.map((image,index)=><button className="scan-gallery-item" type="button" key={image.id} onClick={()=>beginScanner(image.id)} aria-label={'Review side '+(index+1)+': '+image.name} disabled={!profileReady}><img src={image.url} alt=""/><span>Side {index+1}</span></button>)}<button className="empty-add-side" type="button" onClick={()=>beginScanner()} disabled={busy||!profileReady}><ImagePlus size={17}/>Add side</button></div>}
       </div>
       {busy&&<div className="thread-progress empty-thread-progress" role="status"><LoaderCircle size={16} className="spin"/><span>{progress.label||'Reading package sides…'}</span><progress max={1} value={progress.value} aria-label="Package reading progress"/><button className="text-button" type="button" onClick={()=>abort.current?.abort()}>Cancel</button></div>}
       <div className="empty-thread-compose"><form className="thread-composer empty-thread-composer" onSubmit={event=>{event.preventDefault();if(images.length)void scan();else startFromDescription();}}><button className="thread-attach" type="button" aria-label="Scan or add package photos" title="Scan or add package photos" onClick={()=>beginScanner()} disabled={busy||!profileReady}><ImagePlus size={19}/></button><label className="sr-only" htmlFor="initial-question">What would you like to know?</label><input id="initial-question" value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)} placeholder="Ask about food, a label, or a portion…" maxLength={1000}/><button className="thread-send" type="submit" aria-label={images.length?'Analyze package':'Analyze details'} disabled={busy||!profileReady||(!images.length&&productDescription.trim().length<3)}>{busy?<LoaderCircle className="spin" size={19}/>:images.length?<ScanLine size={18}/>:<ArrowRight size={19}/>}</button></form>
        <div className="empty-thread-tools"><button className="text-button" type="button" onClick={()=>{setError('');setRawText('');setPanel('text');}} disabled={busy||!profileReady}><FileText size={15}/>Enter label text</button><details className="empty-thread-advanced" ref={emptyAdvancedRef}><summary><Settings2 size={14}/>Details and settings<ChevronDown size={14}/></summary><div className="empty-thread-advanced-content"><label className="field-label">Product name or detail<textarea value={productDescription} onChange={event=>setProductDescription(event.target.value)} maxLength={4000} rows={2} placeholder="Optional; add only what is unclear in the photo."/></label>{images.length>0&&<details className="crop-tools"><summary>Local OCR options<ChevronDown size={15}/></summary><div className="image-tools"><label className="check-label"><input type="checkbox" checked={contrast} disabled={busy} onChange={event=>setContrast(event.target.checked)}/>Improve contrast for OCR</label><label className="check-label"><input type="checkbox" checked={invert} disabled={busy} onChange={event=>setInvert(event.target.checked)}/>Invert dark-pack text for OCR</label><label className="check-label"><input type="checkbox" checked={cropEnabled} disabled={busy} onChange={event=>setCropEnabled(event.target.checked)}/>Focus local OCR on a crop</label>{cropEnabled&&<><label className="field-label">Photo to crop<select value={cropTarget} onChange={event=>setCropTarget(event.target.value)}><option value="">Select a photo</option>{images.map((image,index)=><option key={image.id} value={image.id}>Side {index+1}: {image.name}</option>)}</select></label>{cropTarget&&cropImage&&<div className="crop-preview-wrap"><p>Drag across the photo to select a readable region.</p><div className="crop-preview" role="group" aria-label={'Crop selection for '+cropImage.name} onPointerDown={startCropPointer} onPointerMove={updateCropFromPointer} onPointerUp={endCropPointer} onPointerCancel={endCropPointer}><img className="crop-selector-image" src={cropImage.url} alt="" draggable={false}/><span aria-hidden="true" style={{left:crop.x+'%',top:crop.y+'%',width:crop.width+'%',height:crop.height+'%'}}/></div></div>}</>}</div></details>}<div className="cloud-mode-choice"><p className="privacy-caption"><LockKeyhole size={13}/>{!cloudMode?'Local-only mode is on. Package photos and follow-up questions stay in this browser.':status.gemini?.enabled?`When you choose Analyze, NutriScan sends label text and up to three selected, resized photos to Google Gemini. ${geminiTierDisclosure} Optional profile details stay here unless you separately opt to include them.`:'Cloud analysis is unavailable in this session. Package reading remains local and the photos stay here.'}</p><details className="provider-details local-only-settings"><summary>Advanced analysis settings<ChevronDown size={15}/></summary><label className="check-label"><input type="checkbox" checked={!cloudMode} onChange={event=>{setCloudMode(!event.target.checked);emptyAdvancedRef.current?.removeAttribute('open');}}/><span><strong>Use local-only analysis in this tab</strong><small>When selected, NutriScan will not send this package or follow-up questions to Google Gemini.</small></span></label></details></div></div></details></div>
        <p className="empty-thread-disclosure"><LockKeyhole size={13}/>{status.gemini?.enabled&&cloudMode?`Photos stay on this device until Analyze. That sends selected label text and photos to Google Gemini. Public searches receive query terms only, not photos or profile data. If configured, Google Search grounding is available for evidence questions only when no profile or prior turns are included. ${geminiTierDisclosure}`:'Your photos stay in this browser. Label reading runs locally.'}</p>
       </div>
      </section>}
     {pkg&&audit&&<>
      <section className="thread-workspace" aria-label="Food intelligence conversation">
       <h1 className="sr-only">Food intelligence conversation</h1>
       <header className="thread-package-context">
         <div className="thread-package-identity"><span className="eyebrow">PACKAGE CONTEXT</span><strong>{displayIdentity?.title??'Unidentified food package'}</strong>{displayIdentity?.source==='gemini'&&<small className="thread-identity-suggestion">Gemini suggestion · unverified</small>}<span className="badge neutral">{images.length} {images.length===1?'side':'sides'}</span></div>
        <div className="thread-photo-strip" role="group" aria-label="Package sides">{images.slice(0,4).map((image,index)=><button key={image.id} type="button" onClick={()=>beginScanner(image.id)} aria-label={`Edit package side ${index+1}`} disabled={!profileReady}><img src={image.url} alt=""/><span>{index+1}</span></button>)}{images.length>4&&<span className="thread-photo-overflow">+{images.length-4}</span>}</div>
        <div className="thread-context-actions"><button className="secondary-button" type="button" aria-label="Add or edit sides" onClick={()=>beginScanner()} disabled={busy||!profileReady}><Camera size={16}/><span>Add or edit sides</span></button>{defaultLookup(pkg)&&<button className="secondary-button thread-public-lookup-action" type="button" aria-label={productQuerySource(pkg)==='barcode-candidate'?'Check possible barcode':pkg.barcode?'Check barcode':'Find record'} title={`Only ${productQuerySource(pkg)==='barcode'?'the decoded package barcode':productQuerySource(pkg)==='barcode-candidate'?'a checksum-valid number recognized in package OCR':productQuerySource(pkg)==='user-detail'?'the product detail you entered':'product text read from the package'} is sent to Open Food Facts. Photos and personal context stay in this browser.`} onClick={()=>void remote('products',false,defaultLookup(pkg))} disabled={!!remoteBusy||busy||!profileReady}><Search size={16}/><span>{productQuerySource(pkg)==='barcode-candidate'?'Check possible barcode':pkg.barcode?'Check barcode':'Find record'}</span></button>}{pendingPhotoCount>0&&<button className="primary-button" type="button" onClick={scan} disabled={busy}><ScanLine size={16}/><span>{busy?'Reading…':'Analyze updated photos'}</span></button>}<button className="icon-button thread-profile-action" type="button" aria-label="Update personal context" title="Update personal context" onClick={()=>setPanel('profile')} disabled={!profileReady}><Settings2 size={17}/></button></div>
       </header>
       {busy&&<div className="thread-progress" role="status"><LoaderCircle className="spin" size={16}/><span>{progress.label||'Reading package sides…'}</span><progress max={1} value={progress.value} aria-label="Package reading progress"/><button className="text-button" type="button" onClick={()=>abort.current?.abort()}>Cancel</button></div>}
       <div className="thread-scroll" key={pkg.id} ref={threadScrollRef}>
         {!messages.length&&<div className="thread-welcome"><span className="thread-welcome-mark"><Leaf size={17}/></span><div><strong>What would you like to know?</strong><p>Ask about this package, a portion, or an ingredient.</p></div></div>}
        {pkg.observations.some(observation=>observation.origin==='user'&&(observation.supersedesObservationIds?.length??0)>0)&&<p className="thread-correction-context" role="status"><CheckCircle2 size={15}/>Your corrections are included in calculations and future questions. Earlier answers may reflect previous label values.</p>}
          {messages.map((m,i)=><article className="thread-turn" key={m.at+'-'+i}>
           <p className="thread-user-message">{m.question}</p>
           {m.outdated&&<p className="thread-outdated-note">This answer is from before the latest package update.</p>}
           <div className="thread-assistant-message"><span className="mini-brand"><Leaf size={16}/></span><div>
            {m.status==='pending'?<p className="thread-working" role="status"><LoaderCircle size={16} className="spin"/>Reading the package and checking relevant food evidence…</p>:<p>{presentConversationAnswer(m.answer)}</p>}
            <small>{m.answerOrigin==='gemini'?'NutriScan answer · package and evidence links are available below':'Local package reading · based on recorded observations and calculations'}</small>
            {m.status==='fallback'&&<div className="thread-turn-fallback" role="status"><span>{m.statusDetail}</span><button className="secondary-button" type="button" disabled={!!remoteBusy} onClick={()=>void gemini(false,{packageData:pkg,question:m.question,auditData:audit,imageAssets:images,messages,replaceTurnAt:m.at,portion,unit,interpretedCandidates:remoteCandidates})}>Retry Gemini</button></div>}
           </div></div>
           <ConversationEvidence sources={m.evidence}/>
           {!m.outdated&&m.uiComponents&&m.uiComponents.length>0&&<ThreadGenerativeUI components={m.uiComponents} pkg={pkg} audit={audit} portion={portion} portionUnit={unit} onPortionChange={setPortion} onPortionUnitChange={setUnit} onSaveCorrection={applyTableCorrection} canInspect={canInspectOcrRegion} isInspecting={observation=>ocrRegionBusy===observation.id} onInspect={observation=>void inspectOcrRegion(observation)} candidates={i===messages.length-1?remoteCandidates:[]} interpretedReadings={interpretedNutrition.readings} sources={threadSources} selectedProduct={selectedProduct}/>}
          </article>)}
        {localEvidenceBusy&&<p className="thread-status" role="status"><LoaderCircle size={16} className="spin"/>Checking the curated local evidence library…</p>}
        {remoteNotice&&<div className="thread-status thread-gemini-failure" role="status"><span>{remoteNotice}</span>{cloudMode&&status.gemini?.enabled&&<button className="secondary-button" type="button" disabled={!!remoteBusy} onClick={()=>void gemini()}>Retry analysis</button>}</div>}
        {remoteBusy==='products'&&<p className="thread-status" role="status"><LoaderCircle size={16} className="spin"/>Checking Open Food Facts with {productQuerySource(pkg)==='barcode'?'the decoded package barcode':productQuerySource(pkg)==='barcode-candidate'?'a possible barcode recognized in package OCR':productQuerySource(pkg)==='user-detail'?'the product detail you entered':'the text read from the package'} only. Photos and personal context stay in this browser.</p>}
        {productLookupNotice&&<p className="thread-status" role="status">{productLookupNotice}</p>}
        {products[0]&&<ThreadPublicProductRecord product={products[0]} packageBarcode={pkg.barcode} querySource={productQuerySource(pkg)} identityConflict={!!pkg.identityConflict} canCompare={pkg.nutrients.length>0||interpretedNutrition.readings.length>0} otherCandidates={products.slice(1)} onCompare={setSelectedProduct}/>}
        {selectedProduct&&selectedProductSource&&<ThreadGenerativeUI components={[{type:'product-comparison',observationIds:[],sourceIds:[selectedProductSource.id],calculationIds:[]}]} pkg={pkg} audit={audit} portion={portion} portionUnit={unit} onPortionChange={setPortion} onPortionUnitChange={setUnit} onSaveCorrection={applyTableCorrection} canInspect={canInspectOcrRegion} isInspecting={observation=>ocrRegionBusy===observation.id} onInspect={observation=>void inspectOcrRegion(observation)} candidates={remoteCandidates} interpretedReadings={interpretedNutrition.readings} sources={threadSources} selectedProduct={selectedProduct}/>}
       </div>
       <form className="thread-composer" onSubmit={event=>{event.preventDefault();ask();}}><button className="thread-attach" type="button" aria-label="Add or edit package photos" title="Add or edit package photos" onClick={()=>beginScanner()} disabled={busy||!profileReady}><ImagePlus size={19}/></button><label className="sr-only" htmlFor="followup">Ask about this package</label><input id="followup" value={question} onChange={event=>setQuestion(event.target.value)} placeholder="Ask about a portion, ingredient, or package detail…" maxLength={1000}/><button className="thread-send" aria-label="Send follow-up" disabled={!question.trim()||busy}><ArrowRight size={19}/></button></form>
       <p className="empty-thread-disclosure"><LockKeyhole size={13}/>{status.gemini?.enabled&&cloudMode?`Photos stay on this device until Analyze. That sends selected label text and photos to Google Gemini. Public searches receive query terms only, not photos or profile data. If configured, Google Search grounding is available for evidence questions only when no profile or prior turns are included. ${geminiTierDisclosure}`:'Your photos stay in this browser. Label reading runs locally.'}</p>
       <div className="thread-footer-actions"><span title={includeProfileWithGemini&&hasProfile(profile)?'Your declared profile context is included in Gemini requests.':'Profile context stays in this browser unless you separately opt in to share it with Gemini.'}>{includeProfileWithGemini&&hasProfile(profile)?'Profile shared with Gemini':'Profile stays local'}</span><button type="button" className="text-button" onClick={()=>setPanel('profile')}>Context</button><label className="thread-save-control" title="Saved local conversations can include personal details. Photos and profile fields are not saved."><input type="checkbox" checked={rememberConversation} disabled={messages.length===0} onChange={event=>changeConversationSaving(event.target.checked)}/><span>Save chat</span></label>
       </div>
      </section>
       <details className="advanced-inspector" ref={inspectorRef}><summary><span><Settings2 size={16}/> Evidence & package details</span><span className="badge neutral">{pkg.observations.length} label observations{audit.sources.length ? ` · ${audit.sources.length} sources` : ''}</span><ChevronDown size={16}/></summary><div className="advanced-inspector-content">
      <section className="sources-section package-review-section" aria-label="Interpreted package details">
       {remoteCandidates.length>0&&<GeminiPackageInterpretation candidates={remoteCandidates} nutrition={interpretedNutrition} audit={audit}/>}
       <ThreadPackageLabelDetails pkg={pkg} canInspect={canInspectOcrRegion} isInspecting={observation=>ocrRegionBusy===observation.id} onInspect={observation=>void inspectOcrRegion(observation)} ocrSideLabel={observation=>{const index=images.findIndex(image=>image.id===observation.imageId);return index>=0?`OCR · side ${index+1}`:`OCR · ${observation.side} side`;}}/>
      </section>
     <section className="sources-section" aria-label="Sources and package observations">{audit.sources.length>0&&<div className="section-heading"><h2>Sources</h2><span className="badge neutral">{audit.sources.length}</span></div>}{audit.sources.map(s=><details className="source-row" key={s.id}><summary><BookOpen size={18}/><div><strong>{s.title}</strong><span>{s.publisher} · {s.jurisdiction} · {s.category}</span></div><ChevronDown size={17}/></summary><div className="source-content"><p>{s.summary}</p><p className="fine-print">Published: {s.publishedAt??'not established'} · Effective: {s.effectiveAt??'not established'} · Retrieved: {new Date(s.retrievedAt).toLocaleDateString('en-IN')}</p><p>{s.limitations}</p><a href={s.url} target="_blank" rel="noreferrer">Read original source ↗</a></div></details>)}<details className="source-row"><summary><FileText size={18}/><div><strong>Raw OCR text & corrections</strong><span>{allOcrLineObservations.length} OCR lines{correctionObservations.length?` · ${correctionObservations.length} user corrections`:''}</span></div><ChevronDown size={17}/></summary><div className="source-content"><details className="details-block"><summary>Full OCR transcript<ChevronDown size={16}/></summary><pre>{pkg.rawText}</pre></details><div className="observations-list">{correctionLedger}{ocrLineObservations.map(o=>{const canInspect=canInspectOcrRegion(o);return <div className="observation-entry" key={o.id} data-observation-id={o.id}><p><span>{images.findIndex(image=>image.id===o.imageId)>=0?`Side ${images.findIndex(image=>image.id===o.imageId)+1} · OCR`:`${o.side} side · OCR`}</span><span className="ocr-line-text">{o.text}</span></p>{canInspect&&<button className="text-button inspect-region-button" disabled={ocrRegionBusy===o.id} onClick={()=>void inspectOcrRegion(o)}>{ocrRegionBusy===o.id?'Preparing photo…':'Inspect photo region'}</button>}</div>;})}</div><small>OCR text can be incomplete or wrong. Inspect a photo region to compare a reading with the package.</small>{hasAdditionalOcrLines&&<button className="text-button" type="button" aria-expanded={showAllOcrObservations} onClick={()=>setShowAllOcrObservations(value=>!value)}>{showAllOcrObservations?'Show fewer OCR lines':`Show all ${allOcrLineObservations.length} OCR lines`}</button>}<button className="text-button" type="button" onClick={exportReport}><Download size={15}/>Export evidence report</button></div></details></section>
<details className="research-section" ref={sourceRef}><summary><Search size={16}/> Find products or sources <ChevronDown size={15}/></summary><div className="inspector-research-content">
       {pkg.identityConflict&&<p className="remote-status" role="status">Package identity is disputed across the supplied evidence. Catalog comparisons are paused. Start a new investigation with photos of one matching package to compare label values.</p>}
       <div className="research-controls"><label className="search-input"><Search size={18}/><span className="sr-only">Public search terms</span><input ref={lookupInputRef} value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="Product name, ingredient, question, or barcode" maxLength={300}/></label><select aria-label="Research topic" value={topic} onChange={e=>setTopic(e.target.value)}><option value="science">Scientific literature</option><option value="regulation">Indian regulation</option><option value="claims">Package claims</option><option value="brand">Brand & reviews</option><option value="recalls">US recall records</option></select></div>
        <div className="lookup-actions"><button className="secondary-button" disabled={!!remoteBusy||!lookup.trim()} onClick={()=>remote('products')}><Search size={16}/>Find product</button><button className="secondary-button" disabled={!!remoteBusy||!lookup.trim()} onClick={()=>remote('research')}><BookOpen size={16}/>Research sources</button><button className="secondary-button" disabled={!!remoteBusy||!lookup.trim()} title={profile.country.trim()?`Filter community-catalog candidates by ${profile.country}; this does not confirm local stock.`:'Search community-catalog candidates without a country filter.'} onClick={()=>remote('products',true)}><Leaf size={16}/>{profile.country.trim()?`Candidate tags: ${profile.country}`:'Search product candidates'}</button><button className="text-button" disabled={!!remoteBusy||!lookup.trim()} onClick={()=>remote('semantic')}><FlaskConical size={16}/>Local evidence search</button></div>
      {remoteBusy&&<p className="remote-status" role="status"><LoaderCircle size={16} className="spin"/>Checking {remoteBusy==='products'?'product records':remoteBusy==='semantic'?'the local evidence index':'sources'}…</p>}{remoteNotice&&<p className="remote-status" role="status">{remoteNotice}</p>}
      {research.length>0&&<div className="research-results">{research.map(item=>{const hasMore=item.summary.length>360;const preview=hasMore?`${item.summary.slice(0,360).replace(/\s+\S*$/,'')}…`:item.summary;return <article key={item.id}><span className="eyebrow">{item.category} · published {item.publishedAt??'date unknown'}</span><h3><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a></h3><p>{preview}</p>{hasMore&&<details className="details-block"><summary>Read full abstract or source excerpt</summary><p>{item.summary}</p></details>}<small>{item.publisher}{item.effectiveAt?` · effective ${item.effectiveAt}`:''} · retrieved {new Date(item.retrievedAt).toLocaleDateString('en-IN')}</small><p className="fine-print">{item.limitations}</p></article>;})}</div>}
      {semantic.length>0&&<div className="research-results">{semantic.map((s,i)=><article key={i}><span className="eyebrow">LOCAL EVIDENCE CANDIDATE · NOT A VERDICT</span><h3><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></h3><p>{s.summary}</p><small>{s.publisher} · {s.jurisdiction} · source record retrieved {new Date(s.retrievedAt).toLocaleDateString('en-IN')}</small><p className="fine-print">Limits: {s.limitations}</p></article>)}</div>}
       <details className="provider-details"><summary><Sparkles size={17}/>Advanced Gemini controls<span className="badge neutral">{status.gemini?.enabled?'Available':'Not enabled'}</span><ChevronDown size={16}/></summary><div><p>Analyze starts Gemini automatically when it is available. A real package analysis or follow-up sends ordered OCR evidence, relevant source evidence and deterministic calculations, up to three selected, resized package photos, and up to four recent turns. {geminiTierDisclosure} Your optional profile stays local unless you separately select its inclusion.</p><label className="check-label"><input type="checkbox" checked={includeProfileWithGemini} disabled={!cloudMode||!hasProfile(profile)} onChange={event=>setIncludeProfileWithGemini(event.target.checked)}/>Also include my optional profile context with Gemini requests.</label><label className="field-label">Photo for explicit image inspection<select value={visionImageId} onChange={e=>setVisionImageId(e.target.value)}>{images.map((image,index)=><option key={image.id} value={image.id}>Photo {index+1}: {image.role==='unknown'?image.name:image.role}</option>)}</select></label><div className="lookup-actions"><button className="secondary-button" onClick={()=>gemini()} disabled={!cloudMode||!status.gemini?.enabled||!!remoteBusy}>Run interpretation again</button><button className="secondary-button" onClick={()=>gemini(true)} disabled={!cloudMode||!status.gemini?.enabled||!images.length||!!remoteBusy}>Inspect an original image</button></div><small>Provider keys and request limits stay on the server. A request already sent may finish after switching to local-only mode.</small></div></details>
      {inspection&&<div className="notice"><CircleHelp size={17}/><div><strong>Gemini requested a closer look.</strong><p>{inspection.reason}</p><p>{inspection.crop?"Only the requested crop will be sent from the browser.":"The requested session image will be sent."}</p><button className="secondary-button" disabled={!cloudMode||!!remoteBusy} onClick={()=>gemini(true)}>Send requested image region</button><button className="text-button" onClick={()=>setInspection(null)}>Dismiss request</button></div></div>}
     </div></details>
      </div></details>
    </>}
    <footer><span><Leaf size={14}/>A little more informed, one label at a time.</span><button onClick={()=>setPanel('privacy')}>How your data is used<ArrowRight size={13}/></button></footer>
   </main>
  </div>
  <dialog ref={dialog} className={panel==='scanner'?'scanner-dialog':panel==='onboarding'?'onboarding-dialog':undefined} onChangeCapture={()=>{if(panel==='profile'||panel==='onboarding')profileTouched.current=true;}} onCancel={event=>{if(panel==='scanner'){event.preventDefault();cancelScanner();}else if(panel==='camera'){event.preventDefault();setPanel('scanner');}else if(panel==='onboarding')event.preventDefault();}} onClose={()=>{setPanel(null);setOcrRegion(null);}} onClick={e=>{if(e.target===dialog.current){if(panel==='scanner')cancelScanner();else if(panel==='camera')setPanel('scanner');else if(panel!=='onboarding')setPanel(null);}}} onKeyDown={e=>{if(e.key!=='Tab')return;const focusable=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[href],[tabindex]:not([tabindex="-1"])')).filter(node=>node.offsetParent!==null);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}} aria-labelledby={panel==='scanner'?'scanner-dialog-title':'dialog-title'}><div className="dialog-header"><h2 id="dialog-title">{panel==='onboarding'?'Make NutriScan yours':panel==='profile'?'Your context, on your terms':panel==='privacy'?'Your data, clearly explained':panel==='history'?'Recent scans':panel==='correct'?'Correct a decisive reading':panel==='ocr-region'?'Inspect OCR photo region':panel==='camera'?'Capture a package side':panel==='scanner'?'Scan package sides':'Read a label from text'}</h2>{panel!=='onboarding'&&<button className="icon-button" aria-label={panel==='scanner'?'Cancel scan':panel==='camera'?'Back to scanner':'Close dialog'} onClick={()=>panel==='scanner'?cancelScanner():panel==='camera'?setPanel('scanner'):setPanel(null)}><X size={20}/></button>}</div>
   {panel==='onboarding'&&<div className="dialog-body onboarding-body">
    <p>Choose what you want help with first. Everything else below is optional, including health information. Your context is used for your package analysis in this browser; it is not sent to Gemini unless you separately opt in.</p>
    <fieldset className="onboarding-goals"><legend>What should NutriScan focus on?</legend>{onboardingGoalOptions.map(option=><label className="onboarding-choice" key={option.id}><input type="radio" name="onboarding-goal" value={option.id} checked={onboardingGoalChoice===option.id} onChange={()=>setOnboardingGoalChoice(option.id)}/><span>{option.label}</span></label>)}</fieldset>
    {onboardingGoalChoice==='custom'&&<label className="field-label onboarding-custom-goal">Your focus<textarea rows={2} maxLength={1000} value={onboardingCustomGoal} onChange={event=>setOnboardingCustomGoal(event.target.value)} placeholder="In your own words" autoFocus/></label>}
    <details className="details-block onboarding-context"><summary>Add optional context<ChevronDown size={16}/></summary>
     <label className="field-label">Dietary pattern or preferences<textarea rows={2} maxLength={500} value={profile.dietaryPattern} onChange={event=>setProfile({...profile,dietaryPattern:event.target.value})} placeholder="Optional"/></label>
     <label className="field-label">Ingredients or foods to avoid<textarea rows={2} maxLength={1000} value={profile.avoidedIngredients} onChange={event=>setProfile({...profile,avoidedIngredients:event.target.value})} placeholder="Optional; separate entries with commas"/></label>
     <label className="field-label">Allergies<textarea rows={2} maxLength={1000} value={profile.allergies} onChange={event=>setProfile({...profile,allergies:event.target.value})} placeholder="Optional; separate entries with commas"/></label>
     <label className="field-label">Intolerances<textarea rows={2} maxLength={1000} value={profile.intolerances} onChange={event=>setProfile({...profile,intolerances:event.target.value})} placeholder="Optional; separate entries with commas"/></label>
     <label className="field-label">Portion preferences<textarea rows={2} maxLength={500} value={profile.portionPreferences} onChange={event=>setProfile({...profile,portionPreferences:event.target.value})} placeholder="Optional; for example, how you like amounts compared"/></label>
     <label className="field-label">Health considerations or guidance<textarea rows={2} maxLength={1500} value={profile.healthConsiderations} onChange={event=>setProfile({...profile,healthConsiderations:event.target.value})} placeholder="Optional; only if it helps your questions"/></label>
     <label className="field-label">Country or region<input value={profile.country} maxLength={80} onChange={event=>setProfile({...profile,country:event.target.value})} placeholder="Optional; helps with local sources"/></label>
    </details>
    <label className="save-toggle profile-memory-toggle"><input type="checkbox" checked={rememberProfile} disabled={profileSaving} onChange={event=>setRememberProfile(event.target.checked)}/><div><strong>Remember this context on this device</strong><small>Off by default: context stays in this tab for the session. If enabled, it is stored separately from scans on this device; it is not encrypted or synced. Your profile is never sent to Gemini unless you separately opt in.</small></div></label>
    <div className="dialog-actions"><span className="fine-print">You can update or clear this context later.</span><button className="primary-button" type="button" disabled={profileSaving||!onboardingGoalChoice||(onboardingGoalChoice==='custom'&&!onboardingCustomGoal.trim())} onClick={()=>void finishOnboarding()}>{profileSaving?'Saving…':'Continue'}<ArrowRight size={16}/></button></div>
   </div>}
   {panel==='scanner'&&<div className="scanner-workspace"><h2 className="sr-only" id="scanner-dialog-title">Scan package sides</h2>
    <div className="scanner-workspace-header"><div><span>PACKAGE SCAN</span><strong>{images.length?images.length+' side'+(images.length===1?'':'s')+' ready':'Add a package side'}</strong></div><button type="button" className="scanner-close" aria-label="Cancel scan" onClick={cancelScanner}><X size={20}/></button></div>
    <div className="scanner-canvas-area">
     {images.length>0&&images.some(image=>image.id===scannerActiveImageId)?(()=>{const image=images.find(item=>item.id===scannerActiveImageId)!;const index=images.findIndex(item=>item.id===image.id);return <PackagePhotoCard key={image.id} asset={image} index={index} busy={busy||photoEditBusy} onTransform={commitPhotoEdit} onUndo={undoPhotoEdit} onRedo={redoPhotoEdit} onRemove={removePhoto} onReplace={(id,file)=>void replaceImage(id,file)} onError={setError}/>;})():<div className="scanner-empty-canvas"><ImagePlus size={32}/><strong>Add the front, nutrition panel or ingredients.</strong><span>Photos stay on this device until you choose Analyze.</span><label className="primary-button"><ImagePlus size={17}/>Add side<input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Choose package sides" disabled={images.length>=10} onChange={event=>{void addFiles(event.target.files);event.target.value='';}}/></label></div>}
    </div>
    <div className="scanner-bottom-bar">
     <div className="scanner-thumbnail-strip" role="group" aria-label="Package sides">{images.map((image,index)=><button key={image.id} type="button" className={image.id===scannerActiveImageId?'scanner-thumbnail active':'scanner-thumbnail'} aria-pressed={image.id===scannerActiveImageId} aria-label={'Select side '+(index+1)} onClick={()=>setScannerActiveImageId(image.id)}><img src={image.url} alt=""/><span>Side {index+1}</span></button>)}<label className="scanner-add-side"><ImagePlus size={18}/><span>Add side</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Add package side from files" disabled={images.length>=10} onChange={event=>{void addFiles(event.target.files);event.target.value='';}}/></label><button type="button" className="scanner-camera-action" onClick={()=>{setCameraError('');setPanel('camera');}} disabled={busy||images.length>=10}><Camera size={18}/><span>Camera</span></button></div>
     <div className="scanner-save-row"><span>Original photos remain available for reset.</span><div><button type="button" className="text-button" onClick={cancelScanner}>Cancel</button><button type="button" className="secondary-button" onClick={()=>saveScanner(false)} disabled={!images.length}>Save scan</button><button type="button" className="primary-button" onClick={()=>saveScanner(true)} disabled={!images.length}>Done<Check size={16}/></button></div></div>
    </div>
   </div>}
   {panel==='camera'&&<div className="dialog-body camera-capture-dialog"><p>Take a clear photo of one package side. The camera preview and captured image stay in this browser until you choose Analyze after reviewing the Gemini disclosure.</p>{cameraError?<p className="notice error" role="status">{cameraError}</p>:<div className="live-camera-frame"><video ref={cameraVideo} autoPlay muted playsInline aria-label="Live camera preview of the package"/><span>Keep the label flat, bright and inside the frame.</span></div>}<div className="camera-capture-actions"><button type="button" className="primary-button" onClick={()=>void addCameraCapture()} disabled={!!cameraError||images.length>=10}><Camera size={17}/>Capture this side</button><label className="upload-label"><ImagePlus size={17}/>Choose a photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Choose or take a package photo" disabled={images.length>=10} onChange={event=>{if(event.target.files?.[0])void addFiles(event.target.files);event.target.value='';setPanel('scanner');}}/></label><button type="button" className="text-button" onClick={()=>setPanel('scanner')}>Back to scan</button></div><small>Camera access is requested only after you press Open camera. No audio is captured.</small></div>}
   {panel==='profile'&&<div className="dialog-body"><p>Skip anything that does not help. Context guides local package audits. Gemini receives your profile only if you separately opt in under Advanced Gemini controls; package analysis consent does not include profile data.</p><label className="field-label">Dietary pattern or preferences<textarea value={profile.dietaryPattern} onChange={e=>setProfile({...profile,dietaryPattern:e.target.value})} placeholder="Optional" maxLength={500} rows={2}/></label><label className="field-label">Ingredients or foods to avoid<textarea value={profile.avoidedIngredients} onChange={e=>setProfile({...profile,avoidedIngredients:e.target.value})} placeholder="Optional; separate entries with commas" maxLength={1000} rows={2}/></label><label className="field-label">Food allergies<textarea value={profile.allergies} onChange={e=>setProfile({...profile,allergies:e.target.value})} placeholder="Optional; exact terms, separated by commas" maxLength={1000} rows={2}/></label><label className="field-label">Food intolerances<textarea value={profile.intolerances} onChange={e=>setProfile({...profile,intolerances:e.target.value})} placeholder="Optional; separate entries with commas" maxLength={1000} rows={2}/></label><label className="field-label">Portion preferences<textarea value={profile.portionPreferences} onChange={e=>setProfile({...profile,portionPreferences:e.target.value})} placeholder="Optional; how you prefer amounts compared" maxLength={500} rows={2}/></label><label className="field-label">What are you trying to understand?<textarea value={profile.goals} onChange={e=>setProfile({...profile,goals:e.target.value})} placeholder="For example, a label claim, a nutrient, or a product alternative" maxLength={1000} rows={2}/></label><p className="fine-print">Health and dietary details are optional user statements. Label text cannot establish individual medical safety or rule out synonyms, derivatives or cross-contact.</p><label className="field-label">Health considerations or professional guidance<textarea value={profile.healthConsiderations} onChange={e=>setProfile({...profile,healthConsiderations:e.target.value})} placeholder="Optional; use your own words" maxLength={1500} rows={3}/></label><details className="details-block"><summary>More context, only when relevant<ChevronDown size={16}/></summary><div className="form-row"><label className="field-label">Age group<input value={profile.ageGroup} maxLength={80} onChange={e=>setProfile({...profile,ageGroup:e.target.value})} placeholder="Optional"/></label><label className="field-label">Sex or reference group<input value={profile.sexOrReferenceGroup} maxLength={100} onChange={e=>setProfile({...profile,sexOrReferenceGroup:e.target.value})} placeholder="Only if relevant to a source"/></label></div><div className="form-row"><label className="field-label">Country<input value={profile.country} maxLength={80} onChange={e=>setProfile({...profile,country:e.target.value})} placeholder="Optional"/></label><label className="field-label">City or PIN<input value={profile.locality} maxLength={100} onChange={e=>setProfile({...profile,locality:e.target.value})} placeholder="Only for local research"/></label></div></details><label className="save-toggle profile-memory-toggle"><input type="checkbox" checked={rememberProfile} disabled={!profileReady||profileSaving||(!rememberProfile&&!hasProfile(profile))} onChange={e=>void chooseRememberedProfile(e.target.checked)}/><div><strong>Remember this context on this device</strong><small>Stored separately from scans and conversations; not encrypted or synced. Turn this off to remove the saved copy while keeping this tab's session context.</small></div></label><div className="dialog-actions"><button className="text-button" disabled={!profileReady||profileSaving} onClick={clearProfileContext}>Clear context</button><button className="primary-button" disabled={!profileReady||profileSaving} onClick={()=>setPanel(null)}>Use for this session<Check size={16}/></button></div></div>}
   {panel==='privacy'&&<div className="dialog-body privacy-body"><div><LockKeyhole/><h3>Photos stay here by default</h3><p>OCR runs in browser workers. Photos are held for this session and released when removed or a new scan begins. English Tesseract assets are served locally after setup. If the first read leaves important label fields unresolved, a secondary PP-OCRv6-small model may load from Paddle’s model host on first use; the browser benchmark measured about 71 MB across unique model, runtime, and OCR bundle assets, with actual transfer varying by browser and cache. The model runs in your browser Package photos stay local during OCR. Choosing Analyze after the nearby disclosure sends recognized text and up to three selected, resized images to Gemini when available; choose local-only mode in Advanced settings to keep them here.</p></div><div><History/><h3>You choose what is saved</h3><p>“Keep this scan” stores extracted text, calculation inputs and corrections in this browser’s IndexedDB. It does not save photos or profile fields. A separate opt-in stores context on this device, separately from scans and conversations; anyone with access to this browser profile can read it. It is not encrypted or synced, and you can remove it in Optional context. A further opt-in saves up to 30 recent conversation turns on this device; questions may contain personal details and answers may include Gemini-generated content. Saved turns exclude photos and profile fields. Anyone with access to this browser profile may read saved scans and conversations. No encryption or cloud sync is claimed.</p></div><div><Search/><h3>Public research is a separate action</h3><p>In cloud mode, Gemini may make bounded read-only searches of Open Food Facts, Europe PMC or supported official sources using words from the current question or package text. These services receive query terms only, never photos or profile data. When configured, Google Search grounding may also be used for an evidence question only if no profile or prior conversation is included; the query is generated from the question and package evidence, and NutriScan disables this tool when profile or prior-turn context is present. Google-grounded wording is model-generated and not source text independently reviewed by NutriScan. Results are candidates, not confirmed package facts. Manual product lookup may also include the selected country. Do not place personal health details in a public search query.</p></div><div><Sparkles/><h3>Gemini cloud analysis is currently {status.gemini?.enabled?'available':'unavailable'}</h3><p>Cloud analysis begins when you choose Analyze after its disclosure. If available, real package scans and follow-up questions send OCR observations, the current question, recent turns and up to three selected, locally resized photos to Google Gemini. Your profile stays in this browser unless you separately opt in under Advanced Gemini controls. A requested close-up remains an explicit action. {geminiTierDisclosure} No raw request or health logs are intentionally recorded by this app.</p></div><p>JSON exports include extracted label text, user-provided product details, observations, image/crop processing metadata and cited evidence. They exclude private profile text and original images. Review exports before sharing.</p><button className="secondary-button" onClick={()=>setPanel(null)}>Back to scanner</button></div>}
   {panel==='ocr-region'&&ocrRegion&&<div className="dialog-body ocr-region-dialog"><p>This preview rebuilds the prepared image used for this reading and stays in your browser. The red outline marks where OCR placed the line; it does not verify the text or its meaning.</p><p className="ocr-region-line"><strong>Recorded OCR text:</strong> “{ocrRegion.text}”{ocrRegion.confidence!==null&&<small>OCR recognition score: {Math.round(ocrRegion.confidence)}% · not factual certainty</small>}</p><div className="ocr-region-preview"><img src={ocrRegion.url} alt="Prepared package photo with the OCR line region outlined"/><svg viewBox={`0 0 ${ocrRegion.width} ${ocrRegion.height}`} preserveAspectRatio="none" aria-hidden="true"><rect x={ocrRegion.bbox.x0} y={ocrRegion.bbox.y0} width={Math.max(1,ocrRegion.bbox.x1-ocrRegion.bbox.x0)} height={Math.max(1,ocrRegion.bbox.y1-ocrRegion.bbox.y0)}/></svg></div><small>The original photo is not uploaded by this local inspection.</small></div>}
   {panel==='text'&&<div className="dialog-body"><p>Paste the ingredient list and nutrition table with its units and “per 100 g / per serving” heading. This stays in your browser.</p><label className="field-label">Label text<textarea rows={13} value={rawText} onChange={e=>setRawText(e.target.value)} maxLength={40000} placeholder="Nutrition information per 100 g…"/></label><button className="primary-button" onClick={analyzeText} disabled={rawText.trim().length<8}>Read label text<ArrowRight size={17}/></button></div>}
   {panel==='correct'&&<div className="dialog-body"><p>Use the actual label to correct an important figure. Original observations remain available; the selected nutrient uses your correction.</p><label className="field-label">Product name (optional correction)<input value={correction.name} maxLength={200} placeholder={pkg?.name} onChange={e=>setCorrection({...correction,name:e.target.value})}/></label><div className="form-row"><label className="field-label">Nutrient<select value={correction.key} onChange={e=>{const key=e.target.value as NutrientKey;const nutrientBasis=pkg?.nutrients.find(item=>item.key===key&&item.basis)?.basis;const basisAmount=nutrientBasis?.amount;const basisUnit=nutrientBasis?.unit;setCorrection(previous=>({...previous,key,unit:key==='sodium'?'mg':key==='energy'?'kcal':'g',basis:basisAmount?String(basisAmount):'',basisUnit:basisUnit??''}));}}>{nutrientKeys.map(k=><option value={k} key={k}>{nutrientLabel[k]}</option>)}</select></label><label className="field-label">Label value<input type="number" min={0} value={correction.value} onChange={e=>setCorrection({...correction,value:e.target.value})}/></label></div><div className="form-row"><label className="field-label">Nutrient unit<select value={correction.unit} onChange={e=>setCorrection({...correction,unit:e.target.value})}>{(correction.key==='energy'?['kcal','kJ']:correction.key==='sodium'||correction.key==='salt'?['g','mg']:['g']).map(u=><option key={u}>{u}</option>)}</select></label><label className="field-label">Per amount<input type="number" min={1} max={10000} value={correction.basis} onChange={e=>setCorrection({...correction,basis:e.target.value})}/></label><label className="field-label">Basis unit<select required value={correction.basisUnit} onChange={e=>setCorrection({...correction,basisUnit:e.target.value as ''|'g'|'ml'})}><option value="">Choose unit</option><option value="g">g</option><option value="ml">ml</option></select></label></div><button className="primary-button" onClick={correct}>Recalculate with correction<Check size={16}/></button></div>}
   {panel==='history'&&<div className="dialog-body">{history.length===0?<div className="history-empty"><History size={32}/><h3>A clean slate.</h3><p>Saved scans appear here only after you opt in to keeping a scan or its conversation.</p></div>:<><p>Saved label text and product details on this browser. Original images and optional health context are not stored. Saved local turns appear when available; a saved scan never restores a personal profile.</p>{history.map(scan=><button className="history-row" key={scan.id} onClick={()=>reopenSavedScan(scan)}><span className="history-icon"><ScanLine size={21}/></span><div><strong>{scan.name}</strong><small>{new Date(scan.createdAt).toLocaleString('en-IN')} · {scan.package.synthetic?'synthetic example':'saved label'}{scan.conversation?.length?` · ${scan.conversation.length} local turns`:''}</small></div><ChevronRight size={17}/></button>)}<button className="text-button destructive" onClick={async()=>{await clearHistory();setHistory([]);setRemember(false);setRememberConversation(false);setNotice('Saved scans and conversations cleared from this browser. Any exported files remain where you saved them.');setPanel(null);}}><Trash2 size={16}/>Clear saved history and conversations</button></>}</div>}
  </dialog>
 </div>;
}

function optionalNumber(text:string,max:number){if(text==='')return null;const n=Number(text);return Number.isFinite(n)&&n>0?Math.min(max,n):null;}
