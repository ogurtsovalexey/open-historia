/*! P7 deterministic campaign directions, crises and legacy pane. */
import React, { useCallback, useEffect, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';

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
  const load = useCallback(async () => {
    try { const game = await getActiveEngineGame(); if (!game) return; const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next); setError(''); }
    catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => { if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, [active, load]);
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: snapshot.playerPolityId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => { try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); } catch (queueError) { setError(queueError?.message || String(queueError)); } };
  if (!snapshot.revision) return <div style={{ padding: 14, color: dim }}>{error || 'Loading campaign…'}</div>;
  const campaign = snapshot.campaign;
  if (!campaign) return <div style={{ padding: 14, color: dim }}>Campaign goals are disabled in this scenario.</div>;
  const latest = campaign.assessments.at(-1);
  return <div data-testid="campaign-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>Campaign</div>
    {queued && <div data-testid="campaign-queued" style={{ ...card, color: '#67e8f9' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}
    <div style={card}><strong>Soft horizon {campaign.softHorizonMonth}</strong>
      <div style={{ color: dim, marginTop: 4 }}>{campaign.horizonReached ? 'Reached — play may continue.' : `Current month ${snapshot.month}. Interim assessments are available.`}</div>
      <button data-testid="queue-legacy" style={{ ...button, marginTop: 7 }} onClick={() => queue({ kind: 'campaign.assess-legacy', ...base(), assessmentId: `legacy:${crypto.randomUUID()}` }, 'Legacy assessment queued for confirmation.')}>Assess legacy</button>
    </div>
    <div style={{ color: dim, margin: '12px 0 5px' }}>Durable directions</div>
    {campaign.goals.map((goal) => <div key={goal.goalId} style={card}>
      <strong>{goal.displayName.en}</strong> · {goal.status}
      <div style={{ color: dim, marginTop: 4 }}>{goal.kind} · progress {pct(goal.progressBp)}</div>
      {goal.status === 'candidate' && <button data-testid={`adopt-${goal.goalId}`} style={{ ...button, marginTop: 7 }} onClick={() => queue({ kind: 'campaign.adopt-goal', ...base(), goalId: goal.goalId }, `Goal queued: ${goal.displayName.en}.`)}>Adopt direction</button>}
    </div>)}
    <div style={{ color: dim, margin: '12px 0 5px' }}>Crises</div>
    {!campaign.crises.length && <div style={card}>No recorded crisis involving this country.</div>}
    {campaign.crises.map((crisis) => <div key={crisis.crisisId} style={card}>
      <strong>{crisis.displayName.en}</strong> · {crisis.status}
      <div style={{ color: dim, marginTop: 4 }}>{crisis.kind} · positions {crisis.positions.map((entry) => `${entry.polityId}: ${entry.position}`).join(' · ') || 'none'}</div>
      {crisis.status !== 'resolved' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
        {campaign.allowedPositions.map((position) => <button data-testid={`position-${position}`} key={position} style={button} onClick={() => queue({ kind: 'crisis.set-position', ...base(), crisisId: crisis.crisisId, position }, `Crisis position queued: ${position}.`)}>{position}</button>)}
      </div>}
    </div>)}
    {latest && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>Latest legacy · {latest.month}</div>
      <div data-testid="legacy-scores" style={card}>{Object.entries(latest.scores).map(([dimension, score]) => <div key={dimension} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>{dimension}</span><span>{pct(score)} ({latest.deltas[dimension] >= 0 ? '+' : ''}{latest.deltas[dimension]} bp)</span></div>)}</div>
    </>}
  </div>;
};

export default CampaignPane;
