import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/engine/constants';
import { createWorld } from '../src/engine/simulation';
import { SAMPLE_ANSWERS, buildProfile } from '../src/engine/streamProfile';
import { applyEdits, findRoute, generateTerrain, isChannelCode, walkable } from '../src/engine/terrain';
import { TERRAIN } from '../src/engine/types';
import { SEEDS } from './helpers';

describe('stream terrain (P0-2)', () => {
  it('draws one continuous channel from the upstream edge to the downstream edge', () => {
    for (const seed of SEEDS) {
      const world = createWorld({ seed, answers: SAMPLE_ANSWERS });
      const { width, height, terrain } = world;
      for (let x = 0; x < width; x++) {
        const rows: number[] = [];
        for (let y = 0; y < height; y++) if (isChannelCode(terrain[y * width + x])) rows.push(y);
        expect(rows.length).toBeGreaterThanOrEqual(3);
        expect(rows.length).toBeLessThanOrEqual(7);
      }
      // Flood fill from the left edge reaches the right edge.
      const seen = new Set<number>();
      const queue: number[] = [];
      for (let y = 0; y < height; y++) if (isChannelCode(terrain[y * width])) queue.push(y * width);
      while (queue.length) {
        const i = queue.pop()!;
        if (seen.has(i)) continue;
        seen.add(i);
        const x = i % width;
        const y = (i / width) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!seen.has(j) && isChannelCode(terrain[j])) queue.push(j);
        }
      }
      expect([...seen].some((i) => i % width === width - 1)).toBe(true);
      expect(seen.size).toBe(world.channel.length);
    }
  });

  it('has banks, bank trees, pavement and a storm drain beside the channel', () => {
    const world = createWorld({ seed: 7, answers: { ...SAMPLE_ANSWERS, banks: 'trees' } });
    const kinds = new Set(world.terrain);
    expect(kinds.has(TERRAIN.water)).toBe(true);
    expect(kinds.has(TERRAIN.trees)).toBe(true);
    expect(kinds.has(TERRAIN.pavement)).toBe(true);
    expect(kinds.has(TERRAIN.refuge)).toBe(true);
    const drains = [...world.drain.keys()].filter((i) => world.drain[i]);
    expect(drains.length).toBeGreaterThanOrEqual(1);
    const d = drains[0];
    const x = d % world.width;
    const y = (d / world.width) | 0;
    const nearWater = [-1, 0, 1].some((oy) => [-1, 0, 1].some((ox) => walkable(world, x + ox, y + oy)));
    expect(nearWater).toBe(true);
  });

  it('gives the same map for the same seed and a different map for another seed', () => {
    const profile = buildProfile(SAMPLE_ANSWERS);
    const a = generateTerrain(11, WORLD_WIDTH, WORLD_HEIGHT, profile);
    const b = generateTerrain(11, WORLD_WIDTH, WORLD_HEIGHT, profile);
    const c = generateTerrain(12, WORLD_WIDTH, WORLD_HEIGHT, profile);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
    expect(Buffer.from(a.drain).equals(Buffer.from(b.drain))).toBe(true);
    expect(Buffer.from(a.terrain).equals(Buffer.from(c.terrain))).toBe(false);
  });

  it('concrete banks put pavement right beside the water', () => {
    const world = createWorld({ seed: 3, answers: { ...SAMPLE_ANSWERS, banks: 'concrete' } });
    expect(world.stream.pavement).toBeGreaterThan(0.7);
    expect(world.stream.shade).toBeLessThan(0.05);
  });
});

describe('movement rules (P0-3)', () => {
  it('only channel tiles are walkable for aquatic species', () => {
    const world = createWorld({ seed: 5, answers: SAMPLE_ANSWERS });
    for (let i = 0; i < world.terrain.length; i++) {
      const x = i % world.width;
      const y = (i / world.width) | 0;
      expect(walkable(world, x, y)).toBe(isChannelCode(world.terrain[i]));
    }
    expect(walkable(world, -1, 0)).toBe(false);
    expect(walkable(world, world.width, 0)).toBe(false);
  });

  it('routes stay inside the channel', () => {
    const world = createWorld({ seed: 9, answers: SAMPLE_ANSWERS });
    const a = world.channel[0];
    const b = world.channel[world.channel.length - 1];
    let x = a % world.width;
    let y = (a / world.width) | 0;
    const tx = b % world.width;
    const ty = (b / world.width) | 0;
    for (let steps = 0; steps < 400 && (x !== tx || y !== ty); steps++) {
      const next = findRoute(world, x, y, tx, ty, 5000);
      expect(next).not.toBeNull();
      [x, y] = next!;
      expect(walkable(world, x, y)).toBe(true);
    }
    expect([x, y]).toEqual([tx, ty]);
  });

  it('map edits move stranded creatures back into the water', () => {
    const world = createWorld({ seed: 2, answers: SAMPLE_ANSWERS });
    const o = world.organisms[0];
    applyEdits(world, [{ x: o.x, y: o.y, brush: 'pavement' }]);
    expect(walkable(world, o.x, o.y)).toBe(true);
    for (const org of world.organisms) expect(walkable(world, org.x, org.y)).toBe(true);
  });
});
