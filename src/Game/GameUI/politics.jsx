/*! P4 deterministic internal-politics and characters pane. */
import React, { useCallback, useEffect, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(99,102,241,0.2)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };

const PoliticsPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState({ politics: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [office, setOffice] = useState('finance');
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState('fictional-runtime');
  const [newFactionId, setNewFactionId] = useState('');

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame(); if (!game) return;
      const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next);
      const candidates = next.politics?.characters?.filter((entry) => !['ruler', 'heir'].includes(entry.office)) ?? [];
      setCandidateId((current) => current || candidates[0]?.characterId || '');
      setNewFactionId((current) => current || next.politics?.factions?.[0]?.factionId || '');
      setError('');
    } catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => {
    if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer);
  }, [active, load]);

  const politics = snapshot.politics;
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: snapshot.playerPolityId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => {
    try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); } catch (queueError) { setError(queueError?.message || String(queueError)); }
  };
  const characterName = (id) => politics?.characters.find((entry) => entry.characterId === id)?.displayName?.en ?? id;

  if (!snapshot?.revision) return <div style={{ padding: 14, color: dim }}>{error || 'Loading politics…'}</div>;
  if (!politics) return <div style={{ padding: 14, color: dim }}>Internal politics is disabled in this scenario.</div>;
  return <div data-testid="politics-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>Politics</div>
    {queued && <div data-testid="politics-queued" style={{ ...card, color: '#a5b4fc' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}
    <div style={card}>
      <strong>{characterName(politics.polity.rulerCharacterId)}</strong>
      <div style={{ color: dim, marginTop: 3 }}>Heir {characterName(politics.polity.heirCharacterId)} · {politics.polity.successionLaw}</div>
      <div style={{ marginTop: 4 }}>Legitimacy {politics.polity.legitimacyBp / 100}% · Stability {politics.polity.stabilityBp / 100}% · Unrest {politics.polity.unrestBp / 100}%</div>
      {politics.polity.heirCharacterId && <button data-testid="queue-abdication" style={{ ...button, marginTop: 6 }} onClick={() => queue({ kind: 'politics.abdicate', ...base() }, 'Abdication queued.')}>Abdicate to heir</button>}
    </div>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Factions and demands</div>
    {politics.factions.map((faction) => <div key={faction.factionId} style={card}>
      <strong>{faction.displayName.en}</strong>
      <div style={{ marginTop: 3 }}>Support {faction.supportBp / 100}% · Power {faction.powerBp / 100}%</div>
      <div style={{ color: dim, marginTop: 3 }}>{faction.ideology} · tradition {faction.traditionalismBp / 100}%</div>
      <div style={{ color: faction.escalation === 'calm' ? dim : '#fbbf24', margin: '3px 0' }}>{faction.escalation} · wants {faction.preferredBudgetCategory}</div>
      {faction.escalation !== 'calm' && <div style={{ display: 'flex', gap: 5 }}>
        {['concede', 'repress', 'refuse'].map((response) => <button key={response} data-testid={`politics-${response}-${faction.factionId}`} style={button} onClick={() => queue({
          kind: 'politics.respond', ...base(), factionId: faction.factionId, response,
        }, `${response} response queued for ${faction.displayName.en}.`)}>{response}</button>)}
      </div>}
    </div>)}

    <div style={{ color: dim, margin: '12px 0 5px' }}>Appointments</div>
    <select aria-label="Political candidate" style={input} value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
      {politics.characters.filter((entry) => !['ruler', 'heir'].includes(entry.office)).map((entry) => <option key={entry.characterId} value={entry.characterId}>{entry.displayName.en}{entry.office ? ` — ${entry.office}` : ''}</option>)}
    </select>
    <select aria-label="Political office" style={{ ...input, marginTop: 5 }} value={office} onChange={(event) => setOffice(event.target.value)}>
      {['head-of-government', 'finance', 'foreign', 'military'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
    </select>
    <button data-testid="queue-appointment" style={{ ...button, width: '100%', marginTop: 6 }} disabled={!candidateId} onClick={() => queue({
      kind: 'politics.appoint', ...base(), characterId: candidateId, office,
    }, 'Appointment queued.')}>Queue appointment</button>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Create fictional official</div>
    <input aria-label="Runtime character name" style={input} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Name" />
    <select aria-label="Character origin" style={{ ...input, marginTop: 5 }} value={newOrigin} onChange={(event) => setNewOrigin(event.target.value)}>
      <option value="fictional-runtime">Fictional</option><option value="historical-runtime">Historical</option>
    </select>
    <select aria-label="Fictional character faction" style={{ ...input, marginTop: 5 }} value={newFactionId} onChange={(event) => setNewFactionId(event.target.value)}>
      {politics.factions.map((entry) => <option key={entry.factionId} value={entry.factionId}>{entry.displayName.en}</option>)}
    </select>
    <button data-testid="queue-fictional-character" style={{ ...button, width: '100%', marginTop: 6 }} disabled={!newName.trim() || !newFactionId} onClick={() => queue({
      kind: 'character.create', ...base(), characterId: `character:runtime-${crypto.randomUUID()}`,
      displayName: { en: newName.trim(), ru: newName.trim() }, origin: newOrigin, factionId: newFactionId,
      aptitudeTrait: 'administrator', loyaltyBand: 'medium', ambitionBand: 'medium',
    }, 'Fictional official queued for confirmation.')}>Create official</button>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Key characters</div>
    {politics.characters.map((character) => <div key={character.characterId} style={card}>
      <strong>{character.displayName.en}</strong> · {character.office ?? 'unappointed'}
      <div style={{ color: dim, marginTop: 3 }}>{character.startingTraits.join(', ')} · loyalty {character.loyaltyBp / 100}% · ambition {character.ambitionBp / 100}%</div>
      {character.relations.length > 0 && <div style={{ color: dim, marginTop: 3 }}>{character.relations.map((relation) => `${relation.sentiment}: ${characterName(relation.characterId)}`).join(' · ')}</div>}
    </div>)}
  </div>;
};

export default PoliticsPane;
