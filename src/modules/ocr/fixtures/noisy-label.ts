export const noisyLabelFixture = [
  'Nutrition information per 100 g',
  'Protein 8.8 g',
  'Protein 8 g 7 g',
  'Ingredients: oats, sugar, INS 955'
].join('\n');

export const proteinObservationFixture = {
  id: 'ocr-protein-1',
  field: 'ocr-line',
  text: 'Protein 8.8 g',
  side: 'back',
  confidence: 72,
  origin: 'ocr',
  imageId: 'fixture-image-1',
  readingOrder: { runId: 'fixture-run-1', blockIndex: 0, paragraphIndex: 0, lineIndex: 1 }
} as const;

export const captureFixture = {
  runId: 'fixture-run-1',
  imageId: 'fixture-image-1',
  side: 'back',
  sourceImage: { width: 1000, height: 1400 },
  preparedImage: { width: 1000, height: 1400 },
  bboxCoordinateSpace: 'prepared-image-pixels',
  engine: { name: 'fixture-reader', version: '1.0', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
  processing: { rotation: 0, contrast: false, invert: false, cropPercent: null }
} as const;
