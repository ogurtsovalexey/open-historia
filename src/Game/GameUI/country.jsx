import React from "react";
import { GroundedValue } from "./causalLedger";
import { intentText } from "./intentFirstText";

export const Country = ({ playerPolity, facts, locale }) => (
  <section className="oh-intent-section" aria-labelledby="intent-country-title" data-testid="intent-surface-country">
    <span className="oh-intent-eyebrow">{intentText(locale, "Compact grounded condition")}</span>
    <h2 id="intent-country-title">{playerPolity.displayName}</h2>
    {facts.length > 0 ? facts.map((fact) => <GroundedValue fact={fact} key={fact.factId} locale={locale} />) : <div className="oh-intent-empty">No grounded country facts are available.</div>}
  </section>
);
