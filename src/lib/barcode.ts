export type BarcodeDetection = { rawValue?: string; format?: string };
export type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<BarcodeDetection[]> };
export type BarcodeDetectorProvider = {
  new(options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};
export type BarcodeFallback = (blob: Blob) => Promise<BarcodeDetection[]>;
export type BarcodeReading = { code: string; imageId: string; side: 'front'|'back'|'extra' };

export type OcrGtinCandidate = { code: string; observationIds: string[]; imageIds: string[]; sides: Array<'front'|'back'|'extra'> };

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

/**
 * Finds one checksum-valid product-code candidate in original image OCR lines.
 * This does not establish a decoded package barcode or product identity.
 */
export function findOcrGtinCandidate(
  observations: readonly { id: string; field: string; text: string; origin: string; imageId?: string; side: string }[],
): OcrGtinCandidate | null {
  const byCode = new Map<string, { observationIds: Set<string>; imageIds: Set<string>; sides: Set<'front'|'back'|'extra'> }>();
  for (const observation of observations) {
    if (observation.origin !== 'ocr' || observation.field !== 'ocr-line' || !observation.imageId) continue;
    const line = observation.text.normalize('NFKC');
    if (/\b(?:FSSAI|LIC(?:ENCE|ENSE)?\.?\s*(?:NO\.?|NUMBER|#))\b/iu.test(line)) continue;
    for (const match of line.matchAll(/(?<!\p{N})(\d{8,14})(?!\p{N})/gu)) {
      const code = match[1];
      if (!isValidGtin(code) || !['front', 'back', 'extra'].includes(observation.side)) continue;
      const side = observation.side as 'front'|'back'|'extra';
      const evidence = byCode.get(code) ?? { observationIds: new Set<string>(), imageIds: new Set<string>(), sides: new Set<'front'|'back'|'extra'>() };
      evidence.observationIds.add(observation.id);
      evidence.imageIds.add(observation.imageId);
      evidence.sides.add(side);
      byCode.set(code, evidence);
    }
  }
  if (byCode.size !== 1) return null;
  const [code, evidence] = byCode.entries().next().value!;
  return { code, observationIds: [...evidence.observationIds], imageIds: [...evidence.imageIds], sides: [...evidence.sides] };
}

/** Lazily loads a local ZXing decoder when the browser has no native barcode API. */
async function decodeWithZxing(blob: Blob, bitmapFactory: typeof createImageBitmap = globalThis.createImageBitmap): Promise<BarcodeDetection[]> {
  if (!bitmapFactory || typeof document === 'undefined') return [];
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    bitmap = await bitmapFactory(blob);
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const hints = new Map<typeof DecodeHintType.POSSIBLE_FORMATS | typeof DecodeHintType.TRY_HARDER, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    const result = new BrowserMultiFormatReader(hints).decodeFromCanvas(canvas);
    const format = BarcodeFormat[result.getBarcodeFormat()];
    const formatName = format === 'EAN_13' ? 'ean_13' : format === 'EAN_8' ? 'ean_8' : format === 'UPC_A' ? 'upc_a' : undefined;
    return formatName ? [{ rawValue: result.getText(), format: formatName }] : [];
  } catch {
    // No barcode and decoder failures both fall through to the existing OCR path.
    return [];
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** Uses the native detector where available, with a lazy local decoder as fallback. */
export async function detectRetailBarcodes(blob: Blob, provider?: BarcodeDetectorProvider, bitmapFactory: typeof createImageBitmap = globalThis.createImageBitmap, fallback: BarcodeFallback = (source) => decodeWithZxing(source, bitmapFactory)): Promise<string[]> {
  const detectorProvider=provider??(globalThis as typeof globalThis&{BarcodeDetector?:BarcodeDetectorProvider}).BarcodeDetector;
  const decodeFallback = async () => [...new Set((await fallback(blob)).filter(item=>item.format&&supportedRetailFormats.has(item.format)).map(item=>item.rawValue?.trim()??'').filter(isValidGtin))];
  if(!detectorProvider||!bitmapFactory)return decodeFallback().catch(()=>[]);
  try{
    const formats=(await detectorProvider.getSupportedFormats()).filter(format=>supportedRetailFormats.has(format));
    if(!formats.length)return decodeFallback().catch(()=>[]);
    const bitmap=await bitmapFactory(blob);
    let detected:BarcodeDetection[];
    try{detected=await new detectorProvider({formats}).detect(bitmap);}
    finally{bitmap.close();}
    const valid=[...new Set(detected.filter(item=>item.format&&supportedRetailFormats.has(item.format)).map(item=>item.rawValue?.trim()??'').filter(isValidGtin))];
    return valid.length ? valid : decodeFallback().catch(()=>[]);
  }catch{
    // A platform decoder failure must not prevent local decoding or the OCR path.
    return decodeFallback().catch(()=>[]);
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
  if(detectedCodes.length>1){warnings.push('More than one distinct product barcode was detected across these photos. No single product record was selected; check which package each photo shows.');return {...packageData,barcode:undefined,identityConflict:true,observations,warnings:[...new Set(warnings)]};}
  const detected=detectedCodes[0];
  if(packageData.barcode&&packageData.barcode!==detected){warnings.push('The decoded barcode and printed/OCR barcode disagree. No product record was selected; verify the code on the package.');return {...packageData,barcode:undefined,identityConflict:true,observations,warnings:[...new Set(warnings)]};}
  return {...packageData,barcode:detected,observations,warnings:[...new Set(warnings)]};
}
