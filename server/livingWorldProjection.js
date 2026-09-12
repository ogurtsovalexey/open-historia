import { processes, worldV2 } from '@open-historia/engine';

export const INTENT_FIRST_UI_SCHEMA_VERSION = 'open-historia-ui/intent-first/1';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatNumber = (value) => number.format(value);
const applyBp = (value, bp) => Number(BigInt(value) * BigInt(bp) / 10000n);
const labelOf = (value) => String(value ?? '').split(':').at(-1).replaceAll('-', ' ');
const RUSSIAN_RESOURCE_NAMES = Object.freeze({
  grain: 'зерно', timber: 'древесина', iron: 'железо', horses: 'лошади',
  fibers: 'волокно', powder: 'пороховой состав', provisions: 'провиант',
  cloth: 'ткань', arms: 'вооружение', gunpowder: 'порох', luxury: 'предметы роскоши',
  maize: 'кукуруза', 'food-basket': 'продовольствие', obsidian: 'обсидиан', cotton: 'хлопок', cacao: 'какао',
  stone: 'камень', clay: 'глина', salt: 'соль', 'maguey-fiber': 'волокно магея', mantles: 'накидки',
  pottery: 'керамика', paper: 'бумага', feathers: 'перья', copal: 'копал', shell: 'раковины',
  greenstone: 'зелёный камень', gold: 'золото', copper: 'медь', weapons: 'оружие', shields: 'щиты',
  'cotton-armour': 'хлопковый доспех',
});
const RUSSIAN_RESOURCE_DELIVERY_NAMES = Object.freeze({
  grain: 'зерна', timber: 'древесины', iron: 'железа', horses: 'лошадей',
  fibers: 'волокна', powder: 'порохового состава', provisions: 'провианта',
  cloth: 'ткани', arms: 'вооружения', gunpowder: 'пороха', luxury: 'предметов роскоши',
  maize: 'кукурузы', 'food-basket': 'продовольствия', obsidian: 'обсидиана', cotton: 'хлопка', cacao: 'какао',
  stone: 'камня', clay: 'глины', salt: 'соли', 'maguey-fiber': 'волокна магея', mantles: 'накидок',
  pottery: 'керамики', paper: 'бумаги', feathers: 'перьев', copal: 'копала', shell: 'раковин',
  greenstone: 'зелёного камня', gold: 'золота', copper: 'меди', weapons: 'оружия', shields: 'щитов',
  'cotton-armour': 'хлопкового доспеха',
});
const resourceLabel = (value, locale) => {
  const label = labelOf(value);
  return isRussian(locale) ? RUSSIAN_RESOURCE_NAMES[label] ?? label : label;
};
const resourceDeliveryLabel = (value, locale) => {
  const label = labelOf(value);
  return isRussian(locale) ? RUSSIAN_RESOURCE_DELIVERY_NAMES[label] ?? resourceLabel(value, locale) : label;
};
const RUSSIAN_HISTORICAL_NAMES = Object.freeze({
  'Austrian Empire': 'Австрийская империя', 'Batavian Republic': 'Батавская республика',
  'Electorate of Baden': 'Курфюршество Баден', 'Electorate of Hanover': 'Курфюршество Ганновер',
  'Danish–Norwegian Realm': 'Датско-норвежское королевство', 'Denmark–Norway': 'Дания — Норвегия',
  'Electorate of Bavaria': 'Курфюршество Бавария', 'Electorate of Saxony': 'Курфюршество Саксония',
  'Electorate of Württemberg': 'Курфюршество Вюртемберг', 'Kingdom of Etruria': 'Королевство Этрурия',
  'French Empire': 'Французская империя', 'Italian Republic': 'Итальянская республика',
  'Kingdom of Portugal and the Algarves': 'Королевство Португалии и Алгарве', 'Kingdom of Sardinia': 'Королевство Сардиния',
  'Kingdom of Prussia': 'Королевство Пруссия', 'Kingdom of Spain': 'Королевство Испания',
  'Kingdom of Sweden': 'Королевство Швеция', 'Kingdoms of Naples and Sicily': 'Королевства Неаполь и Сицилия',
  'Landgraviate of Hesse-Darmstadt': 'Ландграфство Гессен-Дармштадт', 'Landgraviate of Hesse-Kassel': 'Ландграфство Гессен-Кассель',
  'Ligurian Republic': 'Лигурийская республика', 'Papal States': 'Папская область',
  'Principality of Brunswick-Wolfenbüttel': 'Княжество Брауншвейг-Вольфенбюттель',
  'Ottoman Empire': 'Османская империя', 'Russian Empire': 'Российская империя',
  'United Kingdom of Great Britain and Ireland': 'Соединённое королевство Великобритании и Ирландии',
  'Baltic Provinces': 'Прибалтийские губернии', Lithuania: 'Литва', Belarus: 'Белоруссия', Volhynia: 'Волынь',
  Podolia: 'Подолия', 'Ukraine West': 'Правобережная Украина', 'New Russia': 'Новороссия',
});
const isRussian = (locale) => String(locale ?? '').toLowerCase().startsWith('ru');
const localized = (value, locale) => {
  const fallback = value?.en ?? '';
  return value?.[locale] ?? (isRussian(locale) ? RUSSIAN_HISTORICAL_NAMES[fallback] ?? fallback : fallback);
};
const phrase = (locale, english, russian) => isRussian(locale) ? russian : english;

// This is an index for a semantic interpreter, not a serialized world copy.
// Stable caps prevent a long campaign from making an already-grounded player
// preview impossible to confirm merely because its context grew.
const PLAYER_INTENT_CONTEXT_MAX = Object.freeze({
  polities: 64, regions: 96, formations: 32, concepts: 32, processes: 24,
  relationships: 32, tributeObligations: 32, evidence: 96, labelLength: 120,
});

function contextLabel(value, locale) {
  return localized(value, locale).replace(/\s+/gu, ' ').trim().slice(0, PLAYER_INTENT_CONTEXT_MAX.labelLength);
}

function boundedContextEntries(entries, maximum, preferred = () => false) {
  return [...entries].sort((left, right) => (
    Number(preferred(right)) - Number(preferred(left))
    || String(left.entityId ?? left.evidenceId).localeCompare(String(right.entityId ?? right.evidenceId))
  )).slice(0, maximum);
}

function visibleEvidence(state, polityId) {
  const registry = worldV2.selectEvidenceRegistry(state, polityId).value.entries;
  return new Map(registry.map((entry) => [entry.evidenceId, entry]));
}

function groundedEvidence(ids, visible, fallback = []) {
  const selected = [...new Set(ids)].filter((id) => visible.has(id)).sort();
  return (selected.length > 0 ? selected : fallback).slice(0, 24);
}

function fact(factId, label, value, evidenceIds, why = []) {
  if (evidenceIds.length === 0) {
    return { factId, label, value: null, authority: 'unknown', unknownReason: 'No visible canonical evidence.', evidenceIds: [] };
  }
  return { factId, label, value, authority: 'derived', evidenceIds, why };
}

function processProjection(state, process, visible, locale) {
  const envelope = processes.buildFeasibilityEnvelope(state, process);
  const evidenceIds = groundedEvidence(envelope.evidenceIds, visible);
  if (evidenceIds.length === 0) return null;
  const concept = process.conceptId ? state.concepts.find((entry) => entry.conceptId === process.conceptId) : null;
  const progressPercent = Math.trunc(process.progressBp / 100);
  const stageLabel = phrase(locale, process.stage, ({
    proposed: 'предложен', emerging: 'зарождается', organized: 'организован',
    demonstrated: 'продемонстрирован', adopted: 'принят', institutionalized: 'институционализирован',
  })[process.stage] ?? process.stage);
  const paceLabel = phrase(locale, process.currentPace, ({
    stalled: 'приостановлен', slow: 'медленный', steady: 'ровный', fast: 'быстрый', breakthrough: 'прорывной',
  })[process.currentPace] ?? process.currentPace);
  return {
    processId: process.processId,
    name: localized(concept?.displayName, locale) || labelOf(process.kind),
    nameRu: concept?.displayName?.ru ?? null,
    direction: labelOf(process.direction),
    stage: stageLabel,
    pace: paceLabel,
    feasibility: envelope.reasons.length === 0
      ? phrase(locale, 'Feasible under current known conditions', 'Осуществимо при известных текущих условиях')
      : envelope.reasons.join('; '),
    progressLabel: phrase(locale, `${progressPercent}% through ${process.stage}`, `${progressPercent}% стадии «${stageLabel}»`),
    progressPercent,
    nextCheckpoint: process.stage === 'institutionalized'
      ? phrase(locale, 'Institutionalized', 'Институционализирован')
      : phrase(locale, 'Next stage boundary', 'Следующая граница стадии'),
    mainInputs: envelope.opportunityCosts.map((entry) => `${resourceLabel(entry.resourceId, locale)}: ${formatNumber(entry.amount)}`),
    blockers: envelope.blockers.map(labelOf),
    accelerators: envelope.accelerators.map(labelOf),
    support: process.sponsorEntityRefs.map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id)),
    opposition: process.prerequisites.oppositionEvidenceIds.map(() => phrase(locale, 'Recorded opposition', 'Зафиксированное противодействие')),
    spending: formatNumber(process.funding),
    latestChanges: process.lastAdvancedMonth
      ? [phrase(locale, `Last resolved ${process.lastAdvancedMonth}`, `Последний расчёт: ${process.lastAdvancedMonth}`)]
      : [phrase(locale, 'Not yet resolved', 'Ещё не рассчитывался')],
    lastSemanticDecision: phrase(locale, `${process.currentPace} pace toward ${labelOf(process.direction)}`, `${paceLabel} темп в направлении «${labelOf(process.direction)}»`),
    evidenceIds,
  };
}

function territoryEffectProjection(state, transition, visible, locale) {
  const region = state.regions.find((entry) => entry.regionId === transition.regionId);
  if (!region) return null;
  const snapshot = worldV2.deriveRegionSnapshot(state, region.regionId);
  const before = transition.controlBefore;
  const after = transition.controlAfter;
  const controlled = (control, field) => control.actualControllerPolityId ? applyBp(snapshot.value[field], control[field === 'productiveCapacity' ? 'extractionAccessBp' : 'administrationAccessBp']) : 0;
  const recruitment = (control) => control.actualControllerPolityId
    ? applyBp(snapshot.value.eligiblePopulation, control.recruitmentAccessBp) : 0;
  const formationExceptions = state.formations
    .filter((formation) => formation.personnelOrigins.some((origin) => origin.regionId === region.regionId)
      && formation.polityId !== after.actualControllerPolityId)
    .map((formation) => ({ formationId: formation.formationId, polityId: formation.polityId, personnel: formation.personnelOrigins
      .filter((origin) => origin.regionId === region.regionId).reduce((sum, origin) => sum + origin.personnel, 0) }))
    .sort((left, right) => left.formationId.localeCompare(right.formationId));
  const evidenceIds = groundedEvidence(snapshot.evidenceIds, visible, region.evidenceIds);
  if (evidenceIds.length === 0) return null;
  return {
    transferId: `transfer:${region.regionId}:${after.actualControllerPolityId}`,
    regionName: localized(region.displayName, locale) || labelOf(region.regionId),
    fromPolityId: before.legalOwnerPolityId,
    toPolityId: after.legalOwnerPolityId,
    population: formatNumber(snapshot.value.population),
    taxBefore: formatNumber(controlled(before, 'fiscalBase')),
    taxAfter: formatNumber(controlled(after, 'fiscalBase')),
    outputBefore: formatNumber(controlled(before, 'productiveCapacity')),
    outputAfter: formatNumber(controlled(after, 'productiveCapacity')),
    recruitmentBefore: formatNumber(recruitment(before)),
    recruitmentAfter: formatNumber(recruitment(after)),
    formationExceptions: formationExceptions.map((entry) => ({
      label: `${labelOf(entry.formationId)} (${labelOf(entry.polityId)})`, personnel: formatNumber(entry.personnel),
    })),
    evidenceIds,
  };
}

const localizeIntentPreviewText = (value, locale) => {
  const raw = String(value ?? '');
  if (!isRussian(locale)) return raw;
  const reserve = /^(\d+) reserve personnel drawn from current controlled recruitment$/u.exec(raw);
  if (reserve) return `${reserve[1]} резервных военнослужащих из доступного набора под текущим контролем`;
  const initialTreasury = /^(\d+) initial treasury commitment$/u.exec(raw);
  if (initialTreasury) return `${initialTreasury[1]} первоначальное обязательство казны`;
  const institutionalCommitment = /^(\d+) treasury plus committed institutional capacity$/u.exec(raw);
  if (institutionalCommitment) return `${institutionalCommitment[1]} из казны и задействованная институциональная мощность`;
  const workforce = /^(\d+) fewer people in the civilian workforce; origin (.+)$/u.exec(raw);
  if (workforce) return `${workforce[1]} человек меньше в гражданской рабочей силе; источник: ${RUSSIAN_HISTORICAL_NAMES[workforce[2]] ?? workforce[2]}`;
  const known = {
    'Reserve formation is recorded now; readiness remains subject to later world conditions': 'Резерв создаётся сейчас; готовность зависит от дальнейших условий мира.',
    'Material blockers or opposition can slow the process at later checkpoints': 'Материальные ограничения или сопротивление могут замедлить процесс на следующих проверках.',
    'No immediate treasury commitment; frozen proposal terms will be recorded': 'Немедленных затрат казны нет; условия предложения будут зафиксированы.',
    'Multi-stage; pace is rechecked at each monthly resolution': 'Многоэтапный процесс; темп перепроверяется при каждом месячном расчёте.',
    'No additional immediate treasury commitment; the existing process commitment remains in force': 'Новых немедленных затрат казны нет; обязательство по уже идущему процессу сохраняется.',
    'No currently feasible material commitment': 'Сейчас нет осуществимого материального обязательства.',
    'Applied at the next monthly resolution; pace remains subject to engine feasibility': 'Будет применено при следующем месячном расчёте; темп остаётся ограничен осуществимостью для движка.',
    'Blocked until the interpretation or conditions change': 'Заблокировано до изменения толкования или условий.',
    'High contextual resistance limits acceleration': 'Высокое контекстное сопротивление ограничивает ускорение.',
    'A later checkpoint can still constrain the selected pace': 'Следующая проверка всё ещё может ограничить выбранный темп.',
    'Pending recipient response; no territorial control changes before acceptance': 'Ожидается ответ адресата; до принятия контроля над территориями не меняется.',
    'The addressed polity can reject the frozen terms': 'Адресат может отклонить зафиксированные условия.',
    'No territorial control changes until the addressed polity accepts the frozen proposal': 'Контроль над территориями не меняется, пока адресат не примет зафиксированное предложение.',
    'Requires semantic and material resolution': 'Требует смыслового и материального разрешения.',
    'Depends on feasibility and chosen pace': 'Зависит от осуществимости и выбранного темпа.',
    'The requested outcome may exceed current institutions or material capacity': 'Запрошенный результат может превышать возможности нынешних институтов или материальной базы.',
    'Committed capacity cannot serve every objective at once': 'Выделенная мощность не может одновременно служить всем целям.',
  };
  return known[raw] ?? raw;
};

function interpretationProjection(intent, fallbackEvidence, locale, state) {
  if (!intent || intent.status !== 'pending') return null;
  const localizeAffected = (reference) => {
    if (!isRussian(locale)) return reference;
    const polity = state?.polities?.find((entry) => entry.id === reference);
    const region = state?.regions?.find((entry) => entry.regionId === reference);
    return localized(polity?.displayName ?? region?.displayName, locale) || reference;
  };
  return {
    interpretationId: intent.interpretationId,
    sourceText: intent.sourceText,
    confirmationRequired: true,
    questions: intent.questions ?? [],
    // Older saved previews predate the rule that deterministic claims carry
    // visible evidence. Repair the read-only projection rather than mutating
    // historic revisions, so a legacy pending preview cannot crash the UI.
    claims: (intent.claims ?? []).map((claim) => (
      (claim.status === 'supported' || claim.status === 'contradicted')
        && (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0)
        ? { ...claim, evidenceIds: fallbackEvidence }
        : claim
    )),
    requestedActions: (intent.requestedActions ?? []).map((action) => ({
      ...action,
      // The exact player span is already preserved in the canonical input and
      // is the safest Russian rendering of an action authored in Russian.
      summary: isRussian(locale) ? action.sourceSpan?.text || localizeIntentPreviewText(action.summary, locale) : action.summary,
      targetLabels: (action.targetLabels ?? []).map(localizeAffected),
    })),
    proposedInitiatives: intent.proposedInitiatives ?? [],
    preview: intent.preview ? {
      ...intent.preview,
      cost: { ...intent.preview.cost, label: localizeIntentPreviewText(intent.preview.cost?.label, locale) },
      duration: { ...intent.preview.duration, label: localizeIntentPreviewText(intent.preview.duration?.label, locale) },
      risks: (intent.preview.risks ?? []).map((value) => localizeIntentPreviewText(value, locale)),
      opportunityCosts: (intent.preview.opportunityCosts ?? []).map((value) => localizeIntentPreviewText(value, locale)),
      affected: (intent.preview.affected ?? []).map(localizeAffected),
    } : {
      cost: { kind: 'unknown', label: 'Requires semantic and material resolution' },
      duration: { kind: 'unknown', label: 'Depends on feasibility and chosen pace' },
      risks: ['The requested outcome may exceed current institutions or material capacity'],
      opportunityCosts: ['Committed capacity cannot serve every objective at once'],
      affected: [],
      evidenceIds: fallbackEvidence,
    },
  };
}

export function buildIntentFirstProjection({ session, playerPolityId, locale = 'en' }) {
  const state = session.state;
  const polity = state.polities.find((entry) => entry.id === playerPolityId);
  if (!polity) throw new Error(`Unknown player polity ${playerPolityId}`);
  const visible = visibleEvidence(state, polity.id);
  const snapshotProjection = worldV2.derivePolitySnapshot(state, polity.id);
  const snapshot = snapshotProjection.value;
  const snapshotEvidence = groundedEvidence(snapshotProjection.evidenceIds, visible, [...visible.keys()].slice(0, 1));
  const controlledRegions = snapshot.contributions.filter((entry) => entry.controlledPopulation > 0);
  const occupations = state.regions.filter((region) => (
    region.control.actualControllerPolityId === polity.id
    && region.control.legalOwnerPolityId !== polity.id
  ));
  // A foreign controller across a canonical shared border is a material
  // condition, not an implied war order. The card gives the player an honest
  // reason to mobilize, negotiate, invest in supply, or deliberately avoid
  // escalation, while territorial control remains exclusively reducer-owned.
  const borderByCounterparty = new Map();
  for (const ownRegion of state.regions.filter((region) => region.control.actualControllerPolityId === polity.id)) {
    for (const adjacentRegionId of ownRegion.adjacentRegionIds) {
      const foreignRegion = state.regions.find((region) => region.regionId === adjacentRegionId);
      if (!foreignRegion || foreignRegion.control.actualControllerPolityId === polity.id) continue;
      const counterpartyId = foreignRegion.control.actualControllerPolityId;
      const key = `${counterpartyId}|${ownRegion.regionId}|${foreignRegion.regionId}`;
      const current = borderByCounterparty.get(counterpartyId);
      if (!current || key < current.key) borderByCounterparty.set(counterpartyId, { key, ownRegion, foreignRegion });
    }
  }
  const borderPressureSituations = [...borderByCounterparty.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(0, 12)
    .map(({ ownRegion, foreignRegion }) => {
      const counterparty = localized(state.polities.find((entry) => entry.id === foreignRegion.control.actualControllerPolityId)?.displayName, locale)
        || labelOf(foreignRegion.control.actualControllerPolityId);
      return {
        situationId: `situation:border-pressure-${ownRegion.regionId.replaceAll(':', '-')}-${foreignRegion.regionId.replaceAll(':', '-')}`,
        title: phrase(
          locale,
          `${counterparty} controls the border at ${localized(ownRegion.displayName, locale) || labelOf(ownRegion.regionId)}`,
          `${counterparty} контролирует границу у региона «${localized(ownRegion.displayName, locale) || labelOf(ownRegion.regionId)}»`,
        ),
        urgency: foreignRegion.control.kind === 'occupation' ? 'high' : 'medium',
        summary: phrase(locale,
          `A canonical adjacent region is under another polity's actual control. This does not authorize combat, occupation, or territorial transfer by itself.`,
          `Соседний канонический регион находится под фактическим контролем другой державы. Само по себе это не разрешает бой, оккупацию или передачу территории.`,
        ),
        evidenceIds: groundedEvidence([...ownRegion.evidenceIds, ...foreignRegion.evidenceIds], visible, snapshotEvidence),
      };
    });
  const pendingIntent = interpretationProjection(session.playerIntent, snapshotEvidence, locale, state);
  const last = session.lastTurn;
  const polityLabel = (id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id);
  const regionLabel = (id) => localized(state.regions.find((entry) => entry.regionId === id)?.displayName, locale) || labelOf(id);
  const proposalLabel = (proposal) => proposal.terms.map((term) => term.kind === 'territorial-cession'
    ? `${regionLabel(term.regionId)} → ${polityLabel(term.toPolityId)}`
    : `${labelOf(term.relationshipTypeId)}: ${term.participantPolityIds.map(polityLabel).join(', ')}`).join('; ');
  const territoryEffects = (last?.strategicRecords ?? [])
    .flatMap((record) => record.territorialTransitions ?? [])
    .map((transition) => territoryEffectProjection(state, transition, visible, locale))
    .filter(Boolean);
  const changes = last?.kind === 'world-month-advanced' ? [{
    changeId: `change:clock-${state.turn}`,
    magnitude: phrase(locale, `Now ${state.month}`, `Теперь ${state.month}`),
    label: phrase(locale,
      `Time advanced through ${last.submonths?.length ?? 1} deterministic monthly ${((last.submonths?.length ?? 1) === 1) ? 'boundary' : 'boundaries'}`,
      `Время продвинулось через ${last.submonths?.length ?? 1} детерминированн${(last.submonths?.length ?? 1) === 1 ? 'ую месячную границу' : 'ые месячные границы'}`,
    ),
    authority: 'canonical',
    evidenceIds: groundedEvidence([last.clock?.evidenceId], visible, snapshotEvidence),
    causes: [{
      category: 'other',
      label: phrase(locale, 'Confirmed time advance', 'Подтверждённое продвижение времени'),
      contribution: phrase(locale, 'One calendar month', 'Один календарный месяц'),
    }],
  }, ...(last.strategicRecords ?? []).flatMap((record) => (record.proposalResponses ?? []).map((response) => {
    const proposal = state.diplomaticProposals.find((entry) => entry.proposalId === response.proposalId);
    if (!proposal) return null;
    const accepted = response.decision === 'accept';
    return {
      changeId: `change:${response.proposalId}:${response.decision}`,
      magnitude: accepted ? phrase(locale, 'Accepted', 'Принято') : phrase(locale, 'Rejected', 'Отклонено'),
      label: phrase(locale,
        `${polityLabel(record.actorPolityId)} ${accepted ? 'accepted' : 'rejected'} ${proposalLabel(proposal)}.`,
        `${polityLabel(record.actorPolityId)} ${accepted ? 'приняла' : 'отклонила'} предложение: ${proposalLabel(proposal)}.`,
      ),
      authority: 'canonical',
      evidenceIds: groundedEvidence(proposal.evidenceIds, visible, snapshotEvidence),
      causes: [{ category: 'other', label: phrase(locale, 'Frozen recipient decision', 'Зафиксированное решение адресата'), contribution: proposal.proposalId }],
    };
  }).filter(Boolean))] : [];
  const active = state.processes
    .filter((entry) => entry.status === 'active' && entry.sponsorEntityRefs.includes(polity.id))
    .map((entry) => processProjection(state, entry, visible, locale))
    .filter(Boolean);
  // A process becomes a situation only after the engine has resolved at least
  // one monthly checkpoint.  This keeps an initial proposal from masquerading
  // as an immediate crisis while making recorded resistance visible when it
  // materially outruns progress.  The card has no mutation authority: a new
  // intention must still pass the normal feasibility and confirmation path.
  const processResistanceSituations = state.processes
    .filter((entry) => (
      entry.status === 'active'
      && entry.sponsorEntityRefs.includes(polity.id)
      && entry.lastAdvancedMonth
      && entry.resistanceBp > entry.progressBp
    ))
    .map((entry) => {
      const projection = processProjection(state, entry, visible, locale);
      if (!projection) return null;
      return {
        situationId: `situation:process-resistance-${entry.processId.replaceAll(':', '-')}`,
        title: phrase(locale, `${projection.name} faces recorded resistance`, `${projection.name}: зафиксировано сопротивление`),
        urgency: entry.resistanceBp >= 7500 ? 'high' : 'medium',
        summary: phrase(locale,
          'Current progress is lower than recorded resistance at this checkpoint. Any pace change remains limited to engine-feasible options.',
          'На этой проверке прогресс ниже зафиксированного сопротивления. Любое изменение темпа ограничено осуществимыми для движка вариантами.',
        ),
        evidenceIds: projection.evidenceIds,
      };
    })
    .filter(Boolean);
  const relationships = state.relationships.filter((entry) => entry.participantPolityIds.includes(polity.id));
  const pendingProposals = state.diplomaticProposals.filter((entry) => (
    entry.status === 'pending'
    && (entry.proposerPolityId === polity.id || entry.recipientPolityIds.includes(polity.id))
  ));
  const tributeObligations = state.tributeObligations.filter((entry) => (
    entry.payerPolityIds.includes(polity.id) || entry.beneficiaries.some((beneficiary) => beneficiary.polityId === polity.id)
  ));
  const tributeEvidence = groundedEvidence(tributeObligations.flatMap((entry) => entry.evidenceIds), visible);
  const outgoing = tributeObligations.filter((entry) => entry.payerPolityIds.includes(polity.id));
  const incoming = tributeObligations.filter((entry) => entry.beneficiaries.some((beneficiary) => beneficiary.polityId === polity.id));
  const outgoingGoods = outgoing.flatMap((entry) => entry.deliveries.map((delivery) => (
    `${resourceLabel(delivery.commodityId, locale)} ${formatNumber(applyBp(delivery.quantity, entry.complianceBp))}`
  )));
  const incomingGoods = incoming.flatMap((entry) => {
    const beneficiary = entry.beneficiaries.find((candidate) => candidate.polityId === polity.id);
    return entry.deliveries.map((delivery) => (
      `${resourceLabel(delivery.commodityId, locale)} ${formatNumber(applyBp(applyBp(delivery.quantity, entry.complianceBp), beneficiary?.shareBp ?? 0))}`
    ));
  });
  const outgoingLabor = outgoing.reduce((sum, entry) => sum + applyBp(entry.laborService?.people ?? 0, entry.complianceBp), 0);
  const outgoingMilitary = outgoing.reduce((sum, entry) => sum + applyBp(entry.militaryService?.personnel ?? 0, entry.complianceBp), 0);
  const relationshipLabel = (kind) => phrase(locale, labelOf(kind), ({
    'coalition-negotiation': 'переговоры о коалиции',
    'coalition negotiation': 'переговоры о коалиции',
    neutrality: 'нейтралитет',
  })[labelOf(kind)] ?? labelOf(kind));
  // A situation is a read-only, engine-derived prompt for intervention.  It
  // must never turn a player click into a new obligation or rewrite the
  // historical record.  Occupation was the first such condition; unpaid
  // canonical tribute is another material condition that can matter without
  // inventing a generic "politics" resource or an era-specific event deck.
  const tributeArrearSituations = incoming
    .filter((entry) => entry.arrears.some((arrear) => arrear.quantity > 0))
    .map((entry) => {
      const payer = entry.payerPolityIds.map((id) => (
        localized(state.polities.find((candidate) => candidate.id === id)?.displayName, locale) || labelOf(id)
      )).join(' · ');
      const commodities = entry.arrears
        .filter((arrear) => arrear.quantity > 0)
        .map((arrear) => resourceDeliveryLabel(arrear.commodityId, locale))
        .join(' · ');
      return {
        situationId: `situation:tribute-arrears-${entry.obligationId.replaceAll(':', '-')}`,
        title: phrase(locale, `${payer} tribute remains in arrears`, `${payer}: дань остаётся в просрочке`),
        urgency: 'medium',
        summary: phrase(locale,
          `The shared obligation has unsettled ${commodities} deliveries; beneficiary shares remain constrained until a canonical settlement occurs.`,
          `По общему обязательству не урегулированы поставки ${commodities}; доли получателей ограничены до канонического урегулирования.`,
        ),
        evidenceIds: groundedEvidence(entry.evidenceIds, visible, snapshotEvidence),
      };
    });
  const tributeFacts = tributeObligations.length === 0 ? [] : [
    fact('fact:tribute-outgoing', phrase(locale, 'Scheduled outgoing tribute', 'Назначенная исходящая дань'), outgoingGoods.length > 0 ? outgoingGoods.join(' · ') : phrase(locale, 'none', 'нет'), tributeEvidence, [phrase(locale, 'Every listed delivery is debited from payer stock before beneficiary credit', 'Каждая указанная поставка списывается из запаса плательщика до зачисления получателю')]),
    fact('fact:tribute-incoming', phrase(locale, 'Scheduled incoming tribute', 'Назначенная входящая дань'), incomingGoods.length > 0 ? incomingGoods.join(' · ') : phrase(locale, 'none', 'нет'), tributeEvidence, [phrase(locale, 'Beneficiary shares are applied to conserved delivered goods', 'К сохранённому объёму поставленных благ применяются доли получателей')]),
    fact('fact:tribute-service', phrase(locale, 'Reserved tribute service', 'Зарезервированная служба по дани'), `${formatNumber(outgoingLabor)} ${phrase(locale, 'labor', 'труда')} · ${formatNumber(outgoingMilitary)} ${phrase(locale, 'military', 'военных')}`, tributeEvidence, [phrase(locale, 'Reserved service is already removed from available workforce and recruitment', 'Зарезервированная служба уже вычтена из доступной рабочей силы и набора')]),
  ];

  return {
    schemaVersion: INTENT_FIRST_UI_SCHEMA_VERSION,
    revision: state.revision,
    asOf: state.month,
    locale,
    playerPolity: { polityId: polity.id, displayName: localized(polity.displayName, locale) },
    briefing: {
      headline: pendingIntent
        ? phrase(locale, 'Confirm how your orders were understood', 'Подтвердите, как были поняты ваши распоряжения')
        : phrase(locale, `${localized(polity.displayName, locale)} at the opening of turn ${state.turn + 1}`, `${localized(polity.displayName, locale)} в начале хода ${state.turn + 1}`),
      summary: pendingIntent
        ? phrase(locale, 'Claims about the past are separated from requested future actions. No material state changes before confirmation.', 'Утверждения о прошлом отделены от будущих действий. До подтверждения материальное состояние мира не меняется.')
        : phrase(locale, `${formatNumber(snapshot.controlledPopulation)} people under actual control across ${controlledRegions.length} regions.`, `${formatNumber(snapshot.controlledPopulation)} человек находятся под фактическим контролем в ${controlledRegions.length} регионах.`),
      changes,
      territoryEffects,
    },
    facts: [
      fact('fact:controlled-population', phrase(locale, 'Population under actual control', 'Население под фактическим контролем'), formatNumber(snapshot.controlledPopulation), snapshotEvidence, [phrase(locale, 'Summed from regional population cohorts and current actual control', 'Сумма региональных групп населения с учётом текущего фактического контроля')]),
      fact('fact:administered-population', phrase(locale, 'Effectively administered population', 'Эффективно управляемое население'), formatNumber(snapshot.administeredPopulation), snapshotEvidence, [phrase(locale, 'Control access limits how much population administration reaches', 'Доступ управления ограничивает охват населения администрацией')]),
      fact('fact:workforce', phrase(locale, 'Available workforce', 'Доступная рабочая сила'), formatNumber(snapshot.workforce), snapshotEvidence, [phrase(locale, 'Mobilized personnel are removed from potential civilian workforce', 'Мобилизованные люди вычтены из потенциальной гражданской рабочей силы')]),
      fact('fact:treasury', phrase(locale, 'Treasury', 'Казна'), formatNumber(snapshot.treasury), groundedEvidence(polity.evidenceIds, visible, snapshotEvidence)),
      fact('fact:regional-output', phrase(locale, 'Accessible productive capacity', 'Доступная производственная мощность'), formatNumber(snapshot.regionalOutput), snapshotEvidence, [phrase(locale, 'Extraction access is applied region by region', 'Доступ к извлечению применяется отдельно к каждому региону')]),
      fact('fact:fielded-personnel', phrase(locale, 'Fielded personnel', 'Личный состав в строю'), formatNumber(snapshot.fieldedPersonnel), snapshotEvidence, [phrase(locale, 'Summed from canonical formations', 'Сумма по каноническим формированиям')]),
      fact('fact:available-manpower', phrase(locale, 'Unmobilized recruitable population', 'Немобилизованное население для набора'), formatNumber(snapshot.availableManpower), snapshotEvidence, [phrase(locale, 'Population eligibility and regional recruitment access set the ceiling', 'Пригодность населения и региональный доступ к набору задают предел')]),
      fact('fact:supply-capacity', phrase(locale, 'Accessible supply capacity', 'Доступная снабженческая мощность'), formatNumber(snapshot.supplyCapacity), snapshotEvidence),
      ...tributeFacts,
    ],
    interpretation: pendingIntent,
    processes: active,
    situations: [
      ...occupations.map((region) => ({
        situationId: `situation:${region.regionId.replaceAll(':', '-')}`,
        title: phrase(locale, `${localized(region.displayName, locale)} is occupied`, `Регион «${localized(region.displayName, locale)}» оккупирован`),
        urgency: region.control.administrationAccessBp < 5000 ? 'high' : 'medium',
        summary: phrase(locale, 'Actual control differs from legal ownership; access and recruitment follow the occupation profile.', 'Фактический контроль отличается от юридической принадлежности; доступ и набор следуют профилю оккупации.'),
        evidenceIds: groundedEvidence(region.evidenceIds, visible, snapshotEvidence),
      })),
      ...tributeArrearSituations,
      ...processResistanceSituations,
      ...borderPressureSituations,
    ],
    diplomacy: {
      conversations: pendingProposals.map((proposal) => {
        const counterparties = proposal.proposerPolityId === polity.id
          ? proposal.recipientPolityIds
          : [proposal.proposerPolityId];
        const terms = proposal.terms.map((term) => term.kind === 'territorial-cession'
          ? `${regionLabel(term.regionId)} → ${polityLabel(term.toPolityId)}`
          : `${relationshipLabel(term.relationshipTypeId)}: ${term.participantPolityIds.map(polityLabel).join(', ')}`);
        return {
          conversationId: `conversation:${proposal.proposalId.slice('proposal:'.length)}`,
          counterparty: counterparties.map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id)).join(' · '),
          latestMessage: terms.join('; '), status: proposal.proposerPolityId === polity.id ? 'awaiting-response' : 'response-required',
          evidenceIds: groundedEvidence(proposal.evidenceIds, visible, snapshotEvidence),
        };
      }),
      commitments: [
        ...relationships.map((relationship) => ({
        commitmentId: `commitment:${relationship.relationshipId.replaceAll(':', '-')}`,
        title: relationshipLabel(relationship.kind),
        summary: relationship.participantPolityIds
          .map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id))
          .join(' · '),
        evidenceIds: groundedEvidence(relationship.evidenceIds, visible, snapshotEvidence),
        })),
        ...tributeObligations.map((obligation) => ({
          commitmentId: `commitment:${obligation.obligationId.replaceAll(':', '-')}`,
          title: phrase(locale, 'tribute obligation', 'обязательство по дани'),
          summary: `${obligation.payerPolityIds.map(polityLabel).join(', ')} → ${obligation.beneficiaries.map((entry) => `${polityLabel(entry.polityId)} ${entry.shareBp / 100}%`).join(', ')} · ${obligation.cadence}`,
          evidenceIds: groundedEvidence(obligation.evidenceIds, visible),
        })),
      ],
    },
    details: [
      { detailId: 'detail:territory', label: phrase(locale, 'Territory', 'Территория'), summary: phrase(locale, `${controlledRegions.length} actually controlled regions; ${occupations.length} held under non-sovereign control.`, `${controlledRegions.length} регионов под фактическим контролем; ${occupations.length} — под несуверенным контролем.`) },
      { detailId: 'detail:economy', label: phrase(locale, 'Economy', 'Экономика'), summary: phrase(locale, `Tax base ${formatNumber(snapshot.taxBase)}; regional output ${formatNumber(snapshot.regionalOutput)}; treasury ${formatNumber(snapshot.treasury)}.`, `Налоговая база: ${formatNumber(snapshot.taxBase)}; выпуск регионов: ${formatNumber(snapshot.regionalOutput)}; казна: ${formatNumber(snapshot.treasury)}.`) },
      { detailId: 'detail:forces', label: phrase(locale, 'Forces', 'Войска'), summary: phrase(locale, `${formatNumber(snapshot.fieldedPersonnel)} fielded personnel; ${formatNumber(snapshot.availableManpower)} additional recruitable people under current access.`, `${formatNumber(snapshot.fieldedPersonnel)} военнослужащих в строю; ещё ${formatNumber(snapshot.availableManpower)} человек доступны для набора при текущем доступе.`) },
      { detailId: 'detail:provenance', label: phrase(locale, 'Evidence', 'Основания'), summary: phrase(locale, `${visible.size} public or polity-visible evidence records ground this view at one exact revision.`, `${visible.size} открытых или доступных державе источников обосновывают этот срез мира на одной точной ревизии.`) },
    ],
    time: {
      label: state.month,
      options: [{ optionId: 'advance-three-months', label: phrase(locale, 'Advance three months', 'Продолжить на три месяца') }],
      completedSubmonths: last?.kind === 'world-month-advanced' ? last.submonths?.length ?? 1 : 0,
      totalSubmonths: last?.kind === 'world-month-advanced' ? last.submonths?.length ?? 1 : 3,
    },
  };
}

/** Bounded, actor-visible facts for the semantic interpreter; never a writable state copy. */
export function buildPlayerIntentContext({ session, playerPolityId, locale = 'en' }) {
  const state = session.state;
  const actor = state.polities.find((entry) => entry.id === playerPolityId);
  if (!actor) throw new Error(`Unknown player polity ${playerPolityId}`);
  const registry = worldV2.selectEvidenceRegistry(state, actor.id).value.entries;
  const visibleIds = new Set(registry.map((entry) => entry.evidenceId));
  const regionRows = boundedContextEntries(state.regions.map((region) => ({
    entityId: region.regionId,
    kind: 'region',
    label: contextLabel(region.displayName, locale),
    legalOwnerPolityId: region.control.legalOwnerPolityId,
    actualControllerPolityId: region.control.actualControllerPolityId,
    evidenceIds: region.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
  })), PLAYER_INTENT_CONTEXT_MAX.regions, (region) => (
    region.legalOwnerPolityId === actor.id || region.actualControllerPolityId === actor.id
  ));
  const entities = [
    ...boundedContextEntries(state.polities.map((polity) => ({
      entityId: polity.id,
      kind: 'polity',
      label: contextLabel(polity.displayName, locale),
      evidenceIds: polity.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.polities, (polity) => polity.entityId === actor.id),
    ...regionRows,
    ...boundedContextEntries(state.formations.filter((entry) => entry.polityId === actor.id).map((formation) => ({
      entityId: formation.formationId,
      kind: 'formation',
      label: contextLabel(labelOf(formation.formationId), locale),
      polityId: formation.polityId,
      evidenceIds: formation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.formations),
    ...boundedContextEntries(state.concepts.map((concept) => ({
      entityId: concept.conceptId,
      kind: 'concept',
      label: contextLabel(concept.displayName, locale),
      status: concept.status,
      evidenceIds: concept.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.concepts),
    ...boundedContextEntries(state.processes.filter((entry) => entry.sponsorEntityRefs.includes(actor.id)).map((process) => ({
      entityId: process.processId,
      kind: 'process',
      label: contextLabel(labelOf(process.kind), locale),
      status: process.status,
      // Pace is a choice, but its legal options are derived fresh from the
      // engine. This gives the interpreter a useful menu without exposing
      // funding, effects, or an authority to rewrite the process itself.
      currentPace: process.currentPace ?? null,
      // Test and migration fixtures can contain deliberately skeletal legacy
      // process rows. They are never actionable because they have no pace;
      // avoid making a read-only bounded-context check attempt to interpret
      // them as a canonical WorldProcessState.
      allowedPaces: process.currentPace ? processes.buildFeasibilityEnvelope(state, process).allowedPaces : [],
      evidenceIds: process.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.processes),
    ...boundedContextEntries(state.relationships.filter((entry) => entry.participantPolityIds.includes(actor.id)).map((relationship) => ({
      entityId: relationship.relationshipId,
      kind: 'relationship',
      label: contextLabel(labelOf(relationship.kind), locale),
      participantPolityIds: relationship.participantPolityIds,
      evidenceIds: relationship.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.relationships),
    ...boundedContextEntries(state.tributeObligations.filter((entry) => (
      entry.payerPolityIds.includes(actor.id) || entry.beneficiaries.some((beneficiary) => beneficiary.polityId === actor.id)
    )).map((obligation) => ({
      entityId: obligation.obligationId,
      kind: 'tribute-obligation',
      label: contextLabel(labelOf(obligation.obligationId), locale),
      payerPolityIds: obligation.payerPolityIds,
      beneficiaries: obligation.beneficiaries,
      deliveries: obligation.deliveries,
      laborService: obligation.laborService,
      militaryService: obligation.militaryService,
      cadence: obligation.cadence,
      arrears: obligation.arrears,
      complianceBp: obligation.complianceBp,
      evidenceIds: obligation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.tributeObligations),
  ];
  const referencedEvidence = new Set(entities.flatMap((entry) => entry.evidenceIds));
  const evidence = registry
    .filter((entry) => referencedEvidence.has(entry.evidenceId))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
    .slice(0, PLAYER_INTENT_CONTEXT_MAX.evidence)
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      kind: entry.kind,
    }));
  const context = {
    revision: state.revision,
    month: state.month,
    actor: { entityId: actor.id, label: contextLabel(actor.displayName, locale) },
    worldRules: state.worldRules,
    entities,
    // A deliberately tiny reference index for retrospective territorial
    // claims. Unlike operational entity context it carries no metrics,
    // ownership or evidence, so it does not turn a remote region into a legal
    // action target. It lets the interpreter name any scenario region by its
    // canonical ID and lets the reducer answer the claim from WorldState.
    claimableRegionRefs: state.regions.map((region) => ({
      entityId: region.regionId,
      label: contextLabel(region.displayName, locale),
    })).sort((left, right) => left.entityId.localeCompare(right.entityId)),
    evidence,
    allowedInitiativeKinds: ['technology', 'ideology', 'institution', 'doctrine', 'movement', 'project', 'investigation', 'other'],
    allowedEffectFamilies: [...processes.materializableEffectKinds],
    allowedDiplomaticOperations: ['process.propose', 'process.adjust', 'military.mobilize', 'diplomacy.propose', 'territory.offer'],
    relationshipTypes: state.catalogs.relationshipTypes
      .filter((entry) => entry.playerProposable)
      .map((entry) => entry.relationshipTypeId)
      .sort(),
  };
  return context;
}
