import React from "react";

export const Situations = ({ situations, onOpenOrders }) => (
  <section className="oh-intent-section" aria-labelledby="intent-situations-title" data-testid="intent-surface-situations">
    <span className="oh-intent-eyebrow">Needs attention</span>
    <h2 id="intent-situations-title">Situations</h2>
    {situations.length === 0 && <div className="oh-intent-empty">Nothing currently requires intervention.</div>}
    {situations.map((situation) => (
      <article className="oh-intent-card oh-intent-card-grid" key={situation.situationId}>
        <div className="oh-intent-card-header"><strong>{situation.title}</strong><span className="oh-intent-tag" data-tone={situation.urgency === "immediate" ? "danger" : "warning"}>{situation.urgency}</span></div>
        <p className="oh-intent-muted">{situation.summary}</p>
        <button className="oh-intent-button" onClick={onOpenOrders}>Respond with an intention</button>
      </article>
    ))}
  </section>
);
