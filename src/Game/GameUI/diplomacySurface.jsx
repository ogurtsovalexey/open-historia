import React from "react";

export const DiplomacySurface = ({ diplomacy }) => (
  <section className="oh-intent-section" aria-labelledby="intent-diplomacy-title" data-testid="intent-surface-diplomacy">
    <span className="oh-intent-eyebrow">Conversation is not commitment</span>
    <h2 id="intent-diplomacy-title">Diplomacy</h2>
    <h3>Canonical commitments</h3>
    {diplomacy.commitments.length === 0 && <div className="oh-intent-empty">No active commitments.</div>}
    {diplomacy.commitments.map((commitment) => (
      <article className="oh-intent-card" key={commitment.commitmentId}>
        <strong>{commitment.title}</strong><p className="oh-intent-muted">{commitment.summary}</p>
      </article>
    ))}
    <h3>Conversations</h3>
    {diplomacy.conversations.length === 0 && <div className="oh-intent-empty">No current conversations.</div>}
    {diplomacy.conversations.map((conversation) => (
      <article className="oh-intent-card" key={conversation.conversationId}>
        <strong>{conversation.counterparty}</strong><p className="oh-intent-muted">{conversation.latestMessage}</p>
        <span className="oh-intent-tag">{conversation.status === "response-required" ? "Response required" : "Awaiting response"}</span>
      </article>
    ))}
  </section>
);
