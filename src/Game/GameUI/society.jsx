/*! P6 deterministic capabilities, culture and religion pane. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';
import { engineLocale, engineName, engineText } from './engineI18n.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(99,102,241,0.2)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };
const pct = (value) => `${(Number(value ?? 0) / 100).toFixed(2)}%`;

const SocietyPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState({ society: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const [culturePolicy, setCulturePolicy] = useState('tolerance');
  const [religionPolicy, setReligionPolicy] = useState('tolerance');
  const locale = engineLocale();
  const t = (value) => engineText(value, locale);

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame(); if (!game) return;
      const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next);
      setCulturePolicy(next.society?.identity?.polity?.culturePolicy ?? 'tolerance');
      setReligionPolicy(next.society?.identity?.polity?.religionPolicy ?? 'tolerance');
      setError('');
    } catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => {
    if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer);
  }, [active, load]);

  const society = snapshot.society;
  const unlockedIds = useMemo(() => new Set((society?.capabilities?.unlocked ?? []).map((entry) => entry.capabilityId)), [society]);
  const activeTemplateIds = useMemo(() => new Set((snapshot.statecraft?.projects ?? []).filter((entry) => entry.status === 'active').map((entry) => entry.templateId)), [snapshot]);
  const names = useMemo(() => new Map([
    ...(society?.identity?.cultures ?? []).map((entry) => [entry.cultureId, engineName(entry, locale, entry.cultureId)]),
    ...(society?.identity?.religions ?? []).map((entry) => [entry.religionId, engineName(entry, locale, entry.religionId)]),
  ]), [society, locale]);
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: snapshot.playerPolityId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => {
    try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); } catch (queueError) { setError(queueError?.message || String(queueError)); }
  };
  const queuePolicy = (domain, policy) => queue({ kind: 'identity.set-policy', ...base(), domain, policy }, locale === 'ru' ? `Политика «${t(domain)}» запланирована: ${t(policy)}.` : `${domain} policy queued: ${policy}.`);
  const acceptance = (domain, identityId, accepted) => queue({
    kind: domain === 'culture' ? 'identity.set-culture-acceptance' : 'identity.set-religion-acceptance',
    ...base(), domain, identityId, accepted,
  }, locale === 'ru' ? `${t(accepted ? 'Acceptance' : 'Revocation')} группы «${names.get(identityId) ?? identityId}» запланировано.` : `${accepted ? 'Acceptance' : 'Revocation'} queued for ${names.get(identityId) ?? identityId}.`);

  if (!snapshot?.revision) return <div style={{ padding: 14, color: dim }}>{error || t('Loading society…')}</div>;
  if (!society) return <div style={{ padding: 14, color: dim }}>{t('Capabilities and identity are disabled in this scenario.')}</div>;
  const polity = society.identity?.polity;
  const aggregate = society.identity?.aggregate;
  const present = (domain) => [...new Set((society.identity?.regions ?? []).flatMap((entry) => {
    const row = entry[domain]; return [row.primaryId, ...row.minorities.map((minority) => minority.identityId)];
  }))].sort();

  return <div data-testid="society-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>{t('Society & capabilities')}</div>
    {queued && <div data-testid="society-queued" style={{ ...card, color: '#a5b4fc' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}

    <div style={{ color: dim, marginBottom: 5 }}>{t('National effects')}</div>
    <div style={card}>{t('Culture mismatch')} {pct(aggregate?.cultureMismatchBp)} · {t('Religion mismatch')} {pct(aggregate?.religionMismatchBp)}
      <div style={{ color: dim, marginTop: 3 }}>{t('Tax')} {pct(aggregate?.taxMultiplierBp)} · {t('Recruitment')} {pct(aggregate?.recruitmentMultiplierBp)} · {t('Unrest pressure')} {pct(aggregate?.unrestPressureBp)}</div>
    </div>

    {polity && ['culture', 'religion'].map((domain) => {
      const officialId = domain === 'culture' ? polity.officialCultureId : polity.officialReligionId;
      const accepted = domain === 'culture' ? polity.acceptedCultureIds : polity.acceptedReligionIds;
      const value = domain === 'culture' ? culturePolicy : religionPolicy;
      return <div key={domain} style={card}>
        <strong style={{ textTransform: 'capitalize' }}>{t(domain === 'culture' ? 'Culture' : 'Religion')}</strong> · {t('official')} {names.get(officialId) ?? officialId}
        <select aria-label={t(`${domain} policy`)} style={{ ...input, margin: '6px 0' }} value={value} onChange={(event) => domain === 'culture' ? setCulturePolicy(event.target.value) : setReligionPolicy(event.target.value)}>
          {['tolerance', 'privilege', 'integration', 'coercion'].map((entry) => <option key={entry} value={entry}>{t(entry)}</option>)}
        </select>
        <button data-testid={`queue-${domain}-policy`} style={button} onClick={() => queuePolicy(domain, value)}>{t('Queue policy')}</button>
        <div style={{ color: dim, marginTop: 7 }}>{t('Present identities')}</div>
        {present(domain).map((identityId) => {
          const isOfficial = identityId === officialId; const isAccepted = isOfficial || accepted.includes(identityId);
          return <div key={identityId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span>{names.get(identityId) ?? identityId} · {t(isOfficial ? 'official' : isAccepted ? 'accepted' : 'unaccepted')}</span>
            {!isOfficial && <button data-testid={`toggle-identity-${identityId}`} style={button} onClick={() => acceptance(domain, identityId, !isAccepted)}>{t(isAccepted ? 'Revoke' : 'Accept')}</button>}
          </div>;
        })}
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Capabilities & research')}</div>
    {(society.capabilities?.catalog ?? []).map((capability) => {
      const unlocked = unlockedIds.has(capability.capabilityId);
      return <div key={capability.capabilityId} style={card}>
        <strong>{engineName(capability, locale, capability.capabilityId)}</strong> · {t(unlocked ? 'unlocked' : 'locked')}
        <div style={{ color: dim, marginTop: 3 }}>{t(capability.domain)} · {t(capability.modifier.kind)} · {t('prerequisites')} {capability.prerequisiteIds.length ? capability.prerequisiteIds.map((id) => engineName(society.capabilities.catalog.find((entry) => entry.capabilityId === id), locale, id)).join(', ') : t('none')}</div>
      </div>;
    })}
    {(society.researchTemplates ?? []).map((template) => {
      const prerequisites = society.capabilities.catalog.find((entry) => entry.capabilityId === template.effect.capabilityId)?.prerequisiteIds ?? [];
      const available = !template.unlocked && prerequisites.every((entry) => unlockedIds.has(entry)) && !activeTemplateIds.has(template.templateId);
      return <button key={template.templateId} data-testid={`queue-research-${template.effect.capabilityId}`} style={{ ...button, width: '100%', marginBottom: 5 }} disabled={!available} onClick={() => queue({
        kind: 'project.start', ...base(), projectId: `project:${crypto.randomUUID()}`, templateId: template.templateId,
        monthlyFunding: template.totalCost, priority: 4,
      }, locale === 'ru' ? `Исследование «${engineName(template, locale, template.templateId)}» запланировано.` : `Research queued: ${template.displayName.en}.`)}>{engineName(template, locale, template.templateId)}{template.unlocked ? ` — ${t('unlocked')}` : !available ? ` — ${t('unavailable')}` : ''}</button>;
    })}

    {(snapshot.lastTurn?.ledger?.identity?.regions ?? []).some((entry) => entry.cultureShiftBp || entry.religionShiftBp) && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Last month causes')}</div>
      {snapshot.lastTurn.ledger.identity.regions.filter((entry) => entry.cultureShiftBp || entry.religionShiftBp).map((entry) => <div key={entry.regionId} style={card}>
        {engineName(snapshot.regions.find((region) => region.regionId === entry.regionId), locale, entry.regionId)}: {t('culture')} +{entry.cultureShiftBp} б.п. · {t('religion')} +{entry.religionShiftBp} б.п.
      </div>)}
    </>}
  </div>;
};

export default SocietyPane;
