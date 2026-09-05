import React, { useState } from "react";
import { intentText } from "./intentFirstText";

const claimTone = (status) => ({ contradicted: "danger", supported: "positive", unknown: "warning" }[status]);

const PreviewList = ({ title, values }) => values.length > 0 && (
  <div><span className="oh-intent-eyebrow">{title}</span><ul className="oh-intent-list">{values.map((value) => <li key={value}>{value}</li>)}</ul></div>
);

export const Orders = ({ interpretation, busy, error, onSubmit, onConfirm, onDismiss, locale }) => {
  const [draft, setDraft] = useState("");
  const intentions = draft.split("\n").map((line) => line.trim()).filter(Boolean);
  const submit = async () => {
    if (intentions.length === 0) return;
    await onSubmit(intentions);
    setDraft("");
  };
  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <section className="oh-intent-section" aria-labelledby="intent-orders-title" data-testid="intent-surface-orders">
      <span className="oh-intent-eyebrow">{intentText(locale, "Express intent, not parameters")}</span>
      <h2 id="intent-orders-title">{intentText(locale, "Orders")}</h2>
      <label htmlFor="intent-order-draft" className="oh-intent-muted">{intentText(locale, "One intention per line. Claims about the past will be checked separately.")}</label>
      <textarea
        id="intent-order-draft"
        className="oh-intent-textarea"
        data-testid="intent-order-composer"
        data-no-translate="true"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Improve food security without weakening the frontier…"
      />
      <div className="oh-intent-actions">
        <button className="oh-intent-button" data-primary="true" data-testid="submit-intent" disabled={busy || intentions.length === 0} onClick={() => void submit()}>
          {intentions.length > 1 ? `${intentions.length} ${intentText(locale, "intentions")}` : intentText(locale, "Interpret intention")}
        </button>
      </div>
      <div className="oh-intent-status" role="status" aria-live="polite">{busy ? intentText(locale, "Checking against the current world…") : error}</div>
      {interpretation && (
        <div className="oh-intent-card-grid" data-testid="intent-interpretation">
          <div className="oh-intent-card">
            <span className="oh-intent-eyebrow">Interpreted from</span>
            <p data-no-translate="true">“{interpretation.sourceText}”</p>
          </div>
          {interpretation.claims.map((claim) => (
            <article className="oh-intent-card oh-intent-claim" data-status={claim.status} key={claim.claimId} data-testid={`claim-${claim.status}`}>
              <div className="oh-intent-card-header"><strong>{claim.text}</strong><span className="oh-intent-tag" data-tone={claimTone(claim.status)}>{claim.status}</span></div>
              <p className="oh-intent-muted">{claim.explanation}</p>
              <div className="oh-intent-source">{claim.evidenceIds.length > 0 ? `${claim.evidenceIds.length} grounded source${claim.evidenceIds.length === 1 ? "" : "s"}` : "No record found"}</div>
            </article>
          ))}
          {interpretation.requestedActions.map((action) => (
            <article className="oh-intent-card" key={action.actionId}>
              <span className="oh-intent-eyebrow">Typed action</span><strong>{action.summary}</strong>
              {action.targetLabels.length > 0 && <p className="oh-intent-muted">Affects: {action.targetLabels.join(", ")}</p>}
            </article>
          ))}
          {interpretation.proposedInitiatives.map((initiative) => (
            <article className="oh-intent-card" key={initiative.initiativeId}>
              <span className="oh-intent-eyebrow">New proposed process</span><strong>{initiative.summary}</strong>
            </article>
          ))}
          <article className="oh-intent-card oh-intent-card-grid" data-testid="intent-preview">
            <div className="oh-intent-split">
              <div><span className="oh-intent-eyebrow">Cost</span><div>{interpretation.preview.cost.label}</div></div>
              <div><span className="oh-intent-eyebrow">Duration</span><div>{interpretation.preview.duration.label}</div></div>
            </div>
            <PreviewList title="Risks" values={interpretation.preview.risks} />
            <PreviewList title="Opportunity cost" values={interpretation.preview.opportunityCosts} />
            <PreviewList title="Affected" values={interpretation.preview.affected} />
          </article>
          {interpretation.questions.map((question) => <div className="oh-intent-card" key={question.questionId}>{question.prompt}</div>)}
          {interpretation.confirmationRequired && (
            <div className="oh-intent-actions">
              <button className="oh-intent-button" data-primary="true" data-testid="confirm-intent" disabled={busy} onClick={() => void onConfirm(interpretation.interpretationId)}>{intentText(locale, "Confirm grounded actions")}</button>
              <button className="oh-intent-button" disabled={busy} onClick={() => void onDismiss(interpretation.interpretationId)}>{intentText(locale, "Revise")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
