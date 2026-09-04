import React from "react";
import { ProcessCard } from "./processCard";

export const Details = ({ details, processes }) => (
  <section className="oh-intent-section" aria-labelledby="intent-details-title" data-testid="intent-surface-details">
    <span className="oh-intent-eyebrow">Secondary audit and domain views</span>
    <h2 id="intent-details-title">Details</h2>
    <h3>Long-running processes</h3>
    {processes.length > 0 ? processes.map((process) => <ProcessCard process={process} key={process.processId} />) : <div className="oh-intent-empty">No active processes.</div>}
    <h3>Domain detail</h3>
    {details.map((detail) => (
      <details className="oh-intent-card" key={detail.detailId}>
        <summary>{detail.label}</summary>
        <p className="oh-intent-muted">{detail.summary}</p>
      </details>
    ))}
  </section>
);
