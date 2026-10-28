import type { Observation } from './contracts';

/** Vision lineage can point to a photo without any OCR observation. Never invent a crop. */
export function evidencePhotoSelection(observationIds: string[], regions: { imageId: string }[], observations: Observation[], availableIds: string[]) {
  const linkedIds = [...new Set([...regions.map(region => region.imageId), ...observations.filter(row => observationIds.includes(row.id)).flatMap(row => row.imageId ? [row.imageId] : [])])];
  return { linked: linkedIds.length > 0, imageIds: linkedIds.length ? availableIds.filter(id => linkedIds.includes(id)) : availableIds };
}
