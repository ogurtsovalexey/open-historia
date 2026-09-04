/*! P5 deterministic war, occupation and peace pane. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';
import { engineLocale, engineName, engineText } from './engineI18n.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(185,28,28,0.25)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };
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
  const locale = engineLocale();
  const t = (value) => engineText(value, locale);
  const nameFor = (polityId) => engineName(snapshot.polities?.find((entry) => entry.id === polityId), locale, polityId);
  const regionFor = (regionId) => engineName(snapshot.regions?.find((entry) => entry.regionId === regionId), locale, regionId);

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

  if (!snapshot.revision) return <div style={{ padding: 14, color: dim }}>{error || t('Loading armed forces…')}</div>;
  if (!military) return <div style={{ padding: 14, color: dim }}>{t('Armed forces are disabled in this scenario.')}</div>;
  const row = military.polity;

  const declareWar = () => {
    const warId = `war:${crypto.randomUUID()}`;
    queue({ kind: 'war.declare', ...base(), warId, defenderPolityId: defenderId, reason }, locale === 'ru' ? `Объявление войны ${warId} отправлено на подтверждение.` : `War declaration ${warId} queued for confirmation.`);
  };
  const mobilize = () => {
    const availableManpower = Math.max(1, Math.min(Math.trunc(Number(manpower) || 1), row.manpowerPool));
    const availableEquipment = Math.max(1, Math.min(Math.trunc(Number(equipment) || 1), row.equipmentReserve));
    const formationId = `formation:reserve-${crypto.randomUUID()}`;
    queue({ kind: 'military.mobilize', ...base(), formationId, locationRegionId: mobilizationRegionId,
      manpower: availableManpower, equipment: availableEquipment, commanderId: commanderId || null }, locale === 'ru' ? `Мобилизация ${formationId} запланирована; развёртывание займёт месяц.` : `Mobilization ${formationId} queued; activation takes one month.`);
  };
  const offerPeace = (war, occupation) => {
    const recipientPolityId = occupation.legalControllerId;
    const amount = Math.max(0, Math.trunc(Number(reparation) || 0));
    const offerId = `peace:${crypto.randomUUID()}`;
    queue({ kind: 'peace.propose', ...base(), offerId, warId: war.warId, recipientPolityId,
      regionTransfers: [{ regionId: occupation.regionId, toPolityId: playerId }],
      reparation: amount > 0 ? { fromPolityId: recipientPolityId, toPolityId: playerId, amount } : null,
    }, locale === 'ru' ? `Мирное предложение ${offerId} отправлено на подтверждение.` : `Peace offer ${offerId} queued for confirmation.`);
  };

  return <div data-testid="military-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>{t('War ministry')}</div>
    {queued && <div data-testid="military-queued" style={{ ...card, color: '#fca5a5' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}

    <div style={card}>
      <strong>{t('National reserves')}</strong>
      <div style={{ color: dim, marginTop: 4 }}>{t('Recruitable')} {row.manpowerPool.toLocaleString()} / {t('ceiling')} {row.manpowerCeiling.toLocaleString()} · {t('under arms')} {row.mobilized.toLocaleString()} · {t('casualties')} {row.casualties.toLocaleString()}</div>
      <div style={{ color: dim, marginTop: 3 }}>{t('Equipment reserve')} {row.equipmentReserve.toLocaleString()} · {t('lost')} {row.equipmentLost.toLocaleString()}</div>
    </div>

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Formations')}</div>
    {military.formations.map((formation) => {
      const candidates = candidatesByFormation.get(formation.formationId) ?? [];
      return <div key={formation.formationId} style={card}>
        <strong>{engineName(formation, locale, formation.formationId)}</strong>
        <div style={{ color: dim, marginTop: 4 }}>{t(formation.status)} · {formation.manpower.toLocaleString()} {t('troops')} · {formation.equipment.toLocaleString()} {t('equipment')} · {t('morale')} {Math.round(formation.moraleBp / 100)}%</div>
        <div style={{ color: dim, marginTop: 3 }}>{t('At')} {regionFor(formation.locationRegionId)} · {t('posture')} {t(formation.posture)}{formation.readyMonth ? ` · ${t('ready')} ${formation.readyMonth}` : ''}</div>
        {(formation.status === 'active' || (formation.status === 'mobilizing' && formation.readyMonth && formation.readyMonth <= snapshot.month)) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          <button style={button} onClick={() => queue({ kind: 'military.order', ...base(), formationId: formation.formationId, posture: 'defend', targetRegionId: null }, locale === 'ru' ? 'Оборонительный приказ запланирован.' : 'Defensive order queued.')}>{t('Defend')}</button>
          {candidates.map((candidate) => <button data-testid="queue-advance" key={candidate.regionId} style={button} onClick={() => queue({ kind: 'military.order', ...base(), formationId: formation.formationId, posture: 'advance', targetRegionId: candidate.regionId }, locale === 'ru' ? `Наступление на ${regionFor(candidate.regionId)} запланировано.` : `Advance on ${regionFor(candidate.regionId)} queued.`)}>{t('Advance')}: {regionFor(candidate.regionId)}</button>)}
          {activeWars.length === 0 && <button style={button} onClick={() => queue({ kind: 'military.demobilize', ...base(), formationId: formation.formationId }, locale === 'ru' ? 'Демобилизация запланирована.' : 'Demobilization queued.')}>{t('Demobilize')}</button>}
        </div>}
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Mobilize reserves')}</div>
    <div style={card}>
      <select aria-label={t('Mobilization region')} style={input} value={mobilizationRegionId} onChange={(event) => setMobilizationRegionId(event.target.value)}>
        {military.mobilizationRegions.map((entry) => <option key={entry.regionId} value={entry.regionId}>{regionFor(entry.regionId)}</option>)}
      </select>
      <select aria-label={t('Reserve commander')} style={{ ...input, marginTop: 5 }} value={commanderId} onChange={(event) => setCommanderId(event.target.value)}>
        <option value="">{t('No commander')}</option>{military.commanders.map((entry) => <option key={entry.commanderId} value={entry.commanderId}>{engineName(entry, locale, entry.commanderId)} · {t('skill')} {entry.skill}</option>)}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 5 }}>
        <input aria-label={t('Mobilized manpower')} style={input} type="number" min="1" max={row.manpowerPool} value={manpower} onChange={(event) => setManpower(event.target.value)} />
        <input aria-label={t('Mobilized equipment')} style={input} type="number" min="1" max={row.equipmentReserve} value={equipment} onChange={(event) => setEquipment(event.target.value)} />
      </div>
      <button data-testid="queue-mobilization" disabled={!mobilizationRegionId || row.manpowerPool < 1 || row.equipmentReserve < 1} style={{ ...button, marginTop: 6, width: '100%' }} onClick={mobilize}>{t('Queue mobilization')}</button>
    </div>

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Wars and occupation')}</div>
    {(military.callsToArms ?? []).filter((entry) => entry.status === 'pending').map((call) => <div key={call.callId} data-testid="call-to-arms" style={card}>
      <strong>{t('Call to arms from')} {nameFor(call.beneficiaryPolityId)}</strong>
      <div style={{ color: dim, margin: '4px 0' }}>{t('Defensive war')} {call.warId} · {t('obligation')} {call.sourceAgreementIds.join(', ')}</div>
      {call.calledPolityId === playerId && <div style={{ display: 'flex', gap: 5 }}>
        <button data-testid="accept-call" style={button} onClick={() => queue({ kind: 'war.respond-call', ...base(), callId: call.callId, response: 'accept' }, locale === 'ru' ? 'Принятие призыва отправлено на подтверждение.' : 'Call to arms acceptance queued for confirmation.')}>{t('Join defenders')}</button>
        <button data-testid="refuse-call" style={button} onClick={() => queue({ kind: 'war.respond-call', ...base(), callId: call.callId, response: 'refuse' }, locale === 'ru' ? 'Отказ от призыва отправлен на подтверждение.' : 'Call to arms refusal queued for confirmation.')}>{t('Refuse')}</button>
      </div>}
    </div>)}
    {activeWars.length === 0 && <div style={{ color: dim, marginBottom: 8 }}>{t('No active war.')}</div>}
    {activeWars.map((war) => {
      const occupations = military.occupations.filter((entry) => entry.warId === war.warId);
      return <div key={war.warId} style={card}>
        <strong>{t(war.reason)} {locale === 'ru' ? 'война' : 'war'}</strong>
        <div style={{ color: dim, marginTop: 4 }}>{war.attackers.map((id) => nameFor(id)).join(', ')} {t('vs')} {war.defenders.map((id) => nameFor(id)).join(', ')}</div>
        {occupations.map((occupation) => <div key={occupation.regionId} data-testid="occupation" style={{ marginTop: 6 }}>
          {regionFor(occupation.regionId)}: {t('actual control')} {nameFor(occupation.actualControllerId)}, {t('legal owner')} {nameFor(occupation.legalControllerId)}
          {occupation.actualControllerId === playerId && <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
            <input aria-label={t('Peace reparations')} style={{ ...input, width: 100 }} type="number" min="0" value={reparation} onChange={(event) => setReparation(event.target.value)} />
            <button data-testid="queue-peace" style={button} onClick={() => offerPeace(war, occupation)}>{t('Offer peace')}</button>
          </div>}
        </div>)}
      </div>;
    })}

    <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Declare war')}</div>
    <div style={card}>
      <select aria-label={t('War defender')} style={input} value={defenderId} onChange={(event) => setDefenderId(event.target.value)}>
        {military.warDeclarationCandidates.map((entry) => <option key={entry.polityId} value={entry.polityId}>{nameFor(entry.polityId)}</option>)}
      </select>
      <select aria-label={t('War reason')} style={{ ...input, marginTop: 5 }} value={reason} onChange={(event) => setReason(event.target.value)}>
        <option value="claim">{t('Claim')}</option><option value="rivalry">{t('Rivalry')}</option><option value="guarantee">{t('Guarantee')}</option><option value="defense">{t('Defense')}</option><option value="none">{t('No recognized reason')}</option>
      </select>
      <button data-testid="queue-war" disabled={!defenderId} style={{ ...button, marginTop: 6, width: '100%' }} onClick={declareWar}>{t('Queue declaration')}</button>
    </div>

    {military.peaceOffers.filter((entry) => entry.status === 'pending').map((offer) => <div key={offer.offerId} style={card}>
      <strong>{t('Peace offer from')} {nameFor(offer.proposerPolityId)}</strong>
      <div style={{ color: dim, margin: '4px 0' }}>{offer.regionTransfers.map((entry) => regionFor(entry.regionId)).join(', ') || t('No territorial terms')}{offer.reparation ? ` · ${t('reparations')} ${offer.reparation.amount}` : ''}</div>
      {offer.recipientPolityId === playerId && <div style={{ display: 'flex', gap: 5 }}>
        <button data-testid="accept-peace" style={button} onClick={() => queue({ kind: 'peace.respond', ...base(), offerId: offer.offerId, response: 'accept' }, locale === 'ru' ? 'Принятие мира отправлено на подтверждение.' : 'Peace acceptance queued for confirmation.')}>{t('Accept')}</button>
        <button style={button} onClick={() => queue({ kind: 'peace.respond', ...base(), offerId: offer.offerId, response: 'reject' }, locale === 'ru' ? 'Отказ от мира отправлен на подтверждение.' : 'Peace rejection queued for confirmation.')}>{t('Reject')}</button>
      </div>}
    </div>)}

    {(snapshot.lastTurn?.ledger?.military?.combats ?? []).length > 0 && <>
      <div style={{ color: dim, margin: '12px 0 5px' }}>{t('Last combat')}</div>
      {snapshot.lastTurn.ledger.military.combats.map((combat) => <div key={combat.frontId} data-testid="combat-record" style={card}>
        <strong>{t(combat.outcome)}</strong> {locale === 'ru' ? 'в регионе' : 'at'} {regionFor(combat.targetRegionId)}
        <div style={{ color: dim, marginTop: 4 }}>{t('Supply')} {Math.round(combat.attackerSupplyBp / 100)}% · {t('losses')} {combat.attackerLosses}/{combat.defenderLosses} · {t('seed')} {combat.variationBp}</div>
      </div>)}
    </>}
  </div>;
};

export default MilitaryPane;
