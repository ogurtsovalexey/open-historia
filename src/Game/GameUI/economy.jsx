/*! Open Historia — deterministic economy pane. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { setRegionClickObserver } from "../Selection/Regions.jsx";
import {
  fetchEconomyState,
  getActiveEngineGame,
  queueEconomyCommand,
} from "../../runtime/economy.js";
import { getStoredLanguage } from "../../runtime/i18n.js";

const COPY = {
  en: {
    date: "Date", round: "Round", revision: "Session revision", selected: "Selected region",
    click: "click the map", controller: "Controller", foreign: "Foreign region — view only",
    invest: "Queue investment", queued: "Investment queued for the next time jump",
    report: "Last economic report", why: "Why changed", loading: "Loading economy…",
    unavailable: "This game does not use the deterministic economy engine.",
  },
  ru: {
    date: "Дата", round: "Ход", revision: "Ревизия сессии", selected: "Выбранный регион",
    click: "нажмите на карту", controller: "Контролирующая страна", foreign: "Чужой регион — только просмотр",
    invest: "Запланировать инвестицию", queued: "Инвестиция запланирована на следующий переход времени",
    report: "Последний экономический отчёт", why: "Причины изменений", loading: "Загрузка экономики…",
    unavailable: "Эта игра не использует детерминированный экономический движок.",
  },
};

const fmt = (value) => (typeof value === "number" ? value.toLocaleString("en-US") : "—");
const signed = (value) => (value > 0 ? `+${fmt(value)}` : fmt(value));
const bp = (value) => `${Math.round(value / 100)}%`;

const COLORS = {
  dim: "rgba(255,255,255,0.55)",
  line: "rgba(255,255,255,0.12)",
  panel: "rgba(255,255,255,0.04)",
  good: "#6bcf8a",
  bad: "#f2777a",
  warn: "#e8c26a",
};

const Section = ({ title, right, children }) => (
  <div style={{ marginBottom: 14 }}>
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.dim,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {right ? <div style={{ fontSize: 11, color: COLORS.dim }}>{right}</div> : null}
    </div>
    {children}
  </div>
);

const Row = ({ label, value, tone }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      padding: "3px 0",
      borderBottom: `1px solid ${COLORS.line}`,
      fontVariantNumeric: "tabular-nums",
    }}
  >
    <span style={{ color: COLORS.dim }}>{label}</span>
    <span style={{ color: tone ?? "inherit" }}>{value}</span>
  </div>
);

const Reasons = ({ lines, label = "Why changed" }) => {
  if (!lines || lines.length === 0) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", color: COLORS.dim, fontSize: 12 }}>{label}</summary>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: COLORS.dim, fontSize: 12 }}>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  );
};

const shortRegion = (regionId) => String(regionId || "").split(":").pop();

/**
 * Deterministic economy for the engine-driven scenario. Every number here comes
 * from the engine's contribution ledger; this pane makes zero model calls.
 */
const EconomyPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedMapRegion, setSelectedMapRegion] = useState("");
  const [spend, setSpend] = useState(1000);
  const [engineDriven, setEngineDriven] = useState(null);
  const [gameId, setGameId] = useState("");
  const [queued, setQueued] = useState(false);
  const text = COPY[getStoredLanguage()] ?? COPY.en;

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame();
      setEngineDriven(Boolean(game));
      if (!game) return;
      setGameId(game.id);
      setSnapshot(await fetchEconomyState(game.id));
      setError("");
    } catch (loadError) {
      setError(loadError?.message || String(loadError));
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await load();
    };
    refresh();
    // The engine only moves when time moves, so a slow poll is enough to catch
    // turns advanced from the timeline widget.
    const intervalId = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active, load]);

  // While this pane is showing, clicking a region on the map selects it here.
  useEffect(() => {
    if (!active) return undefined;
    setRegionClickObserver((props) => {
      const mapRegionId = String(props?.GID_1 || props?.id || "").trim();
      if (mapRegionId) setSelectedMapRegion(mapRegionId);
    });
    return () => setRegionClickObserver(null);
  }, [active]);

  const link = snapshot?.mapLink ?? null;

  const engineIdByMapId = useMemo(() => {
    const map = new Map();
    for (const entry of link?.regions ?? []) map.set(entry.mapRegionId, entry.engineRegionId);
    return map;
  }, [link]);

  const mapIdByEngineId = useMemo(() => {
    const map = new Map();
    for (const entry of link?.regions ?? []) map.set(entry.engineRegionId, entry.mapRegionId);
    return map;
  }, [link]);

  const selectedRegion = useMemo(() => {
    if (!snapshot) return null;
    const engineId = engineIdByMapId.get(selectedMapRegion);
    const byClick = engineId ? snapshot.regions.find((region) => region.regionId === engineId) : null;
    // Nothing selected yet (or a region outside our scenario): show the first
    // region of the player's own polity, by stable id.
    return byClick ?? snapshot.regions.find((region) => region.controllerId === snapshot.playerPolityId) ?? null;
  }, [snapshot, engineIdByMapId, selectedMapRegion]);

  const controller = useMemo(() => {
    if (!snapshot || !selectedRegion) return null;
    return snapshot.polities.find((polity) => polity.id === selectedRegion.controllerId) ?? null;
  }, [snapshot, selectedRegion]);

  const controllerLedger = useMemo(() => {
    if (!snapshot?.lastTurn || !controller) return null;
    return snapshot.lastTurn.ledger.polities.find((entry) => entry.polityId === controller.id) ?? null;
  }, [snapshot, controller]);

  const regionProduction = useMemo(() => {
    if (!controllerLedger || !selectedRegion) return null;
    for (const entry of controllerLedger.production) {
      const row = entry.byRegion.find((item) => item.regionId === selectedRegion.regionId);
      if (row) return { resource: entry.resource, amount: row.amount };
    }
    return null;
  }, [controllerLedger, selectedRegion]);

  const populationRow = useMemo(() => {
    if (!controllerLedger || !selectedRegion) return null;
    return (
      controllerLedger.populationByRegion.find((row) => row.regionId === selectedRegion.regionId) ?? null
    );
  }, [controllerLedger, selectedRegion]);

  const invest = useCallback(async () => {
    if (!snapshot || !selectedRegion || !controller || selectedRegion.controllerId !== snapshot.playerPolityId) return;
    const amount = Number(spend);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Spend must be a positive whole number.");
      return;
    }
    try {
      queueEconomyCommand(gameId, {
        kind: "economy.invest-region",
        commandId: crypto.randomUUID(),
        actorPolityId: snapshot.playerPolityId,
        targetRegionId: selectedRegion.regionId,
        effectiveMonth: snapshot.month,
        expectedRevision: snapshot.revision,
        spend: amount,
      });
      setQueued(true);
      setError("");
    } catch (investError) {
      setError(investError?.message || String(investError));
    } finally { setBusy(false); }
  }, [snapshot, selectedRegion, controller, spend, gameId]);

  if (engineDriven === false) {
    return (
      <div style={{ padding: 16, color: COLORS.dim, fontSize: 13, lineHeight: 1.6 }}>
        {text.unavailable}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ padding: 16, color: COLORS.dim, fontSize: 13 }}>
        {error ? `Failed to load: ${error}` : text.loading}
      </div>
    );
  }

  const alerts = (snapshot.lastTurn?.events ?? []).filter(
    (event) => event.type === "alert" && event.polityId === controller?.id
  );
  const rejections = snapshot.lastTurn?.rejections ?? [];

  const movements = new Map(
    (controllerLedger?.stockMovements ?? []).map((movement) => [movement.resource, movement])
  );

  return (
    <div data-testid="economy-pane" data-game-id={gameId} style={{ padding: "12px 14px", overflowY: "auto", fontSize: 13 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>{text.date}: {snapshot.gameDate}</strong>
        <span style={{ color: COLORS.dim }}>{text.round} {snapshot.round}</span>
        <span style={{ color: COLORS.dim }}>{text.revision}: {snapshot.sessionRevision.slice(0, 18)}…</span>
      </div>

      {error ? (
        <div style={{ color: COLORS.bad, marginBottom: 10 }}>{error}</div>
      ) : null}

      {rejections.map((rejection, index) => (
        <div
          key={index}
          style={{
            borderLeft: `3px solid ${COLORS.bad}`,
            background: COLORS.panel,
            padding: "6px 10px",
            borderRadius: 4,
            marginBottom: 6,
          }}
        >
          <b>Command rejected:</b> {rejection.reason} — {rejection.detail}
        </div>
      ))}
      {alerts.map((alert, index) => (
        <div
          key={index}
          style={{
            borderLeft: `3px solid ${COLORS.warn}`,
            background: COLORS.panel,
            padding: "6px 10px",
            borderRadius: 4,
            marginBottom: 6,
          }}
        >
          <b>{alert.alert}:</b> {alert.detail}
        </div>
      ))}

      {selectedRegion ? (
        <Section
          title={text.selected}
          right={selectedMapRegion ? mapIdByEngineId.get(selectedRegion.regionId) : text.click}
        >
          <div data-testid="economy-selected-region" style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>
            {selectedRegion.displayName?.en ?? shortRegion(selectedRegion.regionId)}
          </div>
          <Row
            label="Activity"
            value={
              selectedRegion.activity.kind === "extraction"
                ? selectedRegion.activity.resource
                : selectedRegion.activity.activity
            }
          />
          <Row label="Population" value={fmt(selectedRegion.population)} />
          {populationRow ? (
            <Row
              label="Change last month"
              value={`${signed(populationRow.births - populationRow.deaths)}`}
              tone={populationRow.births - populationRow.deaths >= 0 ? COLORS.good : COLORS.bad}
            />
          ) : null}
          <Row label="Infrastructure" value={bp(selectedRegion.infrastructureBp)} />
          <Row
            label="Damage"
            value={selectedRegion.damageBp ? bp(selectedRegion.damageBp) : "—"}
            tone={selectedRegion.damageBp ? COLORS.bad : undefined}
          />
          <Row label="Capacity" value={fmt(selectedRegion.baseMonthlyCapacity)} />
          <Row
            label="Output last month"
            value={regionProduction ? `${fmt(regionProduction.amount)} ${regionProduction.resource}` : "—"}
          />
          {populationRow ? (
            <Reasons label={text.why}
              lines={[
                `births +${fmt(populationRow.births)}, deaths −${fmt(populationRow.deaths)}`,
                `workforce rate ${bp(selectedRegion.workforceRateBp)}, output per worker ${fmt(
                  selectedRegion.outputPerWorker
                )}`,
              ]}
            />
          ) : null}
        </Section>
      ) : null}

      {controller ? (
        <Section title={text.controller} right={link?.polityOwnerNames?.[controller.id] ?? ""}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>
            {controller.displayName?.en ?? controller.id}
          </div>
          <Row label="Treasury (gold)" value={fmt(controller.treasury)} />
          {controllerLedger ? (
            <>
              <Row
                label="Change last month"
                value={signed(controllerLedger.treasuryClosing - controllerLedger.treasuryOpening)}
                tone={
                  controllerLedger.treasuryClosing - controllerLedger.treasuryOpening >= 0
                    ? COLORS.good
                    : COLORS.bad
                }
              />
              <Reasons label={text.why}
                lines={[
                  `tax revenue +${fmt(controllerLedger.taxTotal)}`,
                  `spending −${fmt(controllerLedger.investment?.spend ?? 0)}`,
                  ...controllerLedger.taxByRegion.map(
                    (tax) => `tax ${shortRegion(tax.regionId)} (${tax.resource}): +${fmt(tax.amount)}`
                  ),
                ]}
              />
              <Row label="Population" value={fmt(controllerLedger.populationClosing)} />
              <Row
                label="Food"
                value={
                  controllerLedger.food.shortfall > 0
                    ? `shortfall ${fmt(controllerLedger.food.shortfall)}`
                    : `surplus ${fmt(controllerLedger.food.surplus)}`
                }
                tone={controllerLedger.food.shortfall > 0 ? COLORS.bad : COLORS.good}
              />
              {controllerLedger.goods ? (
                <Row
                  label="Goods"
                  value={`${fmt(controllerLedger.goods.actual)} of ${fmt(
                    controllerLedger.goods.potential
                  )} — ${
                    controllerLedger.goods.limitedBy === "inputs"
                      ? `limited by ${controllerLedger.goods.limitingInputs.join(" + ")}`
                      : "capacity limited"
                  }`}
                  tone={controllerLedger.goods.limitedBy === "inputs" ? COLORS.warn : undefined}
                />
              ) : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {controller ? (
        <Section title="National stockpile">
          {controller.stockpile.map((entry) => {
            const movement = movements.get(entry.resource);
            const used = movement ? movement.processingUse + movement.populationUse : 0;
            return (
              <Row
                key={entry.resource}
                label={entry.resource}
                value={
                  movement
                    ? `${fmt(entry.amount)}   (${signed(movement.produced)} / −${fmt(used)})`
                    : fmt(entry.amount)
                }
              />
            );
          })}
        </Section>
      ) : null}

      {selectedRegion && controller && selectedRegion.controllerId === snapshot.playerPolityId ? (
        <Section title={`Invest in ${selectedRegion.displayName?.en ?? shortRegion(selectedRegion.regionId)}`}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              min="1"
              step="100"
              value={spend}
              onChange={(event) => setSpend(event.target.value)}
              style={{ width: 110 }}
            />
            <button data-testid="economy-invest" type="button" disabled={busy} onClick={invest}>
              {text.invest}
            </button>
          </div>
          <div style={{ color: COLORS.dim, marginTop: 6, fontSize: 12 }}>
            Infrastructure {bp(selectedRegion.infrastructureBp)} →{" "}
            {bp(
              Math.min(
                10000,
                selectedRegion.infrastructureBp +
                  Number(spend) * (snapshot.economy?.infrastructureBpPerMoney ?? 0)
              )
            )}
            . Treasury {fmt(controller.treasury)} → {fmt(controller.treasury - Number(spend))}.
          </div>
          {queued ? <div style={{ color: COLORS.good, marginTop: 6 }}>{text.queued}</div> : null}
        </Section>
      ) : selectedRegion && controller ? <Section title={text.foreign}><div style={{ color: COLORS.dim }}>{text.foreign}</div></Section> : null}

      {snapshot.lastTurn?.report ? (
        <Section title={text.report}>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 11,
              color: COLORS.dim,
              margin: 0,
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            {snapshot.lastTurn.report}
          </pre>
        </Section>
      ) : null}
    </div>
  );
};

export default EconomyPane;
