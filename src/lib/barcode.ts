export type BarcodeDetection = { rawValue?: string; format?: string };
export type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<BarcodeDetection[]> };
export type BarcodeDetectorProvider = {
  new(options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};
export type BarcodeReading = { code: string; imageId: string; side: 'front'|'back'|'extra' };

const supportedRetailFormats = new Set(['ean_13','ean_8','upc_a']);

/** Validates GTIN/EAN/UPC check digits; it does not prove product identity. */
export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8,12,13,14].includes(value.length)) return false;
  const digits=[...value].map(Number);
  const check=digits.pop()!;
  let sum=0,weight=3;
  for(let i=digits.length-1;i>=0;i--){sum+=digits[i]*weight;weight=weight===3?1:3;}
  return (10-(sum%10))%10===check;
}

/** Uses the optional native detector only; unsupported browsers continue with OCR. */
export async function detectRetailBarcodes(blob: Blob, provider?: BarcodeDetectorProvider, bitmapFactory: typeof createImageBitmap = globalThis.createImageBitmap): Promise<string[]> {
  const detectorProvider=provider??(globalThis as typeof globalThis&{BarcodeDetector?:BarcodeDetectorProvider}).BarcodeDetector;
  if(!detectorProvider||!bitmapFactory)return [];
  try{
    const formats=(await detectorProvider.getSupportedFormats()).filter(format=>supportedRetailFormats.has(format));
    if(!formats.length)return [];
    const bitmap=await bitmapFactory(blob);
    let detected:BarcodeDetection[];
    try{detected=await new detectorProvider({formats}).detect(bitmap);}
    finally{bitmap.close();}
    return [...new Set(detected.filter(item=>item.format&&supportedRetailFormats.has(item.format)).map(item=>item.rawValue?.trim()??'').filter(isValidGtin))];
  }catch{
    // A platform decoder failure must not prevent the local OCR path.
    return [];
  }
}

export function applyBarcodeReadings<T extends { barcode?: string; observations: { id:string;field:string;text:string;side:'front'|'back'|'extra'|'text';confidence:number|null;origin:'ocr'|'barcode'|'user'|'vision'|'fixture';imageId?:string }[]; warnings:string[] }>(packageData:T, readings:BarcodeReading[]):T {
  const uniqueReadings=[...new Map(readings.map(reading=>[`${reading.code}|${reading.imageId}`,reading])).values()];
  if(!uniqueReadings.length)return packageData;
  const detectedCodes=[...new Set(uniqueReadings.map(reading=>reading.code))];
  const observations=[...packageData.observations];
  for(const reading of uniqueReadings){
    if(observations.some(item=>item.origin==='barcode'&&item.imageId===reading.imageId&&item.text===reading.code))continue;
    observations.push({id:`barcode-${crypto.randomUUID()}`,field:'barcode',text:reading.code,side:reading.side,confidence:null,origin:'barcode',imageId:reading.imageId});
  }
  const warnings=[...packageData.warnings];
  if(detectedCodes.length>1){warnings.push('More than one distinct product barcode was detected across these photos. No single product record was selected; check which package each photo shows.');return {...packageData,barcode:undefined,observations,warnings:[...new Set(warnings)]};}
  const detected=detectedCodes[0];
  if(packageData.barcode&&packageData.barcode!==detected){warnings.push('The decoded barcode and printed/OCR barcode disagree. No product record was selected; verify the code on the package.');return {...packageData,barcode:undefined,observations,warnings:[...new Set(warnings)]};}
  return {...packageData,barcode:detected,observations,warnings:[...new Set(warnings)]};
}
