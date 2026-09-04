import React from "react";
import { GroundedValue } from "./causalLedger";

export const Country = ({ playerPolity, facts }) => (
  <section className="oh-intent-section" aria-labelledby="intent-country-title" data-testid="intent-surface-country">
    <span className="oh-intent-eyebrow">Compact grounded condition</span>
    <h2 id="intent-country-title">{playerPolity.displayName}</h2>
    {facts.length > 0 ? facts.map((fact) => <GroundedValue fact={fact} key={fact.factId} />) : <div className="oh-intent-empty">No grounded country facts are available.</div>}
  </section>
);
