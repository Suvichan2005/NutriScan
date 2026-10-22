import { describe, expect, it, vi } from 'vitest';
import { applyBarcodeReadings, detectRetailBarcodes, findOcrGtinCandidate, isValidGtin, type BarcodeDetectorProvider } from '../barcode';
import { packageSchema } from '../contracts';
import { parseLabel } from '../parser';

describe('local retail barcode reading',()=>{
  it('validates EAN, UPC and GTIN check digits',()=>{
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('ABC6381333931')).toBe(false);
    expect(isValidGtin('12345678')).toBe(false);
  });

  it('retains one checksum-valid OCR code as an unconfirmed, traceable candidate',()=>{
    const candidate=findOcrGtinCandidate([
      {id:'line-1',field:'ocr-line',text:'OTHER 8901928202755>',origin:'ocr',imageId:'back-photo',side:'back'},
      {id:'user-line',field:'ocr-line',text:'4006381333931',origin:'user',imageId:'back-photo',side:'back'},
      {id:'fixture-line',field:'ocr-line',text:'4006381333931',origin:'fixture',imageId:'back-photo',side:'back'},
    ]);
    expect(candidate).toEqual({code:'8901928202755',observationIds:['line-1'],imageIds:['back-photo'],sides:['back']});
  });

  it('ignores invalid checksums and identifiers printed as licenses',()=>{
    expect(findOcrGtinCandidate([
      {id:'wrong-check',field:'ocr-line',text:'4006381333932',origin:'ocr',imageId:'back',side:'back'},
      {id:'license',field:'ocr-line',text:'Lic.No. 10012031000173',origin:'ocr',imageId:'back',side:'back'},
    ])).toBeNull();
  });

  it('withholds a candidate when distinct valid codes occur across package evidence',()=>{
    expect(findOcrGtinCandidate([
      {id:'code-a',field:'ocr-line',text:'4006381333931',origin:'ocr',imageId:'front',side:'front'},
      {id:'code-b',field:'ocr-line',text:'036000291452',origin:'ocr',imageId:'back',side:'back'},
    ])).toBeNull();
  });

  it('reads only supported retail formats and deduplicates valid results',async()=>{
    const detector={detect:vi.fn().mockResolvedValue([
      {rawValue:'4006381333931',format:'ean_13'},
      {rawValue:'4006381333931',format:'ean_13'},
      {rawValue:'4006381333932',format:'ean_13'},
      {rawValue:'4006381333931',format:'qr_code'},
    ])};
    const provider={getSupportedFormats:vi.fn().mockResolvedValue(['qr_code','ean_13','ean_8']),
      [Symbol.hasInstance]:undefined} as unknown as BarcodeDetectorProvider;
    const constructor=vi.fn(function(this:unknown){return detector;}) as unknown as BarcodeDetectorProvider;
    Object.assign(constructor,{getSupportedFormats:provider.getSupportedFormats});
    const bitmap={close:vi.fn()} as unknown as ImageBitmap;
    const bitmapFactory=vi.fn().mockResolvedValue(bitmap);
    expect(await detectRetailBarcodes(new Blob(['local image']),constructor,bitmapFactory)).toEqual(['4006381333931']);
    expect(detector.detect).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(detector.detect).toHaveBeenCalledOnce();
  });

  it('gracefully returns no barcode when the API or retail formats are unavailable',async()=>{
    expect(await detectRetailBarcodes(new Blob(['local image']),undefined,vi.fn())).toEqual([]);
    class Unsupported { static async getSupportedFormats(){return ['qr_code'];} constructor(_options:{formats:string[]}){} async detect(){return [];} }
    expect(await detectRetailBarcodes(new Blob(['local image']),Unsupported as unknown as BarcodeDetectorProvider,vi.fn())).toEqual([]);
  });

  it('uses the local decoder when the native API is unavailable and validates its output',async()=>{
    const fallback=vi.fn().mockResolvedValue([
      {rawValue:'4006381333931',format:'ean_13'},
      {rawValue:'4006381333931',format:'ean_13'},
      {rawValue:'4006381333932',format:'ean_13'},
      {rawValue:'4006381333931',format:'qr_code'},
    ]);
    expect(await detectRetailBarcodes(new Blob(['local image']),undefined,undefined,fallback)).toEqual(['4006381333931']);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('tries local decoding after a native detector finds no valid retail code',async()=>{
    const detector={detect:vi.fn().mockResolvedValue([])};
    const provider={getSupportedFormats:vi.fn().mockResolvedValue(['ean_13'])} as unknown as BarcodeDetectorProvider;
    const constructor=vi.fn(function(this:unknown){return detector;}) as unknown as BarcodeDetectorProvider;
    Object.assign(constructor,{getSupportedFormats:provider.getSupportedFormats});
    const bitmap={close:vi.fn()} as unknown as ImageBitmap;
    const fallback=vi.fn().mockResolvedValue([{rawValue:'036000291452',format:'upc_a'}]);
    expect(await detectRetailBarcodes(new Blob(['local image']),constructor,vi.fn().mockResolvedValue(bitmap),fallback)).toEqual(['036000291452']);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('keeps barcode failures non-fatal to OCR',async()=>{
    const fallback=vi.fn().mockRejectedValue(new Error('decoder unavailable'));
    expect(await detectRetailBarcodes(new Blob(['local image']),undefined,undefined,fallback)).toEqual([]);
  });

  it('supports a barcode-only photo and preserves per-image decoding provenance',()=>{
    const base=parseLabel('',{origin:'ocr'});
    const result=applyBarcodeReadings(base,[
      {code:'4006381333931',imageId:'photo-a',side:'extra'},
      {code:'4006381333931',imageId:'photo-b',side:'back'},
    ]);
    expect(result.barcode).toBe('4006381333931');
    expect(result.observations.filter(item=>item.origin==='barcode').map(item=>item.imageId)).toEqual(['photo-a','photo-b']);
    expect(packageSchema.safeParse(result).success).toBe(true);
  });

  it('withholds product lookup when barcode readings conflict with each other or label text',()=>{
    const multiple=applyBarcodeReadings(parseLabel(''),[
      {code:'4006381333931',imageId:'photo-a',side:'extra'},
      {code:'036000291452',imageId:'photo-b',side:'extra'},
    ]);
    expect(multiple.barcode).toBeUndefined();
    expect(multiple.identityConflict).toBe(true);
    expect(multiple.warnings.join(' ')).toMatch(/more than one distinct product barcode/i);
    const disagreement=applyBarcodeReadings(parseLabel('Barcode: 4006381333931'),[
      {code:'036000291452',imageId:'photo-a',side:'extra'},
    ]);
    expect(disagreement.barcode).toBeUndefined();
    expect(disagreement.identityConflict).toBe(true);
    expect(disagreement.warnings.join(' ')).toMatch(/decoded barcode and printed\/OCR barcode disagree/i);
    expect(packageSchema.safeParse(disagreement).success).toBe(true);
  });
});
