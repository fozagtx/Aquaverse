/**
 * Pixel-art sprites drawn from text grids, so the art lives in code and needs
 * no image files. Each character maps to a palette colour; '.' is transparent.
 */

export type Grid = string[];

export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export function makeSprite(grid: Grid, palette: Record<string, string>, flip = false): SpriteSheet {
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(flip ? width - 1 - x : x, y, 1, 1);
    }
  }
  return { canvas, width, height };
}

export const MAYFLY: Grid[] = [
  [
    '.......',
    't...l..',
    '.ttbBBh',
    't...l..',
    '.......',
  ],
  [
    '.......',
    '.t..l..',
    't.tbBBh',
    '.t..l..',
    '.......',
  ],
];
export const MAYFLY_PALETTE = { t: '#f7e1a1', b: '#e9b04b', B: '#b97a26', h: '#5b3d17', l: '#8a5a20' };

export const MIDGE: Grid[] = [
  [
    '.rr...',
    'r..rrh',
  ],
  [
    'r..r..',
    '.rr.rh',
  ],
];
export const MIDGE_PALETTE = { r: '#e5484d', h: '#7a1a1a' };

export const MOSQUITO: Grid[] = [
  [
    's..',
    '.b.',
    '.bb',
    '.b.',
    'hh.',
  ],
  [
    '.s.',
    '.b.',
    'bb.',
    '.b.',
    '.hh',
  ],
];
export const MOSQUITO_PALETTE = { s: '#1f1640', b: '#9a8af0', h: '#4a3aa7' };

export const FISH: Grid[] = [
  [
    '...dd....',
    't.sssss..',
    'tsSSSSSse',
    't.sssss..',
    '....d....',
  ],
  [
    '...dd....',
    '..sssss..',
    'ttSSSSSse',
    '..sssss..',
    '....d....',
  ],
];
export const FISH_PALETTE = { s: '#6aaeea', S: '#d6eefa', d: '#2a78d6', t: '#2a78d6', e: '#0d1b26' };

export const KINGFISHER: Grid = [
  '..bb...',
  '.bBBek.',
  '.bbBB..',
  '..ooo..',
  '...o...',
  '..k.k..',
];
export const KINGFISHER_PALETTE = { b: '#1f6fc4', B: '#4fb3f5', o: '#f08a24', e: '#0d1b26', k: '#2a2a2a' };

export const PERSON: Grid = [
  '.hh.',
  '.ff.',
  'cccc',
  '.cc.',
  '.cc.',
  '.pp.',
  '.p.p',
];

export const SIGN: Grid = [
  '.yyyyy.',
  'yykkkyy',
  'yyykyyy',
  'yyykyyy',
  'yyyyyyy',
  'yyykyyy',
  '.yyyyy.',
  '...g...',
  '...g...',
];
export const SIGN_PALETTE = { y: '#f5c518', k: '#1d1d1d', g: '#6b6b6b' };

export const CAR: Grid = [
  '.cccc.',
  'cwwwwc',
  'cccccc',
  'k.cc.k',
];

/**
 * Identity colours for the four species, shared by charts, legends and swatches.
 * Validated as a set for colour-blind separation in the order fish, mayfly,
 * mosquito, midge (see Trends).
 */
export const SPECIES_COLORS = {
  fish: '#2a78d6',
  mayfly: '#c98500',
  mosquito: '#4a3aa7',
  midge: '#e34948',
} as const;
export const SPECIES_ORDER = ['fish', 'mayfly', 'mosquito', 'midge'] as const;
