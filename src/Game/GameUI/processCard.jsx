import React from "react";
import { WhyDisclosure } from "./causalLedger";
import { intentText } from "./intentFirstText";

export const ProcessCard = ({ process, locale }) => {
  const progress = Math.max(0, Math.min(100, Number(process.progressPercent) || 0));
  return (
    <article className="oh-intent-card oh-intent-card-grid" data-testid={`process-card-${process.processId}`}>
      <div className="oh-intent-card-header">
        <div>
          <strong>{locale === "ru" && process.nameRu ? process.nameRu : process.name}</strong>
          <div className="oh-intent-muted">{process.direction}</div>
        </div>
        <span className="oh-intent-tag">{process.stage}</span>
      </div>
      <div className="oh-intent-split">
        <div><span className="oh-intent-eyebrow">{intentText(locale, "Pace")}</span><div>{process.pace}</div></div>
        <div><span className="oh-intent-eyebrow">{intentText(locale, "Feasibility")}</span><div>{process.feasibility}</div></div>
      </div>
      <div className="oh-intent-split">
        <div><span className="oh-intent-eyebrow">{intentText(locale, "Main inputs")}</span><ul className="oh-intent-list">{process.mainInputs.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><span className="oh-intent-eyebrow">{intentText(locale, "Spending")}</span><div>{process.spending}</div></div>
      </div>
      <div>
        <div className="oh-intent-card-header"><span>{intentText(locale, "Progress")}</span><span data-no-translate="true">{process.progressLabel}</span></div>
        <div className="oh-intent-progress" aria-label={`Progress: ${process.progressLabel}`}><span style={{ width: `${progress}%` }} /></div>
      </div>
      {(process.blockers?.length > 0 || process.accelerators?.length > 0) && (
        <div className="oh-intent-split">
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Blockers")}</span><ul className="oh-intent-list">{process.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Accelerators")}</span><ul className="oh-intent-list">{process.accelerators.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      )}
      {(process.support.length > 0 || process.opposition.length > 0) && (
        <div className="oh-intent-split">
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Support")}</span><ul className="oh-intent-list">{process.support.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><span className="oh-intent-eyebrow">{intentText(locale, "Opposition")}</span><ul className="oh-intent-list">{process.opposition.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      )}
      <div><span className="oh-intent-eyebrow">{intentText(locale, "Last semantic decision")}</span><div>{process.lastSemanticDecision}</div></div>
      <div className="oh-intent-muted">{intentText(locale, "Next checkpoint")}: {process.nextCheckpoint}</div>
      <WhyDisclosure reasons={process.latestChanges ?? []} evidenceCount={process.evidenceIds?.length ?? 0} sourceLabels={process.sourceLabels} locale={locale} />
    </article>
  );
};
