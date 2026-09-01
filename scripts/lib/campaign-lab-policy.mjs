export const CAMPAIGN_MAX_CALLS = 60;
export const PACIFIC_DAILY_CALL_LIMIT = 490;
export const PACING_RPM = 10;
export const PACING_TPM = 200_000;
export const MAX_OUTPUT_TOKENS = 8192;

export const pacificQuotaDay = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export const isRetryableGeminiFailure = ({ networkError = false, status = null } = {}) =>
  networkError || status === 429 || status === 503 || (Number.isInteger(status) && status >= 500 && status <= 599);

const parseFoodAlert = (event) => {
  const need = Number(/\bneed (\d+)/.exec(event.detail)?.[1]);
  const shortfall = Number(/\bshortfall (\d+)/.exec(event.detail)?.[1]);
  return { need: Number.isFinite(need) ? need : null, shortfall: Number.isFinite(shortfall) ? shortfall : null };
};

const alertKey = (event) => `${event.polityId}|${event.alert}`;

export const reduceChronicleAlerts = (events, previous = {}) => {
  const next = {};
  const records = [];
  const triggerReasons = [];
  const current = events.filter((event) => event.type === "alert");

  for (const event of current) {
    const key = alertKey(event);
    const parsed = event.alert === "food-shortfall" ? parseFoodAlert(event) : {};
    const value = { ...parsed, detail: event.detail };
    next[key] = value;
    const before = previous[key];
    let lifecycle = null;
    if (!before) lifecycle = "started";
    else if (event.alert === "food-shortfall"
      && Number.isFinite(value.shortfall) && Number.isFinite(before.shortfall)
      && value.shortfall > before.shortfall && value.shortfall * 4 >= before.shortfall * 5) lifecycle = "worsened";
    else if (event.alert === "inputs-limited" && value.detail !== before.detail) lifecycle = "changed";
    if (lifecycle) records.push({ ...event, lifecycle });
    if (event.alert === "food-shortfall" && lifecycle === "started") triggerReasons.push(`critical-food-shortfall:${event.polityId}`);
    if (event.alert === "inputs-limited" && lifecycle === "started") triggerReasons.push(`new-resource-deficit:${event.polityId}`);
  }

  for (const [key, before] of Object.entries(previous)) {
    if (next[key]) continue;
    const [polityId, alert] = key.split("|");
    records.push({ type: "alert", polityId, alert, detail: before.detail, lifecycle: "resolved" });
  }

  return { records, alertState: next, triggerReasons };
};

export const decisionTriggerReasons = (events) => {
  const reasons = [];
  const triggerKinds = new Set([
    "agreement-created", "agreement-terminated", "territorial-settlement-accepted",
    "war-declared", "war-ended", "call-to-arms-created", "call-to-arms-resolved", "region-occupied",
    "peace-offered", "peace-resolved", "government-transferred", "default",
    "crisis-opened", "crisis-escalated", "crisis-resolved",
  ]);
  for (const event of events) if (triggerKinds.has(event.type)) reasons.push(event.type);
  return [...new Set(reasons)].sort();
};

export const playerDecisionTriggerReasons = (events, playerPolityId) => {
  const reasons = decisionTriggerReasons(events);
  for (const event of events) {
    if (event.type === "proposal-created" && event.recipientId === playerPolityId) reasons.push("proposal-created");
    if (["proposal-countered", "proposal-rejected"].includes(event.type)
      && (event.proposerId === playerPolityId || event.recipientId === playerPolityId)) reasons.push(event.type);
  }
  return [...new Set(reasons)].sort();
};

export const FREE10_CELLS = Object.freeze([
  ...["germany", "poland", "france"].flatMap((player) => ["historical", "alternative", "free"].map((strategy) => ({ player, strategy }))),
  { player: "united-kingdom", strategy: "historical" },
]);

export const AUTONOMY_V2_CELLS = Object.freeze(
  ["historical", "alternative", "free"].map((strategy) => ({ player: "germany", strategy })),
);
