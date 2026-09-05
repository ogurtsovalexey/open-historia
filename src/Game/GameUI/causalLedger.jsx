import React from "react";
import { intentText } from "./intentFirstText";

const authorityLabel = {
  canonical: "Canonical",
  derived: "Engine derived",
  estimate: "Estimate range",
  narrative: "Interpretation",
  unknown: "Unknown",
};

export const GroundedValue = ({ fact, locale }) => (
  <article className="oh-intent-card" data-testid={`grounded-fact-${fact.factId}`}>
    <div className="oh-intent-card-header">
      <div>
        <strong>{fact.label}</strong>
        <div className="oh-intent-tag" data-tone={fact.authority === "unknown" ? "unknown" : undefined}>
          {authorityLabel[fact.authority]}
        </div>
      </div>
      <span className="oh-intent-value" data-no-translate="true">
        {fact.authority === "unknown" ? "—" : fact.value}
      </span>
    </div>
    {fact.authority === "unknown" && <p className="oh-intent-muted">{fact.unknownReason}</p>}
    <WhyDisclosure reasons={fact.why} evidenceCount={fact.evidenceIds.length} sourceLabels={fact.sourceLabels} locale={locale} />
  </article>
);

export const WhyDisclosure = ({ reasons = [], evidenceCount = 0, causes = [], sourceLabels = [], locale }) => (
  <details className="oh-intent-why">
    <summary>{intentText(locale, "Why?")}</summary>
    <div className="oh-intent-why-body">
      {causes.map((cause, index) => (
        <div key={`${cause.label}-${index}`}>
          <span className="oh-intent-cause-category">{cause.category.replaceAll("-", " ")}</span>{" "}
          {cause.label}: <span data-no-translate="true">{cause.contribution}</span>
        </div>
      ))}
      {reasons.map((reason, index) => <div key={`${reason}-${index}`}>{reason}</div>)}
      {causes.length === 0 && reasons.length === 0 && <div>No causal explanation is available.</div>}
      <div className="oh-intent-source">{sourceLabels.length > 0
        ? `Sources: ${sourceLabels.join(", ")}`
        : (evidenceCount > 0 ? `${evidenceCount} grounded source${evidenceCount === 1 ? "" : "s"}` : "No canonical source")}</div>
    </div>
  </details>
);

export const CausalLedger = ({ changes, locale }) => (
  <div className="oh-intent-card-grid" data-testid="causal-ledger">
    {changes.map((change) => (
      <article className="oh-intent-card" key={change.changeId} data-testid={`causal-change-${change.changeId}`}>
        <div className="oh-intent-card-header">
          <strong>{change.label}</strong>
          <span className="oh-intent-value" data-no-translate="true">{change.magnitude}</span>
        </div>
        <WhyDisclosure causes={change.causes} evidenceCount={change.evidenceIds.length} sourceLabels={change.sourceLabels} locale={locale} />
      </article>
    ))}
  </div>
);
