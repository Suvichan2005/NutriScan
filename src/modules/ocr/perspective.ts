export type Point = { x: number; y: number };
export type PerspectiveQuad = [Point, Point, Point, Point];

export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  grayscale: boolean;
  threshold: number | null;
};

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

export function isValidPerspectiveQuad(quad: PerspectiveQuad) {
  if (quad.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return false;
  const turns = quad.map((point, index) => cross(point, quad[(index + 1) % 4], quad[(index + 2) % 4]));
  if (turns.some(value => Math.abs(value) < 1e-5) || !(turns.every(value => value > 0) || turns.every(value => value < 0))) return false;
  const shortestEdge = Math.min(...quad.map((point, index) => {
    const next = quad[(index + 1) % 4];
    return Math.hypot(next.x - point.x, next.y - point.y);
  }));
  if (shortestEdge < 0.035) return false;
  const area = Math.abs(quad.reduce((sum, point, index) => {
    const next = quad[(index + 1) % 4];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  return area >= 0.08;
}

function solve(matrix: number[][]): number[] {
  const size = matrix.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    if (Math.abs(matrix[pivot][column]) < 1e-10) throw new Error('Those corners do not form a usable label shape.');
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let cell = column; cell <= size; cell++) matrix[column][cell] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let cell = column; cell <= size; cell++) matrix[row][cell] -= factor * matrix[column][cell];
    }
  }
  return matrix.map(row => row[size]);
}

/** Returns a destination-pixel to source-pixel projective mapping. */
export function projectiveMapping(quad: PerspectiveQuad, sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number) {
  if (!isValidPerspectiveQuad(quad)) throw new Error('Move the four corners around the label without crossing them.');
  const destinations = [{ x: 0, y: 0 }, { x: outputWidth, y: 0 }, { x: outputWidth, y: outputHeight }, { x: 0, y: outputHeight }];
  const equations: number[][] = [];
  quad.forEach((point, index) => {
    const { x: u, y: v } = destinations[index];
    const x = point.x * sourceWidth, y = point.y * sourceHeight;
    equations.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
    equations.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
  });
  const [a, b, c, d, e, f, g, h] = solve(equations);
  return (x: number, y: number): Point => {
    const denominator = g * x + h * y + 1;
    if (Math.abs(denominator) < 1e-10) return { x: -1, y: -1 };
    return { x: (a * x + b * y + c) / denominator, y: (d * x + e * y + f) / denominator };
  };
}

function toBlob(canvas: HTMLCanvasElement, quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', quality));
}

function boundedCanvas(width: number, height: number, maxEdge = 2800) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

export async function rotateImage(source: Blob, clockwise = true): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not rotate this photo.');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((clockwise ? 1 : -1) * Math.PI / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

export async function rectifyPerspective(source: Blob, quad: PerspectiveQuad): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    const input = boundedCanvas(bitmap.width, bitmap.height);
    const inputContext = input.getContext('2d', { willReadFrequently: true });
    if (!inputContext) throw new Error('Your browser could not prepare this photo.');
    inputContext.drawImage(bitmap, 0, 0, input.width, input.height);
    const top = Math.hypot((quad[1].x - quad[0].x) * input.width, (quad[1].y - quad[0].y) * input.height);
    const bottom = Math.hypot((quad[2].x - quad[3].x) * input.width, (quad[2].y - quad[3].y) * input.height);
    const left = Math.hypot((quad[3].x - quad[0].x) * input.width, (quad[3].y - quad[0].y) * input.height);
    const right = Math.hypot((quad[2].x - quad[1].x) * input.width, (quad[2].y - quad[1].y) * input.height);
    let width = Math.max(2, Math.round((top + bottom) / 2));
    let height = Math.max(2, Math.round((left + right) / 2));
    const scale = Math.min(1, 2800 / Math.max(width, height));
    width = Math.max(2, Math.round(width * scale));
    height = Math.max(2, Math.round(height * scale));
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d', { willReadFrequently: true });
    if (!outputContext) throw new Error('Your browser could not correct the perspective.');
    const sourcePixels = inputContext.getImageData(0, 0, input.width, input.height);
    const destinationPixels = outputContext.createImageData(width, height);
    const map = projectiveMapping(quad, input.width, input.height, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const point = map(x, y);
        const target = (y * width + x) * 4;
        if (point.x < 0 || point.y < 0 || point.x > input.width - 1 || point.y > input.height - 1) {
          destinationPixels.data[target] = 255;
          destinationPixels.data[target + 1] = 255;
          destinationPixels.data[target + 2] = 255;
          destinationPixels.data[target + 3] = 255;
          continue;
        }
        const sx = point.x;
        const sy = point.y;
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(input.width - 1, x0 + 1), y1 = Math.min(input.height - 1, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        for (let channel = 0; channel < 4; channel++) {
          const p00 = sourcePixels.data[(y0 * input.width + x0) * 4 + channel];
          const p10 = sourcePixels.data[(y0 * input.width + x1) * 4 + channel];
          const p01 = sourcePixels.data[(y1 * input.width + x0) * 4 + channel];
          const p11 = sourcePixels.data[(y1 * input.width + x1) * 4 + channel];
          destinationPixels.data[target + channel] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
        }
      }
    }
    outputContext.putImageData(destinationPixels, 0, 0);
    return { blob: await toBlob(output), width, height };
  } finally { bitmap.close(); }
}

export async function adjustImage(source: Blob, adjustments: ImageAdjustments): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = boundedCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: adjustments.threshold !== null });
    if (!context) throw new Error('Your browser could not adjust this photo.');
    context.filter = `brightness(${Math.max(50, Math.min(150, adjustments.brightness))}%) contrast(${Math.max(50, Math.min(180, adjustments.contrast))}%) grayscale(${adjustments.grayscale ? 1 : 0})`;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (adjustments.threshold !== null) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = 0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] + 0.0722 * pixels.data[index + 2];
        const value = gray >= adjustments.threshold ? 255 : 0;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

/** A deliberately mild default contrast/brightness pass; the uploaded image remains separately available. */
export function autoReadability(source: Blob) {
  return adjustImage(source, { brightness: 103, contrast: 112, grayscale: false, threshold: null });
}
