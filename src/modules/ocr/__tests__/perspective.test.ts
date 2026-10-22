import { describe, expect, it } from 'vitest';
import { isValidPerspectiveQuad, projectiveMapping, type PerspectiveQuad } from '../perspective';

describe('perspective geometry', () => {
  it('maps a full-frame rectangle without bending its coordinates', () => {
    const quad: PerspectiveQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const map = projectiveMapping(quad, 1000, 500, 1000, 500);
    expect(map(350, 120).x).toBeCloseTo(350);
    expect(map(350, 120).y).toBeCloseTo(120);
  });

  it('maps each output corner back to its selected photographed corner', () => {
    const quad: PerspectiveQuad = [{ x: 0.1, y: 0.18 }, { x: 0.88, y: 0.08 }, { x: 0.81, y: 0.9 }, { x: 0.19, y: 0.84 }];
    const map = projectiveMapping(quad, 1000, 800, 700, 500);
    expect(map(0, 0).x).toBeCloseTo(100);
    expect(map(0, 0).y).toBeCloseTo(144);
    expect(map(700, 0).x).toBeCloseTo(880);
    expect(map(700, 0).y).toBeCloseTo(64);
    expect(map(700, 500).x).toBeCloseTo(810);
    expect(map(700, 500).y).toBeCloseTo(720);
    expect(map(0, 500).x).toBeCloseTo(190);
    expect(map(0, 500).y).toBeCloseTo(672);
  });

  it('rejects crossed, out-of-frame and tiny quads', () => {
    expect(isValidPerspectiveQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(isValidPerspectiveQuad([{ x: -0.1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(false);
    expect(isValidPerspectiveQuad([{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.55, y: 0.55 }, { x: 0.45, y: 0.55 }])).toBe(false);
  });

  it('rejects a valid-looking polygon that would discard nearly the whole label', () => {
    expect(isValidPerspectiveQuad([{ x: 0.2, y: 0.49 }, { x: 0.8, y: 0.49 }, { x: 0.8, y: 0.51 }, { x: 0.2, y: 0.51 }])).toBe(false);
  });
});
