/*! P3b deterministic diplomacy/trade pane — canonical state, no model calls. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';
import { engineLocale, engineName, engineText } from './engineI18n.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(59,130,246,0.2)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };
const relationValue = (value) => `${Math.round(value / 100)}%`;

const counterTerms = (terms, playerId) => {
  if (terms.kind === 'trade') {
    const field = terms.fromPolityId === playerId ? 'fromLeg' : 'toLeg';
    return { ...terms, [field]: { ...terms[field], amount: Math.max(1, Math.floor(terms[field].amount * 0.9)) } };
  }
  const agreementType = terms.agreementType === 'non-aggression' ? 'defensive-alliance' : 'non-aggression';
  return { ...terms, agreementType };
};

const DiplomacyPane = ({ active }) => {
  // Keep an object-shaped render value: this pane stays mounted while hidden,
  // and the React compiler may evaluate memo dependencies before its first load.
  const [snapshot, setSnapshot] = useState({ diplomacy: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [agreementType, setAgreementType] = useState('non-aggression');
  const [resource, setResource] = useState('food');
  const [resourceAmount, setResourceAmount] = useState(100);
  const [goldAmount, setGoldAmount] = useState(100);
  const [duration, setDuration] = useState(1);
  const locale = engineLocale();
  const t = (value) => engineText(value, locale);
  const labelFor = (id) => engineName(snapshot.polities?.find((entry) => entry.id === id), locale, id);

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame();
      if (!game) return;
      const next = await fetchEconomyState(game.id);
      setGameId(game.id);
      setSnapshot(next);
      setCounterparty((current) => current || next.polities.find((entry) => entry.id !== next.playerPolityId)?.id || '');
      setError('');
    } catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [active, load]);

  const playerId = snapshot?.playerPolityId;
  const relations = useMemo(() => (snapshot?.diplomacy?.relations ?? [])
    .filter((entry) => entry.polities.includes(playerId)), [snapshot, playerId]);
  const proposals = (snapshot?.diplomacy?.proposals ?? []).filter((entry) =>
    entry.proposerId === playerId || entry.recipientId === playerId);
  const agreements = (snapshot?.diplomacy?.agreements ?? []).filter((entry) =>
    entry.terms && (entry.terms.fromPolityId === playerId || entry.terms.toPolityId === playerId));
  const queue = (command, message) => {
    try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); }
    catch (queueError) { setError(queueError?.message || String(queueError)); }
  };
  const baseCommand = () => ({ commandId: crypto.randomUUID(), actorPolityId: playerId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });

  const proposeAgreement = () => {
    const proposalId = `proposal:${crypto.randomUUID()}`;
    queue({
      kind: 'diplomacy.propose', ...baseCommand(), proposalId, recipientPolityId: counterparty,
      terms: { kind: 'agreement', agreementType, fromPolityId: playerId, toPolityId: counterparty },
    }, locale === 'ru' ? `Предложение ${proposalId} запланировано на следующий переход времени.` : `Proposal ${proposalId} queued for the next time jump.`);
  };
  const proposeTrade = () => {
    const proposalId = `proposal:${crypto.randomUUID()}`;
    const months = Math.max(1, Math.min(120, Math.trunc(Number(duration) || 1)));
    queue({
      kind: 'diplomacy.propose', ...baseCommand(), proposalId, recipientPolityId: counterparty,
      terms: {
        kind: 'trade', fromPolityId: playerId, toPolityId: counterparty,
        fromLeg: { kind: 'resource', resource, amount: Math.max(1, Math.trunc(Number(resourceAmount) || 1)) },
        toLeg: { kind: 'treasury', amount: Math.max(1, Math.trunc(Number(goldAmount) || 1)) },
        cadence: months === 1 ? 'one-off' : 'monthly', durationMonths: months,
        earlyTerminationPenalty: Math.max(0, Math.trunc(Number(goldAmount) || 0)),
      },
    }, locale === 'ru' ? `Торговое предложение ${proposalId} запланировано на следующий переход времени.` : `Trade proposal ${proposalId} queued for the next time jump.`);
  };

  if (!snapshot?.revision) return <div style={{ padding: 14, color: dim }}>{error || t('Loading diplomacy…')}</div>;
  if (!snapshot?.diplomacy) return <div style={{ padding: 14, color: dim }}>{t('Diplomacy is disabled in this scenario.')}</div>;

  return <div data-testid="diplomacy-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>{t('Foreign affairs')}</div>
    {queued && <div data-testid="diplomacy-queued" style={{ ...card, color: '#93c5fd' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}

    <div style={{ color: dim, marginBottom: 5 }}>{t('Relations')}</div>
    {relations.map((entry) => {
      const other = entry.polities.find((id) => id !== playerId);
      return <div key={other} style={card}>
        <strong>{labelFor(other)}</strong>
        <div style={{ color: dim, marginTop: 4 }}>{t('Opinion')} {relationValue(entry.opinion)} · {t('Trust')} {relationValue(entry.trust)} · {t('Threat')} {relationValue(entry.threat)}</div>
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Pending proposals')}</div>
    {proposals.length === 0 && <div style={{ color: dim, marginBottom: 8 }}>{t('None')}</div>}
    {proposals.map((proposal) => <div key={proposal.proposalId} style={card}>
      <div><strong>{labelFor(proposal.proposerId)}</strong> → {labelFor(proposal.recipientId)}</div>
      <div style={{ color: dim, margin: '4px 0' }}>{t(proposal.terms?.kind === 'trade' ? 'Trade contract' : proposal.terms?.agreementType ?? 'Private contact')}</div>
      {proposal.recipientId === playerId && proposal.terms && <div style={{ display: 'flex', gap: 5 }}>
        <button data-testid="accept-proposal" style={button} onClick={() => queue({ kind: 'diplomacy.respond', ...baseCommand(), proposalId: proposal.proposalId, response: 'accept' }, t('Acceptance queued.'))}>{t('Accept')}</button>
        <button style={button} onClick={() => queue({ kind: 'diplomacy.respond', ...baseCommand(), proposalId: proposal.proposalId, response: 'reject' }, t('Rejection queued.'))}>{t('Reject')}</button>
        <button style={button} onClick={() => queue({ kind: 'diplomacy.counter', ...baseCommand(), proposalId: proposal.proposalId, counterProposalId: `proposal:${crypto.randomUUID()}`, terms: counterTerms(proposal.terms, playerId) }, t('Counterproposal queued.'))}>{t('Counter')}</button>
      </div>}
    </div>)}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Active agreements')}</div>
    {agreements.length === 0 && <div style={{ color: dim, marginBottom: 8 }}>{t('None')}</div>}
    {agreements.map((agreement) => <div key={agreement.agreementId} style={card}>
      <div>{t(agreement.terms.kind === 'trade' ? 'Trade' : agreement.terms.agreementType)}</div>
      <div style={{ color: dim, margin: '3px 0' }}>{labelFor(agreement.terms.fromPolityId)} ↔ {labelFor(agreement.terms.toPolityId)}</div>
      <button style={button} onClick={() => queue({ kind: 'diplomacy.terminate-agreement', ...baseCommand(), agreementId: agreement.agreementId }, t('Termination queued.'))}>{t('Terminate')}</button>
    </div>)}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('New proposal')}</div>
    <select style={input} value={counterparty} onChange={(event) => setCounterparty(event.target.value)}>
      {snapshot.polities.filter((entry) => entry.id !== playerId).map((entry) => <option key={entry.id} value={entry.id}>{engineName(entry, locale, entry.id)}</option>)}
    </select>
    <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
      <select style={input} value={agreementType} onChange={(event) => setAgreementType(event.target.value)}>
        <option value="non-aggression">{t('Non-aggression')}</option><option value="defensive-alliance">{t('Defensive alliance')}</option>
        <option value="guarantee">{t('Guarantee')}</option><option value="military-access">{t('Military access')}</option>
      </select>
      <button data-testid="queue-agreement" style={button} onClick={proposeAgreement}>{t('Queue')}</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 8 }}>
      <select style={input} value={resource} onChange={(event) => setResource(event.target.value)}>{snapshot.activeResources.map((entry) => <option key={entry}>{t(entry)}</option>)}</select>
      <input style={input} type="number" min="1" value={resourceAmount} onChange={(event) => setResourceAmount(event.target.value)} title={t('Resource amount')} />
      <input style={input} type="number" min="1" value={goldAmount} onChange={(event) => setGoldAmount(event.target.value)} title={t('Treasury payment')} />
      <input style={input} type="number" min="1" max="120" value={duration} onChange={(event) => setDuration(event.target.value)} title={t('Months')} />
    </div>
    <button data-testid="queue-trade" style={{ ...button, marginTop: 6, width: '100%' }} onClick={proposeTrade}>{t('Queue resource-for-treasury trade')}</button>

    {(snapshot.lastTurn?.ledger?.trade?.executions ?? []).length > 0 && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Last deliveries')}</div>
      {snapshot.lastTurn.ledger.trade.executions.map((entry) => <div key={entry.contractId} style={card}>
        {entry.contractId}: {relationValue(entry.fulfillmentBp)} {t('delivered')}{entry.breach ? ` · ${t('breach')}` : ''}
      </div>)}
    </>}
  </div>;
};

export default DiplomacyPane;
