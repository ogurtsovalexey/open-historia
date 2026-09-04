/*! P7 deterministic campaign directions, crises and legacy pane. */
import React, { useCallback, useEffect, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';
import { engineLocale, engineName, engineText } from './engineI18n.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(14,116,144,0.25)', color: 'white', cursor: 'pointer' };
const pct = (value) => `${(Number(value ?? 0) / 100).toFixed(0)}%`;

const CampaignPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState({ campaign: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const locale = engineLocale();
  const t = (value) => engineText(value, locale);
  const load = useCallback(async () => {
    try { const game = await getActiveEngineGame(); if (!game) return; const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next); setError(''); }
    catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => { if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, [active, load]);
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: snapshot.playerPolityId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => { try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); } catch (queueError) { setError(queueError?.message || String(queueError)); } };
  if (!snapshot.revision) return <div style={{ padding: 14, color: dim }}>{error || t('Loading campaign…')}</div>;
  const campaign = snapshot.campaign;
  if (!campaign) return <div style={{ padding: 14, color: dim }}>{t('Campaign goals are disabled in this scenario.')}</div>;
  const latest = campaign.assessments.at(-1);
  return <div data-testid="campaign-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>{t('Campaign')}</div>
    {queued && <div data-testid="campaign-queued" style={{ ...card, color: '#67e8f9' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}
    <div style={card}><strong>{t('Soft horizon')} {campaign.softHorizonMonth}</strong>
      <div style={{ color: dim, marginTop: 4 }}>{campaign.horizonReached ? t('Reached — play may continue.') : `${t('Current month')} ${snapshot.month}. ${t('Interim assessments are available.')}`}</div>
      <button data-testid="queue-legacy" style={{ ...button, marginTop: 7 }} onClick={() => queue({ kind: 'campaign.assess-legacy', ...base(), assessmentId: `legacy:${crypto.randomUUID()}` }, locale === 'ru' ? 'Оценка наследия отправлена на подтверждение.' : 'Legacy assessment queued for confirmation.')}>{t('Assess legacy')}</button>
    </div>
    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Durable directions')}</div>
    {campaign.goals.map((goal) => <div key={goal.goalId} style={card}>
      <strong>{engineName(goal, locale, goal.goalId)}</strong> · {t(goal.status)}
      <div style={{ color: dim, marginTop: 4 }}>{t(goal.kind)} · {t('progress')} {pct(goal.progressBp)}</div>
      {goal.status === 'candidate' && <button data-testid={`adopt-${goal.goalId}`} style={{ ...button, marginTop: 7 }} onClick={() => queue({ kind: 'campaign.adopt-goal', ...base(), goalId: goal.goalId }, locale === 'ru' ? `Цель «${engineName(goal, locale)}» запланирована.` : `Goal queued: ${goal.displayName.en}.`)}>{t('Adopt direction')}</button>}
    </div>)}
    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Crises')}</div>
    {!campaign.crises.length && <div style={card}>{t('No recorded crisis involving this country.')}</div>}
    {campaign.crises.map((crisis) => <div key={crisis.crisisId} style={card}>
      <strong>{engineName(crisis, locale, crisis.crisisId)}</strong> · {t(crisis.status)}
      <div style={{ color: dim, marginTop: 4 }}>{t(crisis.kind)} · {t('positions')} {crisis.positions.map((entry) => `${engineName(snapshot.polities.find((polity) => polity.id === entry.polityId), locale, entry.polityId)}: ${t(entry.position)}`).join(' · ') || t('none')}</div>
      {crisis.status !== 'resolved' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
        {campaign.allowedPositions.map((position) => <button data-testid={`position-${position}`} key={position} style={button} onClick={() => queue({ kind: 'crisis.set-position', ...base(), crisisId: crisis.crisisId, position }, locale === 'ru' ? `Позиция в кризисе запланирована: ${t(position)}.` : `Crisis position queued: ${position}.`)}>{t(position)}</button>)}
      </div>}
    </div>)}
    {latest && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Latest legacy')} · {latest.month}</div>
      <div data-testid="legacy-scores" style={card}>{Object.entries(latest.scores).map(([dimension, score]) => <div key={dimension} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>{t(dimension)}</span><span>{pct(score)} ({latest.deltas[dimension] >= 0 ? '+' : ''}{latest.deltas[dimension]} б.п.)</span></div>)}</div>
    </>}
  </div>;
};

export default CampaignPane;
