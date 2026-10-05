export const ONEAQUAHEALTH_URL = 'https://www.oneaquahealth.eu/';

export function TakeAction({ onClose }: { onClose: () => void }) {
  return (
    <section className="card take-action" aria-labelledby="action-title">
      <div className="card-head">
        <h2 id="action-title">What you can do for a real stream</h2>
        <button className="linklike small" onClick={onClose} aria-label="Dismiss">Close</button>
      </div>
      <ol>
        <li><strong>Keep the banks green.</strong> Protect bank trees and plants, or join a planting day. They shade the water and catch runoff.</li>
        <li><strong>Only rain down the drain.</strong> Never pour paint, oil, soap or waste into a street drain: it often flows straight into a stream.</li>
        <li><strong>Stay safe after storms.</strong> Keep skin, children and pets out of the water for a few days after heavy rain or a sewage smell.</li>
        <li><strong>Record what you see.</strong> Share observations of your stream through the OneAquaHealth citizen science app so experts can follow it.</li>
      </ol>
      <a className="btn primary small" href={ONEAQUAHEALTH_URL} target="_blank" rel="noopener noreferrer">
        Go to OneAquaHealth
      </a>
    </section>
  );
}
