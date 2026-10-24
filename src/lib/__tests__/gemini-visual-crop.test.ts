import { describe, expect, it } from 'vitest';
import type { Observation, OcrCapture } from '../contracts';
import { canAddGeminiVisualImage, geminiImageScale, MAX_GEMINI_VISUAL_IMAGE_BYTES, selectBestLabelCropSet, suggestDenseTextCrops, suggestLabelDetailCrop, suggestSpatialLabelCrops } from '../gemini-visual-crop';

function capture(rotation: OcrCapture['processing']['rotation'] = 0, cropPercent: OcrCapture['processing']['cropPercent'] = null, runId='run-1'): OcrCapture {
  const rotated = rotation === 90 || rotation === 270;
  return {
    runId, imageId: 'photo-1', side: 'back',
    sourceImage: { width: 1000, height: 500 },
    preparedImage: rotated ? { width: 300, height: 800 } : { width: 800, height: 300 },
    bboxCoordinateSpace: 'prepared-image-pixels',
    engine: { name: 'test', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
    processing: { rotation, contrast: false, invert: false, cropPercent },
  };
}

function line(id: string, text: string, bbox: Observation['bbox'], imageId = 'photo-1', runId='run-1'): Observation {
  return { id, field: 'ocr-line', text, side: 'back', confidence: 70, bbox, origin: 'ocr', imageId, readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 0 } };
}

describe('OCR-guided Gemini detail region', () => {
  it('keeps an optional crop within the server aggregate image-byte ceiling', () => {
    expect(canAddGeminiVisualImage(MAX_GEMINI_VISUAL_IMAGE_BYTES - 1000, 1000)).toBe(true);
    expect(canAddGeminiVisualImage(MAX_GEMINI_VISUAL_IMAGE_BYTES - 999, 1000)).toBe(false);
    expect(canAddGeminiVisualImage(-1, 1)).toBe(false);
  });

  it('upsamples only focused model views within a maximum edge and never scales original photos above source size',()=>{
    expect(geminiImageScale(232,108,2000,3)).toBe(3);
    expect(geminiImageScale(900,363,2000,3)).toBeCloseTo(2000/900);
    expect(geminiImageScale(900,363,2000,1)).toBe(1);
    expect(geminiImageScale(0,363,2000,3)).toBe(1);
  });

  it('selects a compact label block and maps prepared pixels to the original image', () => {
    const result = suggestLabelDetailCrop(capture(), [
      line('header', 'NUTRITIONAL INFORMATION', { x0: 80, y0: 35, x1: 410, y1: 58 }),
      line('row', 'Energy 125 kcal Carbohydrates 62 g', { x0: 78, y0: 64, x1: 710, y1: 91 }),
      line('ingredients', 'INGREDIENTS: WHEAT FLOUR (MAIDA)', { x0: 270, y0: 96, x1: 710, y1: 122 }),
      line('other-side', 'Protein 99g', { x0: 40, y0: 30, x1: 180, y1: 60 }, 'photo-2'),
    ]);

    expect(result).not.toBeNull();
    expect(result!.preparedRect.x0).toBeGreaterThan(0);
    expect(result!.preparedRect.y0).toBe(24);
    expect(result!.preparedRect.y1).toBeGreaterThan(122);
    expect(result!.originalRegion.x).toBeGreaterThan(0);
    expect(result!.originalRegion.y).toBeGreaterThan(0);
    expect(result!.originalRegion.width * result!.originalRegion.height).toBeLessThan(0.85);
  });

  it('maps rotated and manually cropped OCR coordinates back to source-image space', () => {
    const result = suggestLabelDetailCrop(capture(90, { x: 10, y: 20, width: 80, height: 60 }), [
      line('header', 'NUTRITIONAL INFORMATION', { x0: 30, y0: 80, x1: 150, y1: 110 }),
      line('row', 'Protein 8 g per 100 g', { x0: 32, y0: 120, x1: 155, y1: 150 }),
    ]);

    expect(result).not.toBeNull();
    expect(result!.originalRegion.x).toBeGreaterThanOrEqual(0.1);
    expect(result!.originalRegion.x + result!.originalRegion.width).toBeLessThanOrEqual(0.9);
    expect(result!.originalRegion.y).toBeGreaterThanOrEqual(0.2);
    expect(result!.originalRegion.y + result!.originalRegion.height).toBeLessThanOrEqual(0.8);
    expect(result!.originalRegion.x).toBeLessThan(0.34);
    expect(result!.originalRegion.y).toBeLessThan(0.5);
  });

  it('separates adjacent nutrition and ingredient columns from word geometry',()=>{
    const packageCapture={...capture(),sourceImage:{width:900,height:363},preparedImage:{width:2700,height:1089}};
    const word=(wordIndex:number,text:string,bbox:NonNullable<Observation['bbox']>)=>({wordIndex,text,confidence:80,bbox});
    const mixedHeader:Observation={...line('mixed-header','NUTRITIONAL INFORMATION INGREDIENTS: REFINED WHEAT FLOUR',{x0:559,y0:109,x1:2316,y1:142}),ocrWords:[
      word(0,'NUTRITIONAL',{x0:559,y0:110,x1:866,y1:137}),word(1,'INFORMATION',{x0:559,y0:110,x1:866,y1:137}),
      word(2,'INGREDIENTS:',{x0:1091,y0:109,x1:2316,y1:142}),word(3,'REFINED',{x0:1091,y0:109,x1:2316,y1:142}),word(4,'WHEAT',{x0:1091,y0:109,x1:2316,y1:142}),
    ]};
    const mixedRow:Observation={...line('mixed-row','CARBOHYDRATES 69.29g 9.28g WHEAT FLOUR',{x0:380,y0:210,x1:2319,y1:260}),ocrWords:[
      word(0,'CARBOHYDRATES',{x0:380,y0:222,x1:541,y1:256}),word(1,'69.29g',{x0:687,y0:223,x1:759,y1:260}),
      word(2,'9.28g',{x0:823,y0:224,x1:885,y1:259}),word(3,'WHEAT',{x0:1087,y0:210,x1:2319,y1:248}),word(4,'FLOUR',{x0:1087,y0:210,x1:2319,y1:248}),
    ]};
    const spanningRow:Observation={...line('spanning-row','CARBOHYDRATES DOUGH CONDITIONER',{x0:380,y0:210,x1:2319,y1:260}),ocrWords:[
      word(0,'CARBOHYDRATES',{x0:380,y0:210,x1:2319,y1:260}),word(1,'DOUGH',{x0:380,y0:210,x1:2319,y1:260}),
    ]};
    const regions=suggestSpatialLabelCrops(packageCapture,[mixedHeader,mixedRow,spanningRow]);
    expect(regions.map(region=>region.regionRole)).toEqual(['nutrition-table','ingredients']);
    expect(regions[0].preparedRect.x1).toBeLessThan(regions[1].preparedRect.x1);
    expect(regions[0].originalRegion.x).toBeGreaterThanOrEqual(0);
    expect(regions[1].originalRegion.x+regions[1].originalRegion.width).toBeLessThanOrEqual(1);
    expect(regions[0].originalRegion.x+regions[0].originalRegion.width).toBeLessThan(0.5);
    expect(regions[1].originalRegion.x).toBeGreaterThan(0.35);
  });

  it('uses spatial heading boxes when OCR merges or imperfectly recognizes heading tokens',()=>{
    const packageCapture={...capture(),sourceImage:{width:900,height:363},preparedImage:{width:2700,height:1089}};
    const word=(wordIndex:number,text:string,bbox:NonNullable<Observation['bbox']>)=>({wordIndex,text,confidence:65,bbox});
    const header:Observation={...line('noisy-header','NUTRITIONALINFORMATION INGREDIENTS:REFINED WHEAT FLOUR',{x0:559,y0:109,x1:2316,y1:142}),ocrWords:[
      word(0,'NUTRITIONALINFORMATION',{x0:559,y0:110,x1:866,y1:137}),
      word(1,'INGREDIENTS:REFINED',{x0:1091,y0:109,x1:1510,y1:142}),
    ]};
    const row:Observation={...line('noisy-row','CARBOHYDRATES 69.29g 9.28g DOUGH CONDITIONER',{x0:380,y0:210,x1:2319,y1:260}),ocrWords:[
      word(0,'CARBOHYDRATES',{x0:380,y0:222,x1:541,y1:256}),word(1,'69.29g',{x0:687,y0:223,x1:759,y1:260}),
      word(2,'9.28g',{x0:823,y0:224,x1:885,y1:259}),word(3,'DOUGHCONDITIONER',{x0:1090,y0:210,x1:1600,y1:248}),
    ]};

    const regions=suggestSpatialLabelCrops(packageCapture,[header,row]);
    expect(regions.map(region=>region.regionRole)).toEqual(['nutrition-table','ingredients']);
    expect(regions[0].originalRegion.x+regions[0].originalRegion.width).toBeLessThan(regions[1].originalRegion.x);
  });

  it('chooses a reader run with separated package regions over a newer broad mixed-text crop',()=>{
    const sourceImage={width:900,height:363};
    const preparedImage={width:2700,height:1089};
    const tesseractCapture={...capture(0,null,'tesseract-run'),sourceImage,preparedImage};
    const paddleCapture={...capture(0,null,'paddle-run'),sourceImage,preparedImage};
    const broadLines=[
      line('t-head','NUTRITIONAL INFORMATION INGREDIENTS: REFINED WHEAT FLOUR',{x0:559,y0:109,x1:2316,y1:142},'photo-1','tesseract-run'),
      line('t-row','CARBOHYDRATES 69.29 g 9.28 g DOUGH CONDITIONER',{x0:380,y0:210,x1:2319,y1:260},'photo-1','tesseract-run'),
    ];
    const word=(wordIndex:number,text:string,bbox:NonNullable<Observation['bbox']>)=>({wordIndex,text,confidence:80,bbox});
    const separatedLines:Observation[]=[
      {...line('p-head','NUTRITIONAL INFORMATION INGREDIENTS: REFINED WHEAT FLOUR',{x0:559,y0:109,x1:2316,y1:142},'photo-1','paddle-run'),ocrWords:[
        word(0,'NUTRITIONAL',{x0:559,y0:110,x1:866,y1:137}),word(1,'INFORMATION',{x0:559,y0:110,x1:866,y1:137}),
        word(2,'INGREDIENTS:',{x0:1091,y0:109,x1:1174,y1:142}),word(3,'REFINED',{x0:1180,y0:109,x1:1280,y1:142}),
      ]},
      {...line('p-row','CARBOHYDRATES 69.29g 9.28g WHEAT FLOUR',{x0:380,y0:210,x1:2319,y1:260},'photo-1','paddle-run'),ocrWords:[
        word(0,'CARBOHYDRATES',{x0:380,y0:222,x1:541,y1:256}),word(1,'69.29g',{x0:687,y0:223,x1:759,y1:260}),
        word(2,'9.28g',{x0:823,y0:224,x1:885,y1:259}),word(3,'WHEAT',{x0:1087,y0:210,x1:1190,y1:248}),
      ]},
    ];
    const selection=selectBestLabelCropSet([tesseractCapture,paddleCapture],[...broadLines,...separatedLines]);
    expect(selection?.capture.runId).toBe('paddle-run');
    expect(selection?.details.map(item=>item.regionRole)).toEqual(['nutrition-table','ingredients']);
  });

  it('uses linked OCR word geometry when a parser-derived line holds the table heading',()=>{
    const packageCapture={...capture(),sourceImage:{width:900,height:363},preparedImage:{width:2700,height:1089}};
    const word=(wordIndex:number,text:string,bbox:NonNullable<Observation['bbox']>)=>({wordIndex,text,confidence:80,bbox});
    const header={...line('ingredient-heading','INGREDIENTS: REFINED WHEAT FLOUR',{x0:1092,y0:111,x1:2314,y1:141}),ocrWords:[
      word(0,'INGREDIENTS:',{x0:1092,y0:111,x1:1270,y1:141}),word(1,'REFINED',{x0:1270,y0:111,x1:1420,y1:141}),
    ]};
    const row={...line('nutrition-row','CARBOHYDRATES 69.29g 9.28g DOUGH CONDITIONER',{x0:380,y0:210,x1:2319,y1:260}),ocrWords:[
      word(0,'CARBOHYDRATES',{x0:380,y0:222,x1:541,y1:256}),word(1,'69.29g',{x0:687,y0:223,x1:759,y1:260}),
      word(2,'9.28g',{x0:823,y0:224,x1:885,y1:259}),word(3,'DOUGH',{x0:1090,y0:210,x1:1240,y1:248}),
    ]};
    const parserLinkedHeading:Observation={...line('basis-heading','table-heading',{x0:559,y0:109,x1:865,y1:135}),field:'basis',ocrWords:[
      word(0,'NUTRITION:',{x0:559,y0:111,x1:865,y1:135}),word(1,'PER100g',{x0:688,y0:191,x1:790,y1:226}),
    ]};
    const regions=suggestSpatialLabelCrops(packageCapture,[header,row,parserLinkedHeading]);
    expect(regions.map(region=>region.regionRole)).toEqual(['nutrition-table','ingredients']);
  });

  it('finds compact label bands from OCR geometry even when every recognized line is noise',()=>{
    const noisy=[
      line('top-1','TT Tee',{x0:80,y0:35,x1:700,y1:47}),
      line('top-2','| itl',{x0:88,y0:50,x1:705,y1:62}),
      line('top-3','A. ~ 019',{x0:90,y0:65,x1:708,y1:77}),
      line('lower-1','EE NE—',{x0:95,y0:200,x1:680,y1:212}),
      line('lower-2','Oo 0.0',{x0:95,y0:215,x1:680,y1:227}),
      line('lower-3','| — A',{x0:95,y0:230,x1:680,y1:242}),
      line('other-photo','NUTRITIONAL INFORMATION',{x0:40,y0:20,x1:700,y1:40},'photo-2'),
    ];
    const crops=suggestDenseTextCrops(capture(),noisy);
    expect(crops).toHaveLength(2);
    expect(crops.every(crop=>crop.regionRole==='label-detail')).toBe(true);
    expect(crops.every(crop=>crop.originalRegion.width*crop.originalRegion.height<0.85)).toBe(true);
    expect(crops.some(crop=>crop.preparedRect.y0<100)).toBe(true);
    expect(crops.some(crop=>crop.preparedRect.y0>150)).toBe(true);
  });

  it('does not turn one isolated unreadable OCR box into an image crop',()=>{
    expect(suggestDenseTextCrops(capture(),[
      line('one-noisy-box','TT',{x0:100,y0:80,x1:250,y1:95}),
    ])).toEqual([]);
  });

  it('abstains when OCR geometry is absent or the supposed crop would be nearly the whole image', () => {
    expect(suggestLabelDetailCrop(capture(), [
      { ...line('no-box', 'NUTRITIONAL INFORMATION', undefined), bbox: undefined },
    ])).toBeNull();

    expect(suggestLabelDetailCrop(capture(), [
      line('full-a', 'Nutrition information', { x0: 0, y0: 0, x1: 800, y1: 150 }),
      line('full-b', 'Energy Protein Fat Sodium per 100 g', { x0: 0, y0: 150, x1: 800, y1: 300 }),
    ])).toBeNull();
  });
});
