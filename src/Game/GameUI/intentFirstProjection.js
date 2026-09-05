export const INTENT_FIRST_UI_SCHEMA_VERSION = "open-historia-ui/intent-first/1";

export const INTENT_FIRST_SURFACES = Object.freeze([
  "briefing",
  "orders",
  "diplomacy",
  "country",
  "situations",
  "details",
]);

const AUTHORITIES = new Set(["canonical", "derived", "estimate", "narrative", "unknown"]);
const CLAIM_STATUSES = new Set(["supported", "contradicted", "unknown", "subjective"]);
const CAUSE_CATEGORIES = new Set([
  "territorial-transfer",
  "births-deaths",
  "combat-losses",
  "policy",
  "production",
  "trade",
  "process",
  "other",
]);

const fail = (path, message) => {
  throw new TypeError(`${path} ${message}`);
};

const objectAt = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value;
};

const stringAt = (value, path, { allowEmpty = false } = {}) => {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    fail(path, "must be a non-empty string");
  }
  return value;
};

const boolAt = (value, path) => {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
};

const arrayAt = (value, path) => {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
};

const stringArrayAt = (value, path, { nonEmpty = false } = {}) => {
  const rows = arrayAt(value, path);
  if (nonEmpty && rows.length === 0) fail(path, "must contain at least one evidence ID");
  rows.forEach((entry, index) => stringAt(entry, `${path}[${index}]`));
  return rows;
};

const rejectAuditNotation = (value, path) => {
  if (typeof value !== "string") return;
  if (/\b(?:bp|basis points?)\b/i.test(value) || /(?:^|\s)(?:polity|region|process|evidence):[\w.-]+/.test(value)) {
    fail(path, "basis points and schema identifiers belong in audit details");
  }
};

const assertUnique = (rows, key, path) => {
  const seen = new Set();
  rows.forEach((row, index) => {
    if (seen.has(row[key])) fail(`${path}[${index}].${key}`, "must be unique");
    seen.add(row[key]);
  });
  return rows;
};

const parseGroundedDisplay = (value, path) => {
  const row = objectAt(value, path);
  stringAt(row.factId, `${path}.factId`);
  stringAt(row.label, `${path}.label`);
  if (!AUTHORITIES.has(row.authority)) fail(`${path}.authority`, "is not recognized");
  const evidenceIds = stringArrayAt(row.evidenceIds, `${path}.evidenceIds`, {
    nonEmpty: row.authority === "canonical" || row.authority === "derived" || row.authority === "estimate",
  });
  if (row.sourceLabels !== undefined) stringArrayAt(row.sourceLabels, `${path}.sourceLabels`);
  if (row.authority === "unknown") {
    if (row.value !== null) fail(`${path}.value`, "must be null when authority is unknown");
    stringAt(row.unknownReason, `${path}.unknownReason`);
  } else if (row.authority === "narrative") {
    if (row.value !== null && row.value !== undefined) {
      fail(path, "narrative entries cannot carry an authoritative value");
    }
  } else {
    stringAt(row.value, `${path}.value`);
    rejectAuditNotation(row.value, `${path}.value`);
  }
  if (row.why !== undefined) stringArrayAt(row.why, `${path}.why`);
  return { ...row, evidenceIds };
};

const parseInterpretation = (value) => {
  if (value === null) return null;
  const row = objectAt(value, "interpretation");
  stringAt(row.interpretationId, "interpretation.interpretationId");
  stringAt(row.sourceText, "interpretation.sourceText");
  boolAt(row.confirmationRequired, "interpretation.confirmationRequired");
  const questions = arrayAt(row.questions, "interpretation.questions").map((question, index) => {
    const item = objectAt(question, `interpretation.questions[${index}]`);
    stringAt(item.questionId, `interpretation.questions[${index}].questionId`);
    stringAt(item.prompt, `interpretation.questions[${index}].prompt`);
    return item;
  });
  const claims = arrayAt(row.claims, "interpretation.claims").map((claim, index) => {
    const path = `interpretation.claims[${index}]`;
    const item = objectAt(claim, path);
    stringAt(item.claimId, `${path}.claimId`);
    stringAt(item.text, `${path}.text`);
    if (!CLAIM_STATUSES.has(item.status)) fail(`${path}.status`, "is not recognized");
    stringAt(item.explanation, `${path}.explanation`);
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, {
      nonEmpty: item.status === "supported" || item.status === "contradicted",
    });
    if (item.sourceLabels !== undefined) stringArrayAt(item.sourceLabels, `${path}.sourceLabels`);
    return item;
  });
  const parseAction = (action, index, collection) => {
    const path = `interpretation.${collection}[${index}]`;
    const item = objectAt(action, path);
    stringAt(item[collection === "requestedActions" ? "actionId" : "initiativeId"], `${path}.id`);
    stringAt(item.summary, `${path}.summary`);
    boolAt(item.material, `${path}.material`);
    boolAt(item.irreversible, `${path}.irreversible`);
    stringArrayAt(item.targetLabels, `${path}.targetLabels`);
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: item.material });
    return item;
  };
  const requestedActions = arrayAt(row.requestedActions, "interpretation.requestedActions")
    .map((action, index) => parseAction(action, index, "requestedActions"));
  const proposedInitiatives = arrayAt(row.proposedInitiatives, "interpretation.proposedInitiatives")
    .map((initiative, index) => parseAction(initiative, index, "proposedInitiatives"));
  const preview = objectAt(row.preview, "interpretation.preview");
  for (const key of ["cost", "duration"]) {
    const range = objectAt(preview[key], `interpretation.preview.${key}`);
    if (range.kind !== "range" && range.kind !== "unknown") {
      fail(`interpretation.preview.${key}.kind`, "must be range or unknown");
    }
    stringAt(range.label, `interpretation.preview.${key}.label`);
    rejectAuditNotation(range.label, `interpretation.preview.${key}.label`);
  }
  stringArrayAt(preview.risks, "interpretation.preview.risks");
  stringArrayAt(preview.opportunityCosts, "interpretation.preview.opportunityCosts");
  stringArrayAt(preview.affected, "interpretation.preview.affected");
  stringArrayAt(preview.evidenceIds, "interpretation.preview.evidenceIds", {
    nonEmpty: requestedActions.some((action) => action.material)
      || proposedInitiatives.some((initiative) => initiative.material),
  });
  return { ...row, questions, claims, requestedActions, proposedInitiatives, preview };
};

export const parseIntentFirstProjection = (value) => {
  const root = objectAt(value, "projection");
  if (root.schemaVersion !== INTENT_FIRST_UI_SCHEMA_VERSION) {
    fail("projection.schemaVersion", `must equal ${INTENT_FIRST_UI_SCHEMA_VERSION}`);
  }
  stringAt(root.revision, "projection.revision");
  if (!/^sha256:[a-f0-9]{64}$/.test(root.revision)) fail("projection.revision", "must be an exact WorldStateV2 revision hash");
  stringAt(root.asOf, "projection.asOf");
  if (!/^\d{4,}-\d{2}-\d{2}$/.test(root.asOf)) fail("projection.asOf", "must be an exact world date");
  if (root.locale !== "en" && root.locale !== "ru") fail("projection.locale", "must be en or ru");
  const playerPolity = objectAt(root.playerPolity, "projection.playerPolity");
  stringAt(playerPolity.polityId, "projection.playerPolity.polityId");
  stringAt(playerPolity.displayName, "projection.playerPolity.displayName");
  const briefing = objectAt(root.briefing, "projection.briefing");
  stringAt(briefing.headline, "projection.briefing.headline");
  stringAt(briefing.summary, "projection.briefing.summary");
  const changes = arrayAt(briefing.changes, "projection.briefing.changes").map((change, index) => {
    const path = `projection.briefing.changes[${index}]`;
    const item = objectAt(change, path);
    stringAt(item.changeId, `${path}.changeId`);
    stringAt(item.magnitude, `${path}.magnitude`);
    stringAt(item.label, `${path}.label`);
    if (item.authority !== "canonical" && item.authority !== "derived") {
      fail(`${path}.authority`, "must be canonical or derived");
    }
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: true });
    if (item.sourceLabels !== undefined) stringArrayAt(item.sourceLabels, `${path}.sourceLabels`);
    rejectAuditNotation(item.magnitude, `${path}.magnitude`);
    const causes = arrayAt(item.causes, `${path}.causes`);
    causes.forEach((cause, causeIndex) => {
      const causePath = `${path}.causes[${causeIndex}]`;
      const causeRow = objectAt(cause, causePath);
      if (!CAUSE_CATEGORIES.has(causeRow.category)) fail(`${causePath}.category`, "is not recognized");
      stringAt(causeRow.label, `${causePath}.label`);
      stringAt(causeRow.contribution, `${causePath}.contribution`);
    });
    return item;
  });
  const territoryEffects = assertUnique(arrayAt(briefing.territoryEffects ?? [], "projection.briefing.territoryEffects").map((effect, index) => {
    const path = `projection.briefing.territoryEffects[${index}]`;
    const item = objectAt(effect, path);
    for (const key of ["transferId", "regionName", "fromPolityId", "toPolityId", "population", "taxBefore", "taxAfter", "outputBefore", "outputAfter", "recruitmentBefore", "recruitmentAfter"]) {
      stringAt(item[key], `${path}.${key}`);
    }
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: true });
    const formationExceptions = arrayAt(item.formationExceptions, `${path}.formationExceptions`).map((entry, exceptionIndex) => {
      const exception = objectAt(entry, `${path}.formationExceptions[${exceptionIndex}]`);
      stringAt(exception.label, `${path}.formationExceptions[${exceptionIndex}].label`);
      stringAt(exception.personnel, `${path}.formationExceptions[${exceptionIndex}].personnel`);
      return exception;
    });
    return { ...item, formationExceptions };
  }), "transferId", "projection.briefing.territoryEffects");
  const facts = assertUnique(arrayAt(root.facts, "facts")
    .map((fact, index) => parseGroundedDisplay(fact, `facts[${index}]`)), "factId", "facts");
  const interpretation = parseInterpretation(root.interpretation);
  const processes = assertUnique(arrayAt(root.processes, "projection.processes").map((process, index) => {
    const path = `projection.processes[${index}]`;
    const item = objectAt(process, path);
    for (const key of ["processId", "name", "direction", "stage", "pace", "feasibility", "progressLabel", "nextCheckpoint"]) {
      stringAt(item[key], `${path}.${key}`);
    }
    if (item.nameRu !== null && item.nameRu !== undefined) stringAt(item.nameRu, `${path}.nameRu`);
    if (!Number.isFinite(item.progressPercent) || item.progressPercent < 0 || item.progressPercent > 100) {
      fail(`${path}.progressPercent`, "must be a finite percentage from 0 to 100");
    }
    for (const key of ["mainInputs", "blockers", "accelerators", "support", "opposition", "latestChanges", "evidenceIds"]) {
      stringArrayAt(item[key], `${path}.${key}`);
    }
    stringAt(item.spending, `${path}.spending`);
    stringAt(item.lastSemanticDecision, `${path}.lastSemanticDecision`);
    rejectAuditNotation(item.spending, `${path}.spending`);
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: true });
    if (item.sourceLabels !== undefined) stringArrayAt(item.sourceLabels, `${path}.sourceLabels`);
    return item;
  }), "processId", "projection.processes");
  const situations = assertUnique(arrayAt(root.situations, "projection.situations").map((situation, index) => {
    const path = `projection.situations[${index}]`;
    const item = objectAt(situation, path);
    for (const key of ["situationId", "title", "urgency", "summary"]) stringAt(item[key], `${path}.${key}`);
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: true });
    return item;
  }), "situationId", "projection.situations");
  const diplomacy = objectAt(root.diplomacy, "projection.diplomacy");
  const conversations = assertUnique(arrayAt(diplomacy.conversations, "projection.diplomacy.conversations").map((conversation, index) => {
    const path = `projection.diplomacy.conversations[${index}]`;
    const item = objectAt(conversation, path);
    for (const key of ["conversationId", "counterparty", "latestMessage"]) stringAt(item[key], `${path}.${key}`);
    return item;
  }), "conversationId", "projection.diplomacy.conversations");
  const commitments = assertUnique(arrayAt(diplomacy.commitments, "projection.diplomacy.commitments").map((commitment, index) => {
    const path = `projection.diplomacy.commitments[${index}]`;
    const item = objectAt(commitment, path);
    for (const key of ["commitmentId", "title", "summary"]) stringAt(item[key], `${path}.${key}`);
    stringArrayAt(item.evidenceIds, `${path}.evidenceIds`, { nonEmpty: true });
    return item;
  }), "commitmentId", "projection.diplomacy.commitments");
  const details = assertUnique(arrayAt(root.details, "projection.details").map((detail, index) => {
    const path = `projection.details[${index}]`;
    const item = objectAt(detail, path);
    for (const key of ["detailId", "label", "summary"]) stringAt(item[key], `${path}.${key}`);
    return item;
  }), "detailId", "projection.details");
  const time = objectAt(root.time, "projection.time");
  stringAt(time.label, "projection.time.label");
  arrayAt(time.options, "projection.time.options").forEach((option, index) => {
    objectAt(option, `projection.time.options[${index}]`);
    stringAt(option.optionId, `projection.time.options[${index}].optionId`);
    stringAt(option.label, `projection.time.options[${index}].label`);
  });
  for (const key of ["completedSubmonths", "totalSubmonths"]) {
    if (!Number.isSafeInteger(time[key]) || time[key] < 0 || time[key] > 3) {
      fail(`projection.time.${key}`, "must be a whole monthly-boundary count from 0 to 3");
    }
  }
  if (time.completedSubmonths > time.totalSubmonths) fail("projection.time.completedSubmonths", "cannot exceed totalSubmonths");
  let strategicCheckpoint = null;
  if (root.strategicCheckpoint !== null && root.strategicCheckpoint !== undefined) {
    const checkpoint = objectAt(root.strategicCheckpoint, "projection.strategicCheckpoint");
    stringAt(checkpoint.revision, "projection.strategicCheckpoint.revision");
    stringAt(checkpoint.month, "projection.strategicCheckpoint.month");
    const actions = stringArrayAt(checkpoint.availableActions, "projection.strategicCheckpoint.availableActions", { nonEmpty: true });
    if (!actions.every((action) => action === "retry" || action === "continue-without-decisions")) {
      fail("projection.strategicCheckpoint.availableActions", "contains an unsupported action");
    }
    const blockedTasks = arrayAt(checkpoint.blockedTasks, "projection.strategicCheckpoint.blockedTasks").map((task, index) => {
      const path = `projection.strategicCheckpoint.blockedTasks[${index}]`;
      const row = objectAt(task, path);
      for (const key of ["taskKey", "actorPolityId", "status", "reason"]) stringAt(row[key], `${path}.${key}`);
      return row;
    });
    strategicCheckpoint = { ...checkpoint, availableActions: actions, blockedTasks };
  }
  return {
    ...root,
    playerPolity,
    briefing: { ...briefing, changes, territoryEffects },
    facts,
    interpretation,
    processes,
    situations,
    diplomacy: { ...diplomacy, conversations, commitments },
    details,
    time,
    strategicCheckpoint,
  };
};

export const assertIntentFirstCommands = (commands) => {
  const root = objectAt(commands, "commands");
  const allowed = ["submitIntent", "confirmInterpretation", "dismissInterpretation", "advanceTime"];
  for (const name of Object.keys(root)) {
    if (!allowed.includes(name)) fail("commands", `contains unsupported capability ${name}`);
  }
  for (const name of allowed) {
    if (typeof root[name] !== "function") fail(`commands.${name}`, "must be a function");
  }
  return root;
};
