import React from "react";
import { ProcessCard } from "./processCard";
import { intentText } from "./intentFirstText";

export const Details = ({ details, processes, locale }) => (
  <section className="oh-intent-section" aria-labelledby="intent-details-title" data-testid="intent-surface-details">
    <span className="oh-intent-eyebrow">{intentText(locale, "Secondary audit and domain views")}</span>
    <h2 id="intent-details-title">{intentText(locale, "Details")}</h2>
    <h3>{intentText(locale, "Long-running processes")}</h3>
    {processes.length > 0 ? processes.map((process) => <ProcessCard process={process} key={process.processId} locale={locale} />) : <div className="oh-intent-empty">{intentText(locale, "No active processes.")}</div>}
    <h3>{intentText(locale, "Domain detail")}</h3>
    {details.map((detail) => (
      <details className="oh-intent-card" key={detail.detailId}>
        <summary>{detail.label}</summary>
        <p className="oh-intent-muted">{detail.summary}</p>
      </details>
    ))}
  </section>
);
