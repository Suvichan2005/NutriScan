import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { savedScanSchema, type SavedScanRecord } from '../contracts';

const pkg = parseLabel('Synthetic saved-session label\nNutrition information per 100 g\nEnergy 380 kcal', { origin: 'user' });
const base: SavedScanRecord = { id: pkg.id, name: pkg.name, createdAt: pkg.createdAt, package: pkg, portion: 30, unit: 'g' };

describe('locally saved investigation context', () => {
  it('accepts the existing package-only history record shape', () => {
    expect(savedScanSchema.parse(base)).toEqual(base);
  });

  it('stores bounded local turns while keeping optional context outside the record', () => {
    const scan = savedScanSchema.parse({ ...base, conversation: [{ question: 'How much energy is in 30 g?', answer: 'The label-based calculation is 114 kcal.', at: '2026-10-21T12:00:00.000Z' }] });
    expect(scan.conversation).toHaveLength(1);
    expect(scan.conversation?.[0]?.question).toBe('How much energy is in 30 g?');
    expect(savedScanSchema.safeParse({ ...scan, profile: { healthConsiderations: 'private' } }).success).toBe(false);
    expect(savedScanSchema.safeParse({ ...scan, images: ['data:image/jpeg;base64,private'] }).success).toBe(false);
  });

  it('rejects empty, overlong, invalid-time and excessive-turn records', () => {
    const turn = { question: 'Question', answer: 'Answer', at: '2026-10-21T12:00:00.000Z' };
    expect(savedScanSchema.safeParse({ ...base, conversation: [{ ...turn, question: '  ' }] }).success).toBe(false);
    expect(savedScanSchema.safeParse({ ...base, conversation: [{ ...turn, question: 'q'.repeat(1001) }] }).success).toBe(false);
    expect(savedScanSchema.safeParse({ ...base, conversation: [{ ...turn, at: 'not-a-date' }] }).success).toBe(false);
    expect(savedScanSchema.safeParse({ ...base, conversation: Array.from({ length: 31 }, () => turn) }).success).toBe(false);
  });
});
