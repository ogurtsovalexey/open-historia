/**
 * Deterministic human-readable turn report: every changed total names its
 * cause from the contribution ledger ("Why changed", first-economy-mvp §8,
 * rendered headlessly as markdown). Byte-stable across runs by construction —
 * built only from state, ledger and events, never from wall clock or locale.
 */
import type { EconWorldState } from './state.js';
import type { TurnLedger } from './ledger.js';
import type { EngineEvent } from './tick.js';
import type { CommandRejection } from './commands.js';

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function renderReport(
  prev: EconWorldState,
  next: EconWorldState,
  ledger: TurnLedger,
  events: EngineEvent[],
  rejections: CommandRejection[]
): string {
  const lines: string[] = [];
  lines.push(`# Turn ${next.turn} — ${ledger.month}`);
  lines.push('');
  lines.push(`Base revision: \`${prev.revision}\``);
  lines.push(`New revision:  \`${next.revision}\``);
  lines.push('');

  if (rejections.length > 0) {
    lines.push('## Rejected commands');
    lines.push('');
    for (const rejection of rejections) {
      lines.push(
        `- \`${rejection.command.commandId}\` (${rejection.command.kind} by ${rejection.command.actorPolityId}): **${rejection.reason}** — ${rejection.detail}. State unchanged.`
      );
    }
    lines.push('');
  }

  for (const polity of ledger.polities) {
    const statePolity = next.polities.find((p) => p.id === polity.polityId)!;
    lines.push(`## ${statePolity.displayName.en} (${polity.polityId})`);
    lines.push('');

    const populationDelta = polity.populationClosing - polity.populationOpening;
    lines.push(`### Population: ${polity.populationClosing} (${signed(populationDelta)})`);
    for (const row of polity.populationByRegion) {
      lines.push(`- ${row.regionId}: ${row.population} (births +${row.births}, deaths -${row.deaths})`);
    }
    lines.push('');

    if (polity.investment) {
      lines.push(
        `### Investment: ${polity.investment.spend} gold into ${polity.investment.regionId} → infrastructure +${polity.investment.infrastructureGainBp} bp (now ${polity.investment.infrastructureBp} bp)`
      );
      lines.push('');
    }

    lines.push(`### Treasury: ${polity.treasuryClosing} gold (${signed(polity.treasuryClosing - polity.treasuryOpening)})`);
    lines.push(`- opening ${polity.treasuryOpening}, tax revenue +${polity.taxTotal}, spending -${polity.investment?.spend ?? 0}`);
    for (const tax of polity.taxByRegion) {
      lines.push(`  - tax from ${tax.regionId} (${tax.resource}): +${tax.amount}`);
    }
    lines.push('');

    lines.push('### Resources');
    lines.push('');
    lines.push('| Resource | Opening | Produced | Used | Closing |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const movement of polity.stockMovements) {
      const used = movement.processingUse + movement.populationUse;
      lines.push(
        `| ${movement.resource} | ${movement.opening} | ${signed(movement.produced)} | ${used > 0 ? `-${used}` : '0'} | ${movement.closing} |`
      );
    }
    lines.push('');
    for (const production of polity.production) {
      const byRegion = production.byRegion.map((row) => `${row.regionId} ${signed(row.amount)}`).join(', ');
      lines.push(`- ${production.resource} production ${signed(production.total)}: ${byRegion}`);
    }
    lines.push('');

    if (polity.goods) {
      const goods = polity.goods;
      lines.push(
        `### Goods (${goods.regionId}): ${goods.actual} of ${goods.potential} potential — limited by ${
          goods.limitedBy === 'inputs' ? goods.limitingInputs.join(' + ') : 'capacity/labour/infrastructure'
        }`
      );
      lines.push(
        `- inputs used: coal ${goods.coalUsed}, iron ${goods.ironUsed}; input supply ${goods.inputSupplyBp} bp`
      );
      lines.push('');
    }

    const food = polity.food;
    if (food.shortfall > 0) {
      lines.push(`### Food: SHORTFALL ${food.shortfall} (need ${food.need}, available ${food.available}, consumed ${food.consumed})`);
    } else {
      lines.push(`### Food: surplus ${food.surplus} (need ${food.need}, consumed ${food.consumed})`);
    }
    lines.push('');
  }

  const alerts = events.filter((event) => event.type === 'alert');
  if (alerts.length > 0) {
    lines.push('## Alerts');
    lines.push('');
    for (const alert of alerts) {
      if (alert.type === 'alert') {
        lines.push(`- [${alert.polityId}] ${alert.alert}: ${alert.detail}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
