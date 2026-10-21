import { detectAdditives } from './knowledge';
import { parseLabel as parseLabelCore, type ParseOptions as ModuleParseOptions } from '../modules/ocr';
import type { PackageData } from './contracts';

export type ParseOptions = Omit<ModuleParseOptions, 'resolveAdditives'>;

/** Compatibility adapter that supplies the owner-controlled additive registry. */
export function parseLabel(text: string, options: ParseOptions = {}): PackageData {
  return parseLabelCore(text, { ...options, resolveAdditives: detectAdditives });
}
