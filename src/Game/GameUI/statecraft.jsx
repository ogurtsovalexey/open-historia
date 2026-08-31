/*! P3c deterministic finance/projects/intelligence pane. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEconomyState, getActiveEngineGame, queueEconomyCommand } from '../../runtime/economy.js';

const dim = 'rgba(255,255,255,0.58)';
const line = 'rgba(255,255,255,0.12)';
const card = { border: `1px solid ${line}`, borderRadius: 8, padding: 9, marginBottom: 8, background: 'rgba(255,255,255,0.035)' };
const button = { border: `1px solid ${line}`, borderRadius: 7, padding: '6px 8px', background: 'rgba(99,102,241,0.2)', color: 'white', cursor: 'pointer' };
const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 7, padding: 7, background: 'rgba(0,0,0,0.2)', color: 'white' };
const budgetStances = {
  balanced: { administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000 },
  industry: { administration: 1800, science: 1200, industry: 4000, security: 1000, military: 2000 },
  science: { administration: 1800, science: 4000, industry: 1800, security: 1000, military: 1400 },
  security: { administration: 2000, science: 1000, industry: 1500, security: 3000, military: 2500 },
};
const monthsBetween = (from, to) => {
  const [fy, fm] = String(from).split('-').map(Number); const [ty, tm] = String(to).split('-').map(Number);
  return (ty - fy) * 12 + tm - fm;
};

const StatecraftPane = ({ active }) => {
  const [snapshot, setSnapshot] = useState({ statecraft: null });
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState('');
  const [queued, setQueued] = useState('');
  const [taxBurden, setTaxBurden] = useState(10000);
  const [exemption, setExemption] = useState(0);
  const [budgetStance, setBudgetStance] = useState('balanced');
  const [bondAmount, setBondAmount] = useState(500);
  const [templateId, setTemplateId] = useState('');
  const [targetPolityId, setTargetPolityId] = useState('');
  const [targetRegionId, setTargetRegionId] = useState('');
  const [funding, setFunding] = useState(250);
  const [priority, setPriority] = useState(3);

  const load = useCallback(async () => {
    try {
      const game = await getActiveEngineGame(); if (!game) return;
      const next = await fetchEconomyState(game.id); setGameId(game.id); setSnapshot(next);
      const finance = next.statecraft?.finance;
      if (finance) { setTaxBurden(finance.taxBurdenBp); setExemption(finance.exemptionBp); }
      setTemplateId((current) => current || next.statecraft?.templates?.[0]?.templateId || '');
      setTargetPolityId((current) => current || next.polities.find((entry) => entry.id !== next.playerPolityId)?.id || '');
      setTargetRegionId((current) => current || next.regions.find((entry) => entry.controllerId === next.playerPolityId)?.regionId || '');
      setError('');
    } catch (loadError) { setError(loadError?.message || String(loadError)); }
  }, []);
  useEffect(() => {
    if (!active) return undefined; load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer);
  }, [active, load]);

  const statecraft = snapshot?.statecraft;
  const finance = statecraft?.finance;
  const selectedTemplate = statecraft?.templates?.find((entry) => entry.templateId === templateId);
  const activeProjects = useMemo(() => (statecraft?.projects ?? []).filter((entry) => entry.status === 'active'), [statecraft]);
  const base = () => ({ commandId: crypto.randomUUID(), actorPolityId: snapshot.playerPolityId, expectedRevision: snapshot.revision, effectiveMonth: snapshot.month });
  const queue = (command, message) => {
    try { queueEconomyCommand(gameId, command); setQueued(message); setError(''); } catch (queueError) { setError(queueError?.message || String(queueError)); }
  };
  const queuePolicy = () => queue({
    kind: 'finance.set-policy', ...base(), taxBurdenBp: Number(taxBurden), exemptionBp: Number(exemption),
    priorities: budgetStances[budgetStance],
  }, 'Finance policy queued for the next monthly boundary.');
  const queueBonds = () => queue({ kind: 'finance.issue-bonds', ...base(), amount: Math.max(1, Math.trunc(Number(bondAmount) || 1)) }, 'Bond issuance queued.');
  const queueProject = () => {
    const target = selectedTemplate?.effect?.kind === 'infrastructure' ? { targetRegionId }
      : selectedTemplate?.effect?.kind === 'reveal-intelligence' ? { targetPolityId } : {};
    queue({
      kind: 'project.start', ...base(), projectId: `project:${crypto.randomUUID()}`, templateId,
      ...target, monthlyFunding: Math.max(1, Math.trunc(Number(funding) || 1)), priority: Math.max(1, Math.min(5, Math.trunc(Number(priority) || 1))),
    }, 'Project queued for the next monthly boundary.');
  };

  if (!snapshot?.revision) return <div style={{ padding: 14, color: dim }}>{error || 'Loading statecraft…'}</div>;
  if (!statecraft) return <div style={{ padding: 14, color: dim }}>Statecraft modules are disabled in this scenario.</div>;
  return <div data-testid="statecraft-pane" style={{ padding: 12, overflowY: 'auto', fontSize: 12 }}>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 9 }}>Statecraft</div>
    {queued && <div data-testid="statecraft-queued" style={{ ...card, color: '#a5b4fc' }}>{queued}</div>}
    {error && <div style={{ ...card, color: '#f2777a' }}>{error}</div>}

    {finance && <>
      <div style={{ color: dim, marginBottom: 5 }}>Finance</div>
      <div style={card}>
        <div>Treasury {snapshot.polities.find((entry) => entry.id === snapshot.playerPolityId)?.treasury ?? 0} · Debt {finance.debtPrincipal} / {finance.creditLimit}</div>
        <div style={{ color: dim, marginTop: 3 }}>Interest {(finance.annualInterestBp / 100).toFixed(2)}% · Defaults {finance.defaultCount}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 7 }}>
          <input aria-label="Tax burden bp" style={input} type="number" min="5000" max="15000" value={taxBurden} onChange={(event) => setTaxBurden(event.target.value)} />
          <input aria-label="Tax exemption bp" style={input} type="number" min="0" max="5000" value={exemption} onChange={(event) => setExemption(event.target.value)} />
        </div>
        <select aria-label="Budget stance" style={{ ...input, marginTop: 5 }} value={budgetStance} onChange={(event) => setBudgetStance(event.target.value)}>
          <option value="balanced">Balanced budget</option>
          <option value="industry">Industrial investment</option>
          <option value="science">Science investment</option>
          <option value="security">Security and military</option>
        </select>
        <div style={{ color: dim, marginTop: 4 }}>{Object.entries(budgetStances[budgetStance]).map(([name, value]) => `${name} ${value / 100}%`).join(' · ')}</div>
        <button data-testid="queue-finance-policy" style={{ ...button, marginTop: 6 }} onClick={queuePolicy}>Queue finance policy</button>
        <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
          <input aria-label="Bond amount" style={input} type="number" min="1" value={bondAmount} onChange={(event) => setBondAmount(event.target.value)} />
          <button data-testid="queue-bonds" style={button} onClick={queueBonds}>Issue bonds</button>
          {finance.debtPrincipal > 0 && <button style={button} onClick={() => queue({ kind: 'finance.restructure', ...base() }, 'Debt restructuring queued.')}>Restructure</button>}
        </div>
      </div>
    </>}

    <div style={{ color: dim, margin: '12px 0 5px' }}>Capacity & projects</div>
    <div style={card}>Administration {statecraft.capacities?.administration ?? 0} · Science {statecraft.capacities?.science ?? 0} · Industry {statecraft.capacities?.industry ?? 0}</div>
    {activeProjects.length === 0 && <div style={{ color: dim, marginBottom: 7 }}>No active projects</div>}
    {activeProjects.map((project) => {
      const template = statecraft.templates.find((entry) => entry.templateId === project.templateId);
      return <div key={project.projectId} style={card}>
        <strong>{template?.displayName?.en ?? project.templateId}</strong>
        <div style={{ color: dim, margin: '3px 0' }}>{project.progressCost}/{project.effectiveTotalCost} · month {project.progressMonths}/{template?.durationMonths}</div>
        <button style={{ ...button, marginRight: 5 }} onClick={() => queue({
          kind: 'project.update', ...base(), projectId: project.projectId,
          monthlyFunding: project.monthlyFunding + 100, priority: Math.min(5, project.priority + 1),
        }, 'Higher project funding and priority queued.')}>Prioritise</button>
        <button style={button} onClick={() => queue({ kind: 'project.cancel', ...base(), projectId: project.projectId }, 'Project cancellation queued.')}>Cancel</button>
      </div>;
    })}
    <select aria-label="Project template" style={input} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
      {(statecraft.templates ?? []).map((entry) => <option key={entry.templateId} value={entry.templateId}>{entry.displayName.en}</option>)}
    </select>
    {selectedTemplate?.effect?.kind === 'infrastructure' && <select aria-label="Project region" style={{ ...input, marginTop: 5 }} value={targetRegionId} onChange={(event) => setTargetRegionId(event.target.value)}>
      {snapshot.regions.filter((entry) => entry.controllerId === snapshot.playerPolityId).map((entry) => <option key={entry.regionId} value={entry.regionId}>{entry.displayName.en}</option>)}
    </select>}
    {selectedTemplate?.effect?.kind === 'reveal-intelligence' && <select aria-label="Intelligence target" style={{ ...input, marginTop: 5 }} value={targetPolityId} onChange={(event) => setTargetPolityId(event.target.value)}>
      {snapshot.polities.filter((entry) => entry.id !== snapshot.playerPolityId).map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName.en}</option>)}
    </select>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 5 }}>
      <input aria-label="Monthly project funding" style={input} type="number" min="1" value={funding} onChange={(event) => setFunding(event.target.value)} />
      <input aria-label="Project priority" style={input} type="number" min="1" max="5" value={priority} onChange={(event) => setPriority(event.target.value)} />
    </div>
    <button data-testid="queue-project" style={{ ...button, width: '100%', marginTop: 6 }} disabled={!templateId} onClick={queueProject}>Queue project</button>

    <div style={{ color: dim, margin: '12px 0 5px' }}>Known facts</div>
    {(statecraft.knownFacts ?? []).map((fact) => <div key={fact.factId} style={card}>
      <strong>{fact.summary?.en ?? fact.factId}</strong>
      <div style={{ color: dim, marginTop: 3 }}>{fact.domain} · {fact.confidence} confidence · {monthsBetween(fact.observedMonth, snapshot.month) >= fact.staleAfterMonths ? 'stale' : 'current'} · {fact.evidenceId}</div>
    </div>)}
  </div>;
};

export default StatecraftPane;
