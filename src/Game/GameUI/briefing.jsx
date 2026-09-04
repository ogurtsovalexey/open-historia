import React from "react";
import { CausalLedger } from "./causalLedger";

export const Briefing = ({ briefing }) => (
  <section className="oh-intent-section" aria-labelledby="intent-briefing-title" data-testid="intent-surface-briefing">
    <span className="oh-intent-eyebrow">What changed</span>
    <h2 id="intent-briefing-title">{briefing.headline}</h2>
    <p className="oh-intent-muted">{briefing.summary}</p>
    {briefing.changes.length > 0
      ? <CausalLedger changes={briefing.changes} />
      : <div className="oh-intent-empty">No material changes since the previous decision.</div>}
  </section>
);
