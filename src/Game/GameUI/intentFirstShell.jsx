import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Briefing } from "./briefing";
import { Country } from "./country";
import { Details } from "./details";
import { DiplomacySurface } from "./diplomacySurface";
import { INTENT_FIRST_SURFACES, assertIntentFirstCommands, parseIntentFirstProjection } from "./intentFirstProjection.js";
import { Orders } from "./orders";
import { Situations } from "./situations";
import "./intentFirst.css";

const SURFACES = [
  { id: "briefing", icon: "◈", label: "Briefing" },
  { id: "orders", icon: "✦", label: "Orders" },
  { id: "diplomacy", icon: "◇", label: "Diplomacy" },
  { id: "country", icon: "⌂", label: "Country" },
  { id: "situations", icon: "!", label: "Situations" },
  { id: "details", icon: "≡", label: "Details" },
];

export const IntentFirstShell = ({ projection: rawProjection, commands: rawCommands }) => {
  const projection = useMemo(() => parseIntentFirstProjection(rawProjection), [rawProjection]);
  const commands = useMemo(() => assertIntentFirstCommands(rawCommands), [rawCommands]);
  const [surface, setSurface] = useState("briefing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const invoke = useCallback(async (command) => {
    setBusy(true);
    setError("");
    try {
      await command();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.altKey && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setSurface(INTENT_FIRST_SURFACES[Number(event.key) - 1]);
      }
      if (event.key === "Escape" && projection.interpretation?.confirmationRequired) {
        void invoke(() => commands.dismissInterpretation({
          revision: projection.revision,
          interpretationId: projection.interpretation.interpretationId,
        }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands, invoke, projection.interpretation, projection.revision]);

  const orderProps = {
    interpretation: projection.interpretation,
    busy,
    error,
    onSubmit: (intentions) => invoke(() => commands.submitIntent({ revision: projection.revision, intentions })),
    onConfirm: (interpretationId) => invoke(() => commands.confirmInterpretation({ revision: projection.revision, interpretationId })),
    onDismiss: (interpretationId) => invoke(() => commands.dismissInterpretation({ revision: projection.revision, interpretationId })),
  };

  const moveTabFocus = (event, index) => {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SURFACES.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + SURFACES.length) % SURFACES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SURFACES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setSurface(SURFACES[nextIndex].id);
    document.getElementById(`intent-tab-${SURFACES[nextIndex].id}`)?.focus();
  };

  return (
    <aside className="oh-intent-shell" aria-label="History command center" data-testid="intent-first-shell">
      <nav className="oh-intent-nav" aria-label="Game surfaces" role="tablist">
        {SURFACES.map((item, index) => (
          <button
            id={`intent-tab-${item.id}`}
            key={item.id}
            role="tab"
            aria-selected={surface === item.id}
            aria-controls="intent-active-panel"
            tabIndex={surface === item.id ? 0 : -1}
            data-testid={`intent-nav-${item.id}`}
            onClick={() => setSurface(item.id)}
            onKeyDown={(event) => moveTabFocus(event, index)}
          >
            <span className="oh-intent-nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <main id="intent-active-panel" className="oh-intent-body" role="tabpanel" aria-labelledby={`intent-tab-${surface}`}>
        {surface === "briefing" && <Briefing briefing={projection.briefing} />}
        {surface === "orders" && <Orders {...orderProps} />}
        {surface === "diplomacy" && <DiplomacySurface diplomacy={projection.diplomacy} />}
        {surface === "country" && <Country playerPolity={projection.playerPolity} facts={projection.facts} />}
        {surface === "situations" && <Situations situations={projection.situations} onOpenOrders={() => setSurface("orders")} />}
        {surface === "details" && <Details details={projection.details} processes={projection.processes} />}
      </main>
      <footer className="oh-intent-footer">
        <div className="oh-intent-footer-meta"><strong>{projection.time.label}</strong> · {projection.playerPolity.displayName}</div>
        {projection.strategicCheckpoint && (
          <div className="oh-intent-card" data-testid="strategic-checkpoint" role="status">
            <strong>Strategic decision required</strong>
            <p className="oh-intent-muted">{projection.strategicCheckpoint.blockedTasks.map((task) => task.reason).join(" ")}</p>
            <div className="oh-intent-actions">
              <button
                className="oh-intent-button"
                data-testid="retry-strategic-checkpoint"
                disabled={busy}
                onClick={() => void invoke(() => commands.advanceTime({ revision: projection.revision, optionId: projection.time.options[0]?.optionId, strategicDisposition: "resolve" }))}
              >Retry</button>
              <button
                className="oh-intent-button"
                data-testid="continue-without-strategy"
                disabled={busy}
                onClick={() => void invoke(() => commands.advanceTime({ revision: projection.revision, optionId: projection.time.options[0]?.optionId, strategicDisposition: "continue-without-decisions" }))}
              >Continue without this decision</button>
            </div>
          </div>
        )}
        <button
          className="oh-intent-button"
          data-primary="true"
          data-testid="advance-time"
          disabled={busy || Boolean(projection.strategicCheckpoint) || projection.interpretation?.confirmationRequired || projection.time.options.length === 0}
          onClick={() => void invoke(() => commands.advanceTime({ revision: projection.revision, optionId: projection.time.options[0].optionId }))}
        >
          {projection.time.options[0]?.label ?? "Time unavailable"}
        </button>
      </footer>
    </aside>
  );
};

export default IntentFirstShell;
