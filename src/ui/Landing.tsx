import { useEffect, useRef } from 'react';
import { SimulationRuntime } from '../engine/runtime';
import { SAMPLE_ANSWERS } from '../engine/streamProfile';
import { buildSnapshot } from '../worker/snapshot';
import { StressorIcon } from './icons';
import { StreamRenderer } from './renderer';
import { usePrefersReducedMotion } from './hooks';

/** A small live stream running on the page, so the landing shows the product, not a picture of it. */
function MiniStream() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rt = new SimulationRuntime({ seed: 31, answers: SAMPLE_ANSWERS });
    const renderer = new StreamRenderer(canvas);
    let snap = buildSnapshot({ world: rt.world, gauges: rt.gauges, live: true, playing: true, speed: 1, includeTerrain: true, runtime: rt });
    renderer.setTerrain(snap.terrain!);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let terrainVersion = snap.terrainVersion;
    const frame = (now: number) => {
      acc += Math.min(200, now - last);
      last = now;
      let stepped = false;
      while (acc >= 100) {
        acc -= 100;
        if (!reduced) {
          rt.step();
          stepped = true;
        }
      }
      if (stepped) {
        const include = rt.world.terrainVersion !== terrainVersion;
        snap = buildSnapshot({ world: rt.world, gauges: rt.gauges, live: true, playing: true, speed: 1, includeTerrain: include, runtime: rt });
        if (snap.terrain) {
          renderer.setTerrain(snap.terrain);
          terrainVersion = snap.terrainVersion;
        }
        // Keep the hero calm: trim history the landing never shows.
        if (rt.bookmarks.length > 20) rt.bookmarks.splice(0, rt.bookmarks.length - 20);
      }
      renderer.render(snap, { time: now, selectedId: null, edits: [], hover: null, brush: null, brushSize: 1, reducedMotion: reduced });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return <canvas ref={canvasRef} className="mini-stream pixel" aria-label="A live pixel-art urban stream with insects and fish" role="img" />;
}

export function Landing({ onCheck, onSample, onLoad }: { onCheck: () => void; onSample: () => void; onLoad: () => void }) {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">One Health, made playable</p>
          <h1>See your stream. Stress it. Understand why its health is your health.</h1>
          <p className="lede">
            AquaVerse is a living pixel-art urban stream. Describe a real stream in five plain questions, then bring on a heatwave,
            storm runoff or a sewage leak and watch the water, the wildlife and the people nearby rise and fall together.
          </p>
          <div className="hero-actions">
            <button className="btn primary big" onClick={onCheck}>Check my stream</button>
            <button className="btn secondary big" onClick={onSample}>Try a sample stream</button>
          </div>
          <p className="fineprint">
            No login. Runs in your browser. Your answers never leave your device. <button className="linklike" onClick={onLoad}>Load a saved run</button>
          </p>
        </div>
        <div className="hero-art">
          <MiniStream />
          <p className="caption">Live: mayfly nymphs, bloodworms, mosquito larvae and fish, each following simple local rules.</p>
        </div>
      </section>

      <section className="steps" aria-label="How it works">
        <article className="step">
          <span className="step-num">1</span>
          <h2>Describe</h2>
          <p>Five picture questions about clarity, smell, banks, creatures and flow build your stream. Not sure? Say so.</p>
        </article>
        <article className="step">
          <span className="step-num">2</span>
          <h2>Stress</h2>
          <p>
            <span className="inline-icons" aria-hidden="true">
              <StressorIcon kind="heatwave" size={18} /> <StressorIcon kind="storm" size={18} /> <StressorIcon kind="sewage" size={18} />
            </span>
            Heatwave, drought, storm runoff, sewage, or the bank trees: clear them or plant them.
          </p>
        </article>
        <article className="step">
          <span className="step-num">3</span>
          <h2>Understand</h2>
          <p>Three gauges move: ecosystem health, biodiversity and human health risk. One sentence tells you why.</p>
        </article>
      </section>

      <section className="onehealth-strip">
        <h2>Why a stream's health is your health</h2>
        <p>
          Which creatures live in a stream tells you about its water. Sensitive mayflies need cool water full of oxygen. Tolerant
          midges survive almost anything. When fish are lost and the water stands still, mosquito larvae take over, and their
          adults bite. A sewage leak brings germs. A bloom of algae can carry toxins. Trees on the banks keep it all in balance.
        </p>
        <p className="honest">
          Every rule in AquaVerse is a simplified teaching assumption, written down in the field guide. It is not a measurement
          or prediction of a real stream.
        </p>
      </section>
    </div>
  );
}
