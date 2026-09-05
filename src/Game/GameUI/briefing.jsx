import React from "react";
import { CausalLedger } from "./causalLedger";
import { intentText } from "./intentFirstText";

export const Briefing = ({ briefing, locale }) => (
  <section className="oh-intent-section" aria-labelledby="intent-briefing-title" data-testid="intent-surface-briefing">
    <span className="oh-intent-eyebrow">{intentText(locale, "What changed")}</span>
    <h2 id="intent-briefing-title">{briefing.headline}</h2>
    <p className="oh-intent-muted">{briefing.summary}</p>
    {briefing.changes.length > 0
      ? <CausalLedger changes={briefing.changes} locale={locale} />
      : <div className="oh-intent-empty">{intentText(locale, "No material changes since the previous decision.")}</div>}
    {briefing.territoryEffects?.map((effect) => (
      <article className="oh-intent-card oh-intent-card-grid" data-testid={`territory-effect-${effect.transferId}`} key={effect.transferId}>
        <div><span className="oh-intent-eyebrow">{intentText(locale, "Territorial transition")}</span><h3>{effect.regionName}</h3></div>
        <p className="oh-intent-muted">{effect.fromPolityId} → {effect.toPolityId}. Population remains attached to the region; formations keep their existing allegiance.</p>
        <div className="oh-intent-split">
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Population")}</span><div>{effect.population}</div></div>
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Tax base")}</span><div>{effect.taxBefore} → {effect.taxAfter}</div></div>
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Productive capacity")}</span><div>{effect.outputBefore} → {effect.outputAfter}</div></div>
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Recruitment access")}</span><div>{effect.recruitmentBefore} → {effect.recruitmentAfter}</div></div>
        </div>
        {effect.formationExceptions.length > 0 && <div><span className="oh-intent-eyebrow">{intentText(locale, "Formation exceptions")}</span><ul className="oh-intent-list">{effect.formationExceptions.map((entry) => <li key={entry.label}>{entry.label}: {entry.personnel}</li>)}</ul></div>}
      </article>
    ))}
  </section>
);
