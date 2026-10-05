import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapEdit } from '../engine/types';
import { dayLabel } from './format';
import { usePrefersReducedMotion } from './hooks';
import { PauseIcon, PlayIcon } from './icons';
import { StreamRenderer, TILE } from './renderer';
import type { SimulationHandle } from './useSimulation';

type Brush = MapEdit['brush'];

const BRUSHES: Array<{ id: Brush; label: string; hint: string }> = [
  { id: 'water', label: 'Water', hint: 'Open channel' },
  { id: 'refuge', label: 'Stones', hint: 'Refuge from fish' },
  { id: 'bank', label: 'Open bank', hint: 'Grass, no shade' },
  { id: 'trees', label: 'Trees', hint: 'Shade and filtering' },
  { id: 'pavement', label: 'Pavement', hint: 'More runoff' },
  { id: 'drain', label: 'Drain', hint: 'Toggle a storm drain' },
];

const ZOOMS = [1, 1.5, 2, 3];
const SPEEDS = [1, 2, 4];

export function Stage({
  sim,
  selectedId,
  following,
  onSelect,
  active,
}: {
  sim: SimulationHandle;
  selectedId: number | null;
  following: boolean;
  onSelect: (id: number | null) => void;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StreamRenderer | null>(null);
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(false);
  const [brush, setBrush] = useState<Brush>('trees');
  const [brushSize, setBrushSize] = useState(1);
  const [strokes, setStrokes] = useState<MapEdit[][]>([]);
  const strokesRef = useRef<MapEdit[][]>([]);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const painting = useRef(false);
  const reduced = usePrefersReducedMotion();
  const selectedRef = useRef(selectedId);
  const followRef = useRef(following);
  const editingRef = useRef(editing);
  const brushRef = useRef({ brush, brushSize });
  selectedRef.current = selectedId;
  followRef.current = following;
  editingRef.current = editing;
  brushRef.current = { brush, brushSize };
  strokesRef.current = strokes;

  const snap = sim.snapshot;

  // Render loop.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!rendererRef.current) rendererRef.current = new StreamRenderer(canvas);
    const renderer = rendererRef.current;
    let raf = 0;
    const frame = (now: number) => {
      const s = sim.snapshotRef.current;
      const t = sim.terrainRef.current;
      if (s && t) {
        renderer.setTerrain(t);
        renderer.render(s, {
          time: now,
          selectedId: selectedRef.current,
          edits: editingRef.current ? strokesRef.current.flat() : [],
          hover: editingRef.current ? hoverRef.current : null,
          brush: editingRef.current ? brushRef.current.brush : null,
          brushSize: brushRef.current.brushSize,
          reducedMotion: reduced,
        });
        if (followRef.current && selectedRef.current !== null && scrollRef.current) {
          const p = renderer.positionOf(selectedRef.current);
          const el = scrollRef.current;
          if (p && el.scrollWidth > el.clientWidth + 2) {
            const scale = el.scrollWidth / (t.width * TILE);
            el.scrollLeft += ((p.x * TILE * scale - el.clientWidth / 2) - el.scrollLeft) * 0.15;
            el.scrollTop += ((p.y * TILE * scale - el.clientHeight / 2) - el.scrollTop) * 0.15;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sim, reduced, active]);

  const tileAt = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    const t = sim.terrainRef.current;
    if (!canvas || !t) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * t.width;
    const y = ((e.clientY - rect.top) / rect.height) * t.height;
    return { fx: x, fy: y, x: Math.floor(x), y: Math.floor(y) };
  }, [sim]);

  const paint = useCallback((x: number, y: number) => {
    const t = sim.terrainRef.current;
    if (!t) return;
    const { brush: b, brushSize: size } = brushRef.current;
    const r = b === 'drain' ? 0 : size - 1;
    const add: MapEdit[] = [];
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) continue;
        add.push({ x: nx, y: ny, brush: b });
      }
    }
    setStrokes((all) => {
      const copy = all.slice();
      const current = (copy[copy.length - 1] ?? []).filter((e) => !add.some((a) => a.x === e.x && a.y === e.y));
      copy[copy.length - 1] = current.concat(add);
      return copy;
    });
  }, [sim]);

  const onPointerDown = (e: React.PointerEvent) => {
    const tile = tileAt(e);
    if (!tile) return;
    if (editing) {
      painting.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setStrokes((s) => s.concat([[]]));
      paint(tile.x, tile.y);
      return;
    }
    const s = sim.snapshotRef.current;
    if (!s || !rendererRef.current) return;
    const picked = rendererRef.current.pick(s, tile.fx, tile.fy);
    onSelect(picked ? picked.id : null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editing) return;
    const tile = tileAt(e);
    hoverRef.current = tile ? { x: tile.x, y: tile.y } : null;
    if (painting.current && tile) paint(tile.x, tile.y);
  };

  const onPointerUp = () => {
    painting.current = false;
  };

  const startEditing = () => {
    sim.send({ type: 'pause' });
    setEditing(true);
    setStrokes([]);
    onSelect(null);
  };

  const applyEdits = () => {
    // One edit per tile (the last brush wins), so a drain painted twice does not toggle back off.
    const byTile = new Map<string, MapEdit>();
    for (const e of strokes.flat()) byTile.set(`${e.x},${e.y}`, e);
    const edits = [...byTile.values()];
    if (edits.length) sim.send({ type: 'edit', edits });
    setStrokes([]);
    setEditing(false);
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => undefined);
  };

  const playing = snap?.playing ?? false;
  const s = snap?.stream;

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div className="stage-toolbar" role="toolbar" aria-label="Simulation controls">
        <span className="day" aria-live="off">{snap ? dayLabel(snap.timeline.liveTick) : 'Day 1'}</span>
        {!editing && (
          <>
            <button
              className="btn icon primary"
              onClick={() => sim.send({ type: playing ? 'pause' : 'play' })}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="seg" role="group" aria-label="Speed">
              {SPEEDS.map((v) => (
                <button key={v} className={snap?.speed === v ? 'on' : ''} aria-pressed={snap?.speed === v} onClick={() => sim.send({ type: 'speed', speed: v })}>
                  {v}×
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Zoom">
              {ZOOMS.map((z) => (
                <button key={z} className={zoom === z ? 'on' : ''} aria-pressed={zoom === z} onClick={() => setZoom(z)} title={`Zoom ${z}×`}>
                  {z === 1 ? 'Fit' : `${z}×`}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <button className="btn small ghost" onClick={startEditing}>Edit map</button>
            <button className="btn small ghost" onClick={toggleFullscreen} aria-label="Full screen">⛶</button>
          </>
        )}
        {editing && (
          <div className="editor" role="group" aria-label="Map editor">
            <div className="brushes">
              {BRUSHES.map((b) => (
                <button key={b.id} className={`brush brush-${b.id} ${brush === b.id ? 'on' : ''}`} aria-pressed={brush === b.id} onClick={() => setBrush(b.id)} title={b.hint}>
                  <span className="brush-swatch" aria-hidden="true" /> {b.label}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Brush size">
              {[1, 2].map((n) => (
                <button key={n} className={brushSize === n ? 'on' : ''} aria-pressed={brushSize === n} onClick={() => setBrushSize(n)}>
                  {n === 1 ? 'Small' : 'Big'}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <button className="btn small ghost" disabled={!strokes.length} onClick={() => setStrokes((st) => st.slice(0, -1))}>Undo</button>
            <button className="btn small ghost" onClick={() => { setStrokes([]); setEditing(false); }}>Cancel</button>
            <button className="btn small primary" onClick={applyEdits}>Apply</button>
          </div>
        )}
      </div>
      <div className={`stage ${editing ? 'editing' : ''} ${snap && !snap.live ? 'past' : ''}`} ref={scrollRef}>
        <canvas
          ref={canvasRef}
          className="pixel stage-canvas"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { hoverRef.current = null; painting.current = false; }}
          role="img"
          aria-label={
            s && snap
              ? `Stream view, ${dayLabel(snap.tick)}. ${snap.counts.mayfly} mayflies, ${snap.counts.midge} midges, ${snap.counts.mosquito} mosquito larvae and ${snap.counts.fish} fish. Water ${Math.round(s.waterTemp)} degrees, oxygen ${Math.round(s.oxygen)}.`
              : 'Stream view'
          }
        />
        {snap && !snap.live && <div className="past-badge">Viewing the past</div>}
        {editing && <div className="past-badge edit">Map editor: paint, then Apply</div>}
      </div>
    </div>
  );
}
