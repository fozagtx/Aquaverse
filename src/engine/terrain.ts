import { nextFloat, seedRng, type RngState } from './rng';
import { TREE_GROWTH_SECONDS } from './constants';
import { TERRAIN, type MapEdit, type Organism, type StreamProfile, type World } from './types';

export interface TerrainLayers {
  width: number;
  height: number;
  terrain: Uint8Array;
  drain: Uint8Array;
  treeGrowth: Float32Array;
}

const NEIGHBORS_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function isChannelCode(code: number): boolean {
  return code === TERRAIN.water || code === TERRAIN.refuge;
}

/** Aquatic species may only enter channel tiles (open water and refuges). */
export function walkable(world: Pick<World, 'width' | 'height' | 'terrain'>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return isChannelCode(world.terrain[y * world.width + x]);
}

/** Smooth value noise in 0..1 used for tree clumps and channel shape. */
function valueNoise(rng: RngState, width: number, height: number, cell: number): Float32Array {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = nextFloat(rng);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * width + x] = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    }
  }
  return out;
}

/**
 * Draws a meandering channel 3 to 6 tiles wide from the left edge (upstream)
 * to the right edge (downstream), with banks, bank trees and an urban edge.
 * The channel shape depends only on the seed; the banks depend on the profile.
 */
export function generateTerrain(seed: number, width: number, height: number, profile: StreamProfile): TerrainLayers {
  const shapeRng = seedRng(seed ^ 0x5eed1234);
  const vegRng = seedRng(seed ^ 0x7ee5c0de);
  const terrain = new Uint8Array(width * height).fill(TERRAIN.pavement);
  const drain = new Uint8Array(width * height);
  const treeGrowth = new Float32Array(width * height);

  const amp1 = height * (0.12 + 0.08 * nextFloat(shapeRng));
  const amp2 = height * (0.03 + 0.04 * nextFloat(shapeRng));
  const f1 = (Math.PI * 2) / (width * (0.75 + 0.5 * nextFloat(shapeRng)));
  const f2 = (Math.PI * 2) / (width * (0.25 + 0.15 * nextFloat(shapeRng)));
  const p1 = nextFloat(shapeRng) * Math.PI * 2;
  const p2 = nextFloat(shapeRng) * Math.PI * 2;
  const fw = (Math.PI * 2) / (width * (0.3 + 0.3 * nextFloat(shapeRng)));
  const pw = nextFloat(shapeRng) * Math.PI * 2;
  // One wider pool somewhere in the middle third.
  const poolX = Math.floor(width * (0.4 + 0.25 * nextFloat(shapeRng)));

  const top = new Int32Array(width);
  const bottom = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    const cy = height / 2 + amp1 * Math.sin(x * f1 + p1) + amp2 * Math.sin(x * f2 + p2);
    let w = 4.4 + 1.3 * Math.sin(x * fw + pw);
    const poolDist = Math.abs(x - poolX);
    if (poolDist < 4) w += 1.6 * (1 - poolDist / 4);
    const wi = Math.max(3, Math.min(6, Math.round(w)));
    let t = Math.round(cy - wi / 2);
    t = Math.max(3, Math.min(height - 3 - wi, t));
    // Keep consecutive columns overlapping so the channel stays continuous.
    if (x > 0) {
      t = Math.max(top[x - 1] - wi + 2, Math.min(bottom[x - 1] - 1, t));
    }
    top[x] = t;
    bottom[x] = t + wi - 1;
    for (let y = t; y <= t + wi - 1; y++) terrain[y * width + x] = TERRAIN.water;
  }

  // Distance from the channel, for banks.
  const dist = channelDistance(terrain, width, height);

  // Bank width shrinks as the surroundings get more paved.
  const bankNoise = valueNoise(vegRng, width, height, 7);
  const baseBank = 1 + (1 - profile.pavement) * 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (terrain[i] === TERRAIN.water) continue;
      const bankWidth = Math.max(1, Math.round(baseBank + (bankNoise[i] - 0.5) * 3));
      if (dist[i] <= bankWidth) terrain[i] = TERRAIN.bank;
    }
  }

  // Bank trees in clumps, most likely right beside the channel.
  const treeNoise = valueNoise(vegRng, width, height, 4);
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN.bank) continue;
    const near = dist[i] <= 3 ? 1 : 0.55;
    const threshold = profile.treeCover * near;
    const n = treeNoise[i] * 0.75 + nextFloat(vegRng) * 0.25;
    if (n < threshold) {
      terrain[i] = TERRAIN.trees;
      treeGrowth[i] = 1;
    }
  }

  // Refuges: stones mid-channel, roots along tree-lined edges.
  const refugeShare = 0.04 + 0.07 * (1 - profile.pavement);
  for (let x = 0; x < width; x++) {
    for (let y = top[x]; y <= bottom[x]; y++) {
      const i = y * width + x;
      const edge = y === top[x] || y === bottom[x];
      const besideTree = edge && hasNeighbor(terrain, width, height, x, y, TERRAIN.trees);
      const p = refugeShare * (besideTree ? 2.2 : edge ? 0.6 : 1.1);
      if (nextFloat(vegRng) < p) terrain[i] = TERRAIN.refuge;
    }
  }

  // A storm drain outfall in the upstream third, on the more paved side.
  const dx = Math.floor(width * (0.22 + 0.12 * nextFloat(vegRng)));
  const above = top[dx] - 1;
  const below = bottom[dx] + 1;
  const pavedAbove = countKind(terrain, width, height, dx, above - 4, TERRAIN.pavement, 4);
  const pavedBelow = countKind(terrain, width, height, dx, below + 4, TERRAIN.pavement, 4);
  const dy = pavedAbove >= pavedBelow ? above : below;
  const di = dy * width + dx;
  terrain[di] = TERRAIN.pavement;
  treeGrowth[di] = 0;
  drain[di] = 1;
  // Pave a short path from the drain back to the street so it reads as a pipe.
  const dir = dy === above ? -1 : 1;
  for (let k = 1; k <= 8; k++) {
    const y = dy + dir * k;
    if (y < 0 || y >= height) break;
    const j = y * width + dx;
    if (terrain[j] === TERRAIN.pavement) break;
    terrain[j] = TERRAIN.pavement;
    treeGrowth[j] = 0;
  }

  return { width, height, terrain, drain, treeGrowth };
}

function hasNeighbor(terrain: Uint8Array, width: number, height: number, x: number, y: number, code: number): boolean {
  for (const [ox, oy] of NEIGHBORS_8) {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (terrain[ny * width + nx] === code) return true;
  }
  return false;
}

function countKind(terrain: Uint8Array, width: number, height: number, cx: number, cy: number, code: number, r: number): number {
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (terrain[y * width + x] === code) n++;
    }
  }
  return n;
}

/** Chebyshev distance from every tile to the nearest channel tile. */
export function channelDistance(terrain: Uint8Array, width: number, height: number): Int32Array {
  const dist = new Int32Array(width * height).fill(1 << 20);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (isChannelCode(terrain[i])) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i / width) | 0;
    for (const [ox, oy] of NEIGHBORS_8) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
  }
  return dist;
}

/** Distance inside the channel to the nearest bank (1 = touching the bank). */
function edgeDistance(terrain: Uint8Array, width: number, height: number): Int32Array {
  const dist = new Int32Array(width * height).fill(0);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (!isChannelCode(terrain[i])) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let touches = false;
    for (const [ox, oy] of NEIGHBORS_8) {
      const nx = x + ox;
      const ny = y + oy;
      // The map's top and bottom edges count as banks; left and right are open water.
      if (ny < 0 || ny >= height) { touches = true; break; }
      if (nx < 0 || nx >= width) continue;
      if (!isChannelCode(terrain[ny * width + nx])) { touches = true; break; }
    }
    if (touches) {
      dist[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i / width) | 0;
    for (const [ox, oy] of NEIGHBORS_8) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (isChannelCode(terrain[j]) && dist[j] === 0) {
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
  }
  return dist;
}

/**
 * Recomputes everything that follows from the terrain: the channel tile list,
 * local flow (slow at the edges and in pools), local shade and the stream's
 * shade, runoff filtering and paved share.
 */
export function refreshDerived(world: World): void {
  const { width, height, terrain } = world;
  const channel: number[] = [];
  for (let i = 0; i < terrain.length; i++) if (isChannelCode(terrain[i])) channel.push(i);
  world.channel = Int32Array.from(channel);

  const edge = edgeDistance(terrain, width, height);
  const colWidth = new Int32Array(width);
  for (const i of channel) colWidth[i % width]++;
  world.flowFactor.fill(0);
  for (const i of channel) {
    const d = edge[i];
    let f = d <= 1 ? 0.3 : d === 2 ? 0.85 : 1.25;
    if (colWidth[i % width] >= 6) f *= 0.8;
    world.flowFactor[i] = f;
  }

  refreshShade(world);
}

/** Local shade on each channel tile, plus stream-wide shade, filtering and paved share. */
export function refreshShade(world: World): void {
  const { width, height, terrain, treeGrowth } = world;
  const weights = [0, 0.35, 0.2, 0.1];
  world.localShade.fill(0);
  for (const i of world.channel) {
    const x = i % width;
    const y = (i / width) | 0;
    let s = 0;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (terrain[j] !== TERRAIN.trees) continue;
        const d = Math.max(Math.abs(ox), Math.abs(oy));
        s += weights[d] * treeGrowth[j];
      }
    }
    world.localShade[i] = Math.min(1, s);
  }

  const dist = channelDistance(terrain, width, height);
  let besideCount = 0;
  let besideTrees = 0;
  let nearLand = 0;
  let nearFilter = 0;
  let wideLand = 0;
  let widePaved = 0;
  for (let i = 0; i < terrain.length; i++) {
    const d = dist[i];
    if (d === 0) continue;
    const code = terrain[i];
    const tree = code === TERRAIN.trees ? treeGrowth[i] : 0;
    if (d === 1) {
      besideCount++;
      besideTrees += tree;
    }
    if (d <= 3) {
      nearLand++;
      nearFilter += code === TERRAIN.trees ? 0.4 + 0.6 * treeGrowth[i] : code === TERRAIN.bank ? 0.3 : 0;
    }
    if (d <= 10) {
      wideLand++;
      if (code === TERRAIN.pavement) widePaved++;
    }
  }
  world.stream.shade = besideCount ? besideTrees / besideCount : 0;
  world.stream.filtering = nearLand ? nearFilter / nearLand : 0;
  world.stream.pavement = wideLand ? widePaved / wideLand : 0;
}

/**
 * Next step from (x, y) toward (tx, ty) through channel tiles. Tries a greedy
 * step first and falls back to a bounded breadth-first search around obstacles.
 * Returns null when already there or unreachable.
 */
export function findRoute(
  world: Pick<World, 'width' | 'height' | 'terrain'>,
  x: number,
  y: number,
  tx: number,
  ty: number,
  maxNodes = 600,
): [number, number] | null {
  if (x === tx && y === ty) return null;
  const d0 = Math.max(Math.abs(tx - x), Math.abs(ty - y));
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  for (const [ox, oy] of NEIGHBORS_8) {
    const nx = x + ox;
    const ny = y + oy;
    if (!walkable(world, nx, ny)) continue;
    const cheb = Math.max(Math.abs(tx - nx), Math.abs(ty - ny));
    const eu = (tx - nx) ** 2 + (ty - ny) ** 2;
    const score = cheb * 100 + eu;
    if (cheb < d0 && score < bestScore) {
      bestScore = score;
      best = [nx, ny];
    }
  }
  if (best) return best;
  return bfsStep(world, x, y, tx, ty, maxNodes);
}

function bfsStep(
  world: Pick<World, 'width' | 'height' | 'terrain'>,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxNodes: number,
): [number, number] | null {
  const { width } = world;
  const start = sy * width + sx;
  const goal = ty * width + tx;
  const prev = new Map<number, number>();
  prev.set(start, -1);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length && prev.size < maxNodes) {
    const i = queue[head++];
    if (i === goal) break;
    const x = i % width;
    const y = (i / width) | 0;
    for (const [ox, oy] of NEIGHBORS_8) {
      const nx = x + ox;
      const ny = y + oy;
      if (!walkable(world, nx, ny)) continue;
      const j = ny * width + nx;
      if (prev.has(j)) continue;
      prev.set(j, i);
      queue.push(j);
    }
  }
  if (!prev.has(goal)) return null;
  let cur = goal;
  while (prev.get(cur) !== start) {
    const p = prev.get(cur);
    if (p === undefined || p < 0) return null;
    cur = p;
  }
  return [cur % width, (cur / width) | 0];
}

/** Nearest channel tile to (x, y), searching outward. */
export function nearestChannel(world: World, x: number, y: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const i of world.channel) {
    const cx = i % world.width;
    const cy = (i / world.width) | 0;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [cx, cy];
    }
  }
  return best;
}

/** Applies map editor brushes and keeps every organism inside the channel. */
export function applyEdits(world: World, edits: MapEdit[]): number {
  let changed = 0;
  for (const e of edits) {
    if (e.x < 0 || e.y < 0 || e.x >= world.width || e.y >= world.height) continue;
    const i = e.y * world.width + e.x;
    if (e.brush === 'drain') {
      const next = world.drain[i] ? 0 : 1;
      if (next && isChannelCode(world.terrain[i])) continue;
      world.drain[i] = next;
      changed++;
      continue;
    }
    const code = TERRAIN[e.brush];
    if (world.terrain[i] === code) continue;
    world.terrain[i] = code;
    world.treeGrowth[i] = code === TERRAIN.trees ? 1 : 0;
    if (isChannelCode(code)) world.drain[i] = 0;
    if (!isChannelCode(code)) {
      world.algae[i] = 0;
      world.plume[i] = 0;
    } else if (world.algae[i] === 0) {
      world.algae[i] = world.stream.meanAlgae || 0.3;
    }
    changed++;
  }
  if (!changed) return 0;
  refreshDerived(world);
  relocateStranded(world);
  world.terrainVersion++;
  return changed;
}

function relocateStranded(world: World): void {
  if (world.channel.length === 0) {
    world.organisms.length = 0;
    return;
  }
  for (const o of world.organisms) {
    if (walkable(world, o.x, o.y)) continue;
    const spot = nearestChannel(world, o.x, o.y);
    if (!spot) continue;
    moveTo(o, spot[0], spot[1]);
    o.px = o.x;
    o.py = o.y;
  }
}

export function moveTo(o: Organism, x: number, y: number): void {
  o.px = o.x;
  o.py = o.y;
  o.x = x;
  o.y = y;
}

/** Cuts trees within three tiles of the channel. Returns how many were cut. */
export function clearBankTrees(world: World): number {
  const dist = channelDistance(world.terrain, world.width, world.height);
  let n = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] === TERRAIN.trees && dist[i] <= 3) {
      world.terrain[i] = TERRAIN.bank;
      world.treeGrowth[i] = 0;
      n++;
    }
  }
  if (n) {
    refreshShade(world);
    world.terrainVersion++;
  }
  return n;
}

/** Plants saplings on open bank within three tiles of the channel. */
export function plantBankTrees(world: World): number {
  const dist = channelDistance(world.terrain, world.width, world.height);
  let n = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] === TERRAIN.bank && dist[i] <= 3 && !world.drain[i]) {
      world.terrain[i] = TERRAIN.trees;
      world.treeGrowth[i] = 0.12;
      n++;
    }
  }
  if (n) {
    refreshShade(world);
    world.terrainVersion++;
  }
  return n;
}

/** Saplings grow toward full size; call once per simulated second. Returns true while any are growing. */
export function growTrees(world: World): boolean {
  const step = 1 / TREE_GROWTH_SECONDS;
  let growing = false;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] !== TERRAIN.trees) continue;
    const g = world.treeGrowth[i];
    if (g < 1) {
      world.treeGrowth[i] = Math.min(1, g + step);
      growing = true;
    }
  }
  return growing;
}
