import { SPECIES } from '../engine/constants';
import { hash2 } from '../engine/rng';
import { channelDistance, isChannelCode } from '../engine/terrain';
import { SPECIES_IDS, TERRAIN, type MapEdit, type SpeciesId } from '../engine/types';
import { ORG_FIELDS, type Snapshot, type TerrainPayload } from '../worker/protocol';
import {
  CAR,
  FISH,
  FISH_PALETTE,
  KINGFISHER,
  KINGFISHER_PALETTE,
  MAYFLY,
  MAYFLY_PALETTE,
  MIDGE,
  MIDGE_PALETTE,
  MOSQUITO,
  MOSQUITO_PALETTE,
  PERSON,
  SIGN,
  SIGN_PALETTE,
  makeSprite,
  type SpriteSheet,
} from './sprites';

/** Art pixels per tile. The canvas is drawn small and scaled up crisply. */
export const TILE = 8;

type RGB = [number, number, number];

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function css(c: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}

const C = {
  waterClean: hex('#3a8fc6'),
  waterDeep: hex('#2a6f9e'),
  algae: hex('#4f9a3a'),
  turbid: hex('#9a7b4f'),
  plume: hex('#6a5d4b'),
  mud: hex('#7d6646'),
  ripple: hex('#cfeafa'),
  grass: hex('#7fb04f'),
  grassDark: hex('#6a9a40'),
  grassLight: hex('#9cc865'),
  shadeGrass: hex('#5d8a3a'),
  bankEdge: hex('#6b5a3a'),
  path: hex('#cfc8b8'),
  pathJoint: hex('#b7ae9d'),
  asphalt: hex('#5d6168'),
  asphaltSpeck: hex('#6c7078'),
  roofs: ['#b8604a', '#8e6e5a', '#6f8090', '#a39a8a', '#c98e5a', '#7b8a6a'].map(hex),
  stone: hex('#8f877b'),
  stoneLight: hex('#b9b0a1'),
  stoneDark: hex('#5f584f'),
  canopy: hex('#3f8a3a'),
  canopyDark: hex('#2d6a2c'),
  canopyLight: hex('#62b052'),
  trunk: hex('#6b4a2a'),
};

const SPECIES_INDEX: SpeciesId[] = SPECIES_IDS;
const MOVE_EVERY: Record<SpeciesId, number> = {
  mayfly: SPECIES.mayfly.moveEvery,
  midge: SPECIES.midge.moveEvery,
  mosquito: SPECIES.mosquito.moveEvery,
  fish: SPECIES.fish.moveEvery,
};

interface RenderPos {
  x: number;
  y: number;
  dir: number;
  seen: number;
}

export interface RenderOptions {
  time: number;
  selectedId: number | null;
  edits: MapEdit[];
  hover: { x: number; y: number } | null;
  brush: MapEdit['brush'] | null;
  brushSize: number;
  reducedMotion: boolean;
}

export interface PickedOrganism {
  id: number;
  species: SpeciesId;
}

export class StreamRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainPayload | null = null;
  private layer: HTMLCanvasElement | null = null;
  private dist: Int32Array | null = null;
  private sprites: Record<SpeciesId, SpriteSheet[][]>;
  private kingfisher: SpriteSheet;
  private sign: SpriteSheet;
  private people: SpriteSheet[];
  private positions = new Map<number, RenderPos>();
  private lastTime = 0;
  private paths: { top: Int32Array; bottom: Int32Array } | null = null;
  private perch: { x: number; y: number; wx: number; wy: number } | null = null;
  private signSpot: { x: number; y: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    const pair = (grids: string[][], palette: Record<string, string>) =>
      grids.map((g) => [makeSprite(g, palette), makeSprite(g, palette, true)]);
    this.sprites = {
      mayfly: pair(MAYFLY, MAYFLY_PALETTE),
      midge: pair(MIDGE, MIDGE_PALETTE),
      mosquito: pair(MOSQUITO, MOSQUITO_PALETTE),
      fish: pair(FISH, FISH_PALETTE),
    };
    this.kingfisher = makeSprite(KINGFISHER, KINGFISHER_PALETTE);
    this.sign = makeSprite(SIGN, SIGN_PALETTE);
    const outfits = [
      { h: '#3b2a1a', f: '#f1c9a5', c: '#e4572e', p: '#2f3e46' },
      { h: '#111111', f: '#8d5a3b', c: '#2a9d8f', p: '#264653' },
      { h: '#c9a227', f: '#f6d7b8', c: '#6d597a', p: '#355070' },
      { h: '#5a3825', f: '#c68b59', c: '#f4a261', p: '#3d405b' },
    ];
    this.people = outfits.map((o) => makeSprite(PERSON, o));
  }

  setTerrain(t: TerrainPayload): void {
    if (this.terrain && this.terrain.version === t.version && this.terrain.terrain === t.terrain) return;
    this.terrain = t;
    this.canvas.width = t.width * TILE;
    this.canvas.height = t.height * TILE;
    this.ctx.imageSmoothingEnabled = false;
    this.dist = channelDistance(t.terrain, t.width, t.height);
    this.layer = this.buildLayer(t);
    this.paths = this.buildPaths(t);
    this.perch = this.findPerch(t);
    this.signSpot = this.findSignSpot(t);
  }

  /** Static ground: banks, trees, pavement, stones and drains. Water tiles stay transparent. */
  private buildLayer(t: TerrainPayload): HTMLCanvasElement {
    const { width, height, terrain } = t;
    const dist = this.dist!;
    const canvas = document.createElement('canvas');
    canvas.width = width * TILE;
    canvas.height = height * TILE;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(canvas.width, canvas.height);
    const px = (x: number, y: number, c: RGB, a = 255) => {
      const k = (y * canvas.width + x) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = a;
    };

    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        const code = terrain[i];
        if (isChannelCode(code)) continue;
        const d = dist[i];
        if (code === TERRAIN.bank || code === TERRAIN.trees) {
          for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
              const ax = tx * TILE + x;
              const ay = ty * TILE + y;
              const h = hash2(ax, ay, 1);
              let c = code === TERRAIN.trees ? C.shadeGrass : C.grass;
              if (h < 0.14) c = C.grassDark;
              else if (h > 0.95) c = C.grassLight;
              if (code === TERRAIN.bank && h > 0.997) c = hash2(ax, ay, 2) > 0.5 ? hex('#f2e86d') : hex('#f29ac0');
              px(ax, ay, c);
            }
          }
        } else {
          // Pavement: a promenade beside the water, then streets and rooftops.
          const near = d <= 2;
          const bx = Math.floor(tx / 4);
          const by = Math.floor(ty / 3);
          const building = !near && hash2(bx, by, 7) < 0.55;
          const roof = C.roofs[Math.floor(hash2(bx, by, 9) * C.roofs.length)];
          for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
              const ax = tx * TILE + x;
              const ay = ty * TILE + y;
              let c: RGB;
              if (near) {
                c = (ax % 4 === 0 || ay % 4 === 0) ? C.pathJoint : C.path;
              } else if (building) {
                const edgeL = tx % 4 === 0 && x === 0;
                const edgeT = ty % 3 === 0 && y === 0;
                const edgeR = tx % 4 === 3 && x === TILE - 1;
                const edgeB = ty % 3 === 2 && y === TILE - 1;
                c = edgeL || edgeT ? mix(roof, [255, 255, 255], 0.25) : edgeR || edgeB ? mix(roof, [0, 0, 0], 0.35) : roof;
                if (!edgeL && !edgeT && !edgeR && !edgeB && hash2(ax >> 1, ay >> 1, 11) > 0.93) c = mix(roof, [0, 0, 0], 0.15);
              } else {
                c = hash2(ax, ay, 3) > 0.9 ? C.asphaltSpeck : C.asphalt;
              }
              px(ax, ay, c);
            }
          }
        }
        // Muddy edge where land meets water.
        for (const [ox, oy, side] of [[0, -1, 'top'], [0, 1, 'bottom'], [-1, 0, 'left'], [1, 0, 'right']] as const) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!isChannelCode(terrain[ny * width + nx])) continue;
          const edge = code === TERRAIN.pavement ? hex('#9c9688') : C.bankEdge;
          for (let k = 0; k < TILE; k++) {
            const ax = side === 'left' ? tx * TILE : side === 'right' ? tx * TILE + TILE - 1 : tx * TILE + k;
            const ay = side === 'top' ? ty * TILE : side === 'bottom' ? ty * TILE + TILE - 1 : ty * TILE + k;
            px(ax, ay, edge);
          }
        }
      }
    }

    // Stones and roots in the channel (refuges).
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (terrain[ty * width + tx] !== TERRAIN.refuge) continue;
        const stones = 2 + Math.floor(hash2(tx, ty, 21) * 2);
        for (let s = 0; s < stones; s++) {
          const cx = tx * TILE + 1 + Math.floor(hash2(tx, ty, 30 + s) * 5);
          const cy = ty * TILE + 1 + Math.floor(hash2(tx, ty, 40 + s) * 5);
          const r = 1 + Math.floor(hash2(tx, ty, 50 + s) * 2);
          for (let y = -r; y <= r; y++) {
            for (let x = -r - 1; x <= r; x++) {
              if (x * x * 0.7 + y * y > r * r + 0.5) continue;
              const ax = cx + x;
              const ay = cy + y;
              if (ax < tx * TILE || ay < ty * TILE || ax >= (tx + 1) * TILE || ay >= (ty + 1) * TILE) continue;
              const c = y < 0 && x < 0 ? C.stoneLight : y > 0 ? C.stoneDark : C.stone;
              px(ax, ay, c);
            }
          }
        }
      }
    }
    g.putImageData(img, 0, 0);

    // A few parked cars on streets.
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        if (terrain[i] !== TERRAIN.pavement || dist[i] <= 2) continue;
        const building = hash2(Math.floor(tx / 4), Math.floor(ty / 3), 7) < 0.55;
        if (building || hash2(tx, ty, 61) > 0.06) continue;
        const colors = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f'];
        const car = makeSprite(CAR, { c: colors[Math.floor(hash2(tx, ty, 62) * colors.length)], w: '#a8dadc', k: '#111111' });
        g.drawImage(car.canvas, tx * TILE + 1, ty * TILE + 2);
      }
    }

    // Storm drain outfalls.
    for (let i = 0; i < t.drain.length; i++) {
      if (!t.drain[i]) continue;
      const tx = i % width;
      const ty = (i / width) | 0;
      g.fillStyle = '#9a958a';
      g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      g.fillStyle = '#6d695f';
      g.fillRect(tx * TILE, ty * TILE, TILE, 1);
      g.fillStyle = '#1e1f22';
      g.fillRect(tx * TILE + 2, ty * TILE + 2, 4, 4);
      g.fillStyle = '#3a3c40';
      g.fillRect(tx * TILE + 2, ty * TILE + 2, 4, 1);
    }

    // Tree canopies, drawn top to bottom so lower trees overlap.
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        if (terrain[i] !== TERRAIN.trees) continue;
        const growth = t.treeGrowth[i];
        const cx = tx * TILE + 4 + Math.round((hash2(tx, ty, 71) - 0.5) * 2);
        const cy = ty * TILE + 4 + Math.round((hash2(tx, ty, 72) - 0.5) * 2);
        const r = growth < 0.35 ? 1.6 + growth * 2 : 2.8 + growth * 2;
        if (growth < 0.35) {
          g.fillStyle = css(C.trunk);
          g.fillRect(cx, cy + 1, 1, 2);
        }
        for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
          for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
            const dd = x * x + y * y;
            if (dd > r * r) continue;
            let c = C.canopy;
            if (dd > (r - 1) * (r - 1)) c = C.canopyDark;
            else if (x + y < -r * 0.6) c = C.canopyLight;
            else if (hash2(cx + x, cy + y, 73) > 0.85) c = C.canopyDark;
            g.fillStyle = css(c);
            g.fillRect(cx + x, cy + y, 1, 1);
          }
        }
      }
    }
    return canvas;
  }

  /** Footpaths along both banks, two tiles from the water, for decorative people. */
  private buildPaths(t: TerrainPayload): { top: Int32Array; bottom: Int32Array } {
    const top = new Int32Array(t.width).fill(-1);
    const bottom = new Int32Array(t.width).fill(-1);
    const dist = this.dist!;
    for (let x = 0; x < t.width; x++) {
      let first = -1;
      let last = -1;
      for (let y = 0; y < t.height; y++) {
        if (isChannelCode(t.terrain[y * t.width + x])) {
          if (first < 0) first = y;
          last = y;
        }
      }
      for (let y = first - 1; y >= 0; y--) if (dist[y * t.width + x] >= 2) { top[x] = y; break; }
      for (let y = last + 1; y < t.height; y++) if (dist[y * t.width + x] >= 2) { bottom[x] = y; break; }
    }
    return { top, bottom };
  }

  private findPerch(t: TerrainPayload): { x: number; y: number; wx: number; wy: number } | null {
    const cx = Math.floor(t.width / 2);
    for (let r = 0; r < t.width / 2; r++) {
      for (const x of [cx + r, cx - r]) {
        if (x < 1 || x >= t.width - 1) continue;
        for (let y = 1; y < t.height - 1; y++) {
          const i = y * t.width + x;
          if (t.terrain[i] !== TERRAIN.trees && t.terrain[i] !== TERRAIN.bank) continue;
          if (this.dist![i] !== 1) continue;
          const below = (y + 1) * t.width + x;
          const above = (y - 1) * t.width + x;
          const wy = isChannelCode(t.terrain[below]) ? y + 2 : isChannelCode(t.terrain[above]) ? y - 2 : y;
          return { x, y, wx: x, wy };
        }
      }
    }
    return null;
  }

  private findSignSpot(t: TerrainPayload): { x: number; y: number } | null {
    for (let i = 0; i < t.drain.length; i++) {
      if (!t.drain[i]) continue;
      const x = i % t.width;
      const y = (i / t.width) | 0;
      for (const [ox, oy] of [[2, 0], [-2, 0], [3, 0], [2, -1], [2, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) continue;
        if (!isChannelCode(t.terrain[ny * t.width + nx])) return { x: nx, y: ny };
      }
    }
    return null;
  }

  render(snap: Snapshot, opts: RenderOptions): void {
    const t = this.terrain;
    if (!t || !this.layer) return;
    const g = this.ctx;
    const { width, height, terrain } = t;
    const time = opts.time;
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    const s = snap.stream;
    const motion = opts.reducedMotion ? 0 : 1;

    // Water.
    const turbidity = Math.min(1, s.turbidity / 100);
    const drought = Math.max(0, (28 - s.flow) / 28);
    const flowSpeed = 0.6 + s.flow / 25;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        if (!isChannelCode(terrain[i])) continue;
        const ff = t.flowFactor[i];
        let c = mix(C.waterClean, C.waterDeep, Math.min(1, (ff - 0.3) / 0.9));
        c = mix(c, C.algae, Math.min(0.85, (snap.algae[i] / 255) * 0.95));
        c = mix(c, C.turbid, turbidity * 0.55);
        c = mix(c, C.plume, Math.min(0.85, (snap.plume[i] / 255) * 0.9));
        if (ff <= 0.35) c = mix(c, C.mud, drought * 0.65);
        c = mix(c, [10, 30, 40], t.localShade[i] * 0.22);
        g.fillStyle = css(c);
        g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        // Ripples drift downstream with the flow.
        const ripples = s.flow > 60 ? 2 : 1;
        for (let r = 0; r < ripples; r++) {
          const h = hash2(tx, ty, 90 + r);
          const offset = Math.floor((h * TILE + (time / 1000) * flowSpeed * ff * 3 * motion) % TILE);
          const row = Math.floor(hash2(tx, ty, 95 + r) * TILE);
          g.fillStyle = css(mix(c, C.ripple, 0.45));
          g.fillRect(tx * TILE + offset, ty * TILE + row, s.flow > 30 ? 2 : 1, 1);
        }
      }
    }

    g.drawImage(this.layer, 0, 0);

    // Creatures.
    const orgs = snap.organisms;
    const seen = new Set<number>();
    const speed = snap.playing ? snap.speed : 0;
    for (let k = 0; k < orgs.length; k += ORG_FIELDS) {
      const id = orgs[k];
      const species = SPECIES_INDEX[orgs[k + 1]];
      const x = orgs[k + 2];
      const y = orgs[k + 3];
      seen.add(id);
      let p = this.positions.get(id);
      if (!p || Math.abs(p.x - x) > 3 || Math.abs(p.y - y) > 3 || !snap.live) {
        p = { x, y, dir: p?.dir ?? 1, seen: time };
        this.positions.set(id, p);
      } else {
        const tilesPerSecond = Math.max(2, (10 * Math.max(speed, 1)) / MOVE_EVERY[species]) * 1.4;
        const step = tilesPerSecond * dt;
        const dx = x - p.x;
        const dy = y - p.y;
        const dd = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.05) p.dir = dx > 0 ? 1 : -1;
        if (dd <= step || speed === 0) {
          p.x = speed === 0 ? p.x + dx * Math.min(1, dt * 8) : x;
          p.y = speed === 0 ? p.y + dy * Math.min(1, dt * 8) : y;
        } else {
          p.x += (dx / dd) * step;
          p.y += (dy / dd) * step;
        }
      }
      const frames = this.sprites[species];
      const frame = Math.floor((time / (species === 'midge' ? 260 : 420) + id * 0.37) * motion) % frames.length;
      const sheet = frames[frame][p.dir < 0 ? 1 : 0];
      const bob = species === 'mosquito' && motion ? Math.round(Math.sin(time / 500 + id) * 0.6) : 0;
      const ax = Math.round(p.x * TILE + (TILE - sheet.width) / 2);
      const ay = Math.round(p.y * TILE + (TILE - sheet.height) / 2) + bob;
      g.drawImage(sheet.canvas, ax, ay);
      const stress = orgs[k + 8];
      if (stress > 0.25) {
        g.fillStyle = '#ff3b30';
        g.fillRect(ax + Math.floor(sheet.width / 2), ay - 2, 1, 1);
      }
      if (opts.selectedId === id) {
        const blink = Math.floor(time / 300) % 2 === 0 || !motion;
        g.fillStyle = blink ? '#ffffff' : '#1d2b36';
        const x0 = ax - 2;
        const y0 = ay - 2;
        const x1 = ax + sheet.width + 1;
        const y1 = ay + sheet.height + 1;
        for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
          g.fillRect(cx, cy, 1, 1);
          g.fillRect(cx + sx, cy, 1, 1);
          g.fillRect(cx, cy + sy, 1, 1);
        }
      }
    }
    if (this.positions.size > seen.size + 50) {
      for (const id of this.positions.keys()) if (!seen.has(id)) this.positions.delete(id);
    }

    this.drawLife(snap, time, motion);
    this.drawWeather(snap, time, motion);
    this.drawEdits(opts);
  }

  /** Decorative only: people on the banks, a kingfisher, adult mosquitoes, a warning sign. */
  private drawLife(snap: Snapshot, time: number, motion: number): void {
    const t = this.terrain!;
    const g = this.ctx;
    const risk = snap.gauges.risk;
    const keepAway = risk.band === 'high';
    if (this.paths) {
      const walkers = keepAway ? 2 : 4;
      for (let n = 0; n < walkers; n++) {
        const path = n % 2 === 0 ? this.paths.top : this.paths.bottom;
        const dir = n % 2 === 0 ? 1 : -1;
        const span = t.width * TILE;
        const pos = ((n * 137 + (time / 1000) * 6 * dir * motion) % span + span) % span;
        const tx = Math.floor(pos / TILE);
        let ty = path[tx];
        if (ty < 0) continue;
        if (keepAway) ty += n % 2 === 0 ? -2 : 2;
        if (ty < 0 || ty >= t.height) continue;
        const sprite = this.people[n % this.people.length];
        const bob = motion && Math.floor(time / 250 + n) % 2 === 0 ? 1 : 0;
        g.drawImage(sprite.canvas, Math.round(pos) - 2, ty * TILE - 1 - bob);
      }
    }
    if (this.perch && snap.counts.fish >= 5) {
      const cycle = (time / 1000) % 9;
      const diving = motion && cycle > 7.5;
      const k = diving ? Math.sin(((cycle - 7.5) / 1.5) * Math.PI) : 0;
      const x = this.perch.x * TILE + 1;
      const y = (this.perch.y + (this.perch.wy - this.perch.y) * k) * TILE - 3;
      g.drawImage(this.kingfisher.canvas, Math.round(x), Math.round(y));
    }
    const adults = Math.min(24, Math.round(snap.stream.adultMosquitoes));
    if (adults > 0 && this.paths) {
      g.fillStyle = '#1b1b1b';
      for (let m = 0; m < adults; m++) {
        const tx = Math.floor(hash2(m, 3, 5) * t.width);
        const path = m % 2 ? this.paths.top : this.paths.bottom;
        const ty = path[tx];
        if (ty < 0) continue;
        const x = tx * TILE + 4 + Math.sin(time / 180 + m * 2.1) * 4 * motion;
        const y = ty * TILE + Math.cos(time / 230 + m) * 4 * motion;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    if (this.signSpot && risk.band !== 'low' && (risk.top.key === 'pathogens' || risk.top.key === 'bloom')) {
      g.drawImage(this.sign.canvas, this.signSpot.x * TILE, this.signSpot.y * TILE - 4);
    }
  }

  private drawWeather(snap: Snapshot, time: number, motion: number): void {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const heat = snap.effects.some((e) => e.kind === 'heatwave');
    const storm = snap.effects.some((e) => e.kind === 'storm') || snap.surge > 0.35;
    if (heat || snap.stream.airTemp > 28) {
      const k = Math.min(1, (snap.stream.airTemp - 24) / 10);
      g.fillStyle = `rgba(255, 140, 30, ${0.1 * k})`;
      g.fillRect(0, 0, w, h);
    }
    if (storm) {
      g.fillStyle = 'rgba(20, 30, 55, 0.18)';
      g.fillRect(0, 0, w, h);
      if (motion) {
        g.fillStyle = 'rgba(200, 225, 255, 0.55)';
        for (let n = 0; n < 160; n++) {
          const x = (hash2(n, 1, 77) * w + time * 0.05) % w;
          const y = (hash2(n, 2, 78) * h + time * 0.35) % h;
          g.fillRect(Math.round(x), Math.round(y), 1, 3);
        }
      }
    }
  }

  private drawEdits(opts: RenderOptions): void {
    const g = this.ctx;
    const colors: Record<MapEdit['brush'], string> = {
      water: 'rgba(58,143,198,0.85)',
      refuge: 'rgba(143,135,123,0.9)',
      bank: 'rgba(127,176,79,0.9)',
      trees: 'rgba(45,106,44,0.9)',
      pavement: 'rgba(93,97,104,0.9)',
      drain: 'rgba(20,20,20,0.9)',
    };
    for (const e of opts.edits) {
      g.fillStyle = colors[e.brush];
      if (e.brush === 'drain') g.fillRect(e.x * TILE + 2, e.y * TILE + 2, 4, 4);
      else g.fillRect(e.x * TILE, e.y * TILE, TILE, TILE);
    }
    if (opts.brush && opts.hover) {
      const r = opts.brush === 'drain' ? 0 : opts.brushSize - 1;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.strokeRect((opts.hover.x - r) * TILE + 0.5, (opts.hover.y - r) * TILE + 0.5, (2 * r + 1) * TILE - 1, (2 * r + 1) * TILE - 1);
    }
  }

  /** Nearest creature to a tile position, within about a tile and a half. */
  pick(snap: Snapshot, tx: number, ty: number): PickedOrganism | null {
    let best: PickedOrganism | null = null;
    let bestD = 2.3;
    const orgs = snap.organisms;
    for (let k = 0; k < orgs.length; k += ORG_FIELDS) {
      const id = orgs[k];
      const p = this.positions.get(id);
      const x = p ? p.x : orgs[k + 2];
      const y = p ? p.y : orgs[k + 3];
      const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty);
      if (d < bestD) {
        bestD = d;
        best = { id, species: SPECIES_INDEX[orgs[k + 1]] };
      }
    }
    return best;
  }

  /** Where a creature is drawn, in tiles (for following it). */
  positionOf(id: number): { x: number; y: number } | null {
    const p = this.positions.get(id);
    return p ? { x: p.x, y: p.y } : null;
  }
}
