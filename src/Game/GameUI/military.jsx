/*! P5 deterministic war, occupation and peace pane. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(185,28,28,0.25)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };
const nameFor = (snapshot, polityId) => snapshot.polities?.find((entry) => entry.id === polityId)?.displayName?.en ?? polityId;
const regionFor = (snapshot, regionId) => snapshot.regions?.find((entry) => entry.regionId === regionId)?.displayName?.en ?? regionId;

const MilitaryPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState({ military: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const [defenderId, setDefenderId] = useState('');
  const [reason, setReason] = useState('claim');
  const [mobilizationRegionId, setMobilizationRegionId] = useState('');
  const [commanderId, setCommanderId] = useState('');
  const [manpower, setManpower] = useState(2000);
  const [equipment, setEquipment] = useState(2000);
  const [reparation, setReparation] = useState(0);

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame(); if (!game) return;
      const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next);
      setDefenderId((current) => next.military?.warDeclarationCandidates?.some((entry) => entry.polityId === current)
        ? current : next.military?.warDeclarationCandidates?.[0]?.polityId || '');
      setMobilizationRegionId((current) => current || next.military?.mobilizationRegions?.[0]?.regionId || '');
      setCommanderId((current) => current || next.military?.commanders?.[0]?.commanderId || '');
      setError('');
    } catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => {
    if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer);
  }, [active, load]);

  const military = snapshot.military;
  const playerId = snapshot.playerPolityId;
  const activeWars = military?.wars?.filter((entry) => entry.status === 'active') ?? [];
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: playerId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => {
    try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); }
    catch (queueError) { setError(queueError?.message || String(queueError)); }
  };
  const candidatesByFormation = useMemo(() => new Map((military?.orderCandidates ?? []).reduce((rows, entry) => {
    const values = rows.get(entry.formationId) ?? []; values.push(entry); rows.set(entry.formationId, values); return rows;
  }, new Map())), [military]);

  if (!snapshot.revision) return <div style={{ padding: 14, color: dim }}>{error || 'Loading armed forces…'}</div>;
  if (!military) return <div style={{ padding: 14, color: dim }}>Armed forces are disabled in this scenario.</div>;
  const row = military.polity;

  const declareWar = () => {
    const warId = `war:${crypto.randomUUID()}`;
    queue({ kind: 'war.declare', ...base(), warId, defenderPolityId: defenderId, reason }, `War declaration ${warId} queued for confirmation.`);
  };
  const mobilize = () => {
    const availableManpower = Math.max(1, Math.min(Math.trunc(Number(manpower) || 1), row.manpowerPool));
    const availableEquipment = Math.max(1, Math.min(Math.trunc(Number(equipment) || 1), row.equipmentReserve));
    const formationId = `formation:reserve-${crypto.randomUUID()}`;
    queue({ kind: 'military.mobilize', ...base(), formationId, locationRegionId: mobilizationRegionId,
      manpower: availableManpower, equipment: availableEquipment, commanderId: commanderId || null }, `Mobilization ${formationId} queued; activation takes one month.`);
  };
  const offerPeace = (war, occupation) => {
    const recipientPolityId = occupation.legalControllerId;
    const amount = Math.max(0, Math.trunc(Number(reparation) || 0));
    const offerId = `peace:${crypto.randomUUID()}`;
    queue({ kind: 'peace.propose', ...base(), offerId, warId: war.warId, recipientPolityId,
      regionTransfers: [{ regionId: occupation.regionId, toPolityId: playerId }],
      reparation: amount > 0 ? { fromPolityId: recipientPolityId, toPolityId: playerId, amount } : null,
    }, `Peace offer ${offerId} queued for confirmation.`);
  };

  return <div data-testid="military-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>War ministry</div>
    {queued && <div data-testid="military-queued" style={{ ...card, color: '#fca5a5' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}

    <div style={card}>
      <strong>National reserves</strong>
      <div style={{ color: dim, marginTop: 4 }}>Recruitable {row.manpowerPool.toLocaleString()} / ceiling {row.manpowerCeiling.toLocaleString()} · under arms {row.mobilized.toLocaleString()} · casualties {row.casualties.toLocaleString()}</div>
      <div style={{ color: dim, marginTop: 3 }}>Equipment reserve {row.equipmentReserve.toLocaleString()} · lost {row.equipmentLost.toLocaleString()}</div>
    </div>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Formations</div>
    {military.formations.map((formation) => {
      const candidates = candidatesByFormation.get(formation.formationId) ?? [];
      return <div key={formation.formationId} style={card}>
        <strong>{formation.displayName.en}</strong>
        <div style={{ color: dim, marginTop: 4 }}>{formation.status} · {formation.manpower.toLocaleString()} troops · {formation.equipment.toLocaleString()} equipment · morale {Math.round(formation.moraleBp / 100)}%</div>
        <div style={{ color: dim, marginTop: 3 }}>At {regionFor(snapshot, formation.locationRegionId)} · posture {formation.posture}{formation.readyMonth ? ` · ready ${formation.readyMonth}` : ''}</div>
        {(formation.status === 'active' || (formation.status === 'mobilizing' && formation.readyMonth && formation.readyMonth <= snapshot.month)) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          <button style={button} onClick={() => queue({ kind: 'military.order', ...base(), formationId: formation.formationId, posture: 'defend', targetRegionId: null }, 'Defensive order queued.')}>Defend</button>
          {candidates.map((candidate) => <button data-testid="queue-advance" key={candidate.regionId} style={button} onClick={() => queue({ kind: 'military.order', ...base(), formationId: formation.formationId, posture: 'advance', targetRegionId: candidate.regionId }, `Advance on ${regionFor(snapshot, candidate.regionId)} queued.`)}>Advance: {regionFor(snapshot, candidate.regionId)}</button>)}
          {activeWars.length === 0 && <button style={button} onClick={() => queue({ kind: 'military.demobilize', ...base(), formationId: formation.formationId }, 'Demobilization queued.')}>Demobilize</button>}
        </div>}
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>Mobilize reserves</div>
    <div style={card}>
      <select aria-label="Mobilization region" style={input} value={mobilizationRegionId} onChange={(event) => setMobilizationRegionId(event.target.value)}>
        {military.mobilizationRegions.map((entry) => <option key={entry.regionId} value={entry.regionId}>{entry.name}</option>)}
      </select>
      <select aria-label="Reserve commander" style={{ ...input, marginTop: 5 }} value={commanderId} onChange={(event) => setCommanderId(event.target.value)}>
        <option value="">No commander</option>{military.commanders.map((entry) => <option key={entry.commanderId} value={entry.commanderId}>{entry.displayName.en} · skill {entry.skill}</option>)}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 5 }}>
        <input aria-label="Mobilized manpower" style={input} type="number" min="1" max={row.manpowerPool} value={manpower} onChange={(event) => setManpower(event.target.value)} />
        <input aria-label="Mobilized equipment" style={input} type="number" min="1" max={row.equipmentReserve} value={equipment} onChange={(event) => setEquipment(event.target.value)} />
      </div>
      <button data-testid="queue-mobilization" disabled={!mobilizationRegionId || row.manpowerPool < 1 || row.equipmentReserve < 1} style={{ ...button, marginTop: 6, width: '100%' }} onClick={mobilize}>Queue mobilization</button>
    </div>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Wars and occupation</div>
    {(military.callsToArms ?? []).filter((entry) => entry.status === 'pending').map((call) => <div key={call.callId} data-testid="call-to-arms" style={card}>
      <strong>Call to arms from {nameFor(snapshot, call.beneficiaryPolityId)}</strong>
      <div style={{ color: dim, margin: '4px 0' }}>Defensive war {call.warId} · obligation {call.sourceAgreementIds.join(', ')}</div>
      {call.calledPolityId === playerId && <div style={{ display: 'flex', gap: 5 }}>
        <button data-testid="accept-call" style={button} onClick={() => queue({ kind: 'war.respond-call', ...base(), callId: call.callId, response: 'accept' }, 'Call to arms acceptance queued for confirmation.')}>Join defenders</button>
        <button data-testid="refuse-call" style={button} onClick={() => queue({ kind: 'war.respond-call', ...base(), callId: call.callId, response: 'refuse' }, 'Call to arms refusal queued for confirmation.')}>Refuse</button>
      </div>}
    </div>)}
    {activeWars.length === 0 && <div style={{ color: dim, marginBottom: 8 }}>No active war.</div>}
    {activeWars.map((war) => {
      const occupations = military.occupations.filter((entry) => entry.warId === war.warId);
      return <div key={war.warId} style={card}>
        <strong>{war.reason} war</strong>
        <div style={{ color: dim, marginTop: 4 }}>{war.attackers.map((id) => nameFor(snapshot, id)).join(', ')} vs {war.defenders.map((id) => nameFor(snapshot, id)).join(', ')}</div>
        {occupations.map((occupation) => <div key={occupation.regionId} data-testid="occupation" style={{ marginTop: 6 }}>
          {regionFor(snapshot, occupation.regionId)}: actual control {nameFor(snapshot, occupation.actualControllerId)}, legal owner {nameFor(snapshot, occupation.legalControllerId)}
          {occupation.actualControllerId === playerId && <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
            <input aria-label="Peace reparations" style={{ ...input, width: 100 }} type="number" min="0" value={reparation} onChange={(event) => setReparation(event.target.value)} />
            <button data-testid="queue-peace" style={button} onClick={() => offerPeace(war, occupation)}>Offer peace</button>
          </div>}
        </div>)}
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>Declare war</div>
    <div style={card}>
      <select aria-label="War defender" style={input} value={defenderId} onChange={(event) => setDefenderId(event.target.value)}>
        {military.warDeclarationCandidates.map((entry) => <option key={entry.polityId} value={entry.polityId}>{entry.name}</option>)}
      </select>
      <select aria-label="War reason" style={{ ...input, marginTop: 5 }} value={reason} onChange={(event) => setReason(event.target.value)}>
        <option value="claim">Claim</option><option value="rivalry">Rivalry</option><option value="guarantee">Guarantee</option><option value="defense">Defense</option><option value="none">No recognized reason</option>
      </select>
      <button data-testid="queue-war" disabled={!defenderId} style={{ ...button, marginTop: 6, width: '100%' }} onClick={declareWar}>Queue declaration</button>
    </div>

    {military.peaceOffers.filter((entry) => entry.status === 'pending').map((offer) => <div key={offer.offerId} style={card}>
      <strong>Peace offer from {nameFor(snapshot, offer.proposerPolityId)}</strong>
      <div style={{ color: dim, margin: '4px 0' }}>{offer.regionTransfers.map((entry) => regionFor(snapshot, entry.regionId)).join(', ') || 'No territorial terms'}{offer.reparation ? ` · reparations ${offer.reparation.amount}` : ''}</div>
      {offer.recipientPolityId === playerId && <div style={{ display: 'flex', gap: 5 }}>
        <button data-testid="accept-peace" style={button} onClick={() => queue({ kind: 'peace.respond', ...base(), offerId: offer.offerId, response: 'accept' }, 'Peace acceptance queued for confirmation.')}>Accept</button>
        <button style={button} onClick={() => queue({ kind: 'peace.respond', ...base(), offerId: offer.offerId, response: 'reject' }, 'Peace rejection queued for confirmation.')}>Reject</button>
      </div>}
    </div>)}

    {(snapshot.lastTurn?.ledger?.military?.combats ?? []).length > 0 && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>Last combat</div>
      {snapshot.lastTurn.ledger.military.combats.map((combat) => <div key={combat.frontId} data-testid="combat-record" style={card}>
        <strong>{combat.outcome}</strong> at {regionFor(snapshot, combat.targetRegionId)}
        <div style={{ color: dim, marginTop: 4 }}>Supply {Math.round(combat.attackerSupplyBp / 100)}% · losses {combat.attackerLosses}/{combat.defenderLosses} · seed {combat.variationBp}</div>
      </div>)}
    </>}
  </div>;
};

export default MilitaryPane;
