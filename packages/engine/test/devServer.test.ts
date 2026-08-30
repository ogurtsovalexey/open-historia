import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/devServer.js';
import { loadScenarioRaw } from './helpers.js';

/** The dashboard's data contract. The UI reads exactly these fields. */
describe('playtest server API', () => {
  const server = startServer({ scenarioRaw: loadScenarioRaw(), port: 0 });
  after(() => server.close());

  const base = async (): Promise<string> => {
    if (!server.listening) {
      await new Promise((resolveListening) => server.once('listening', resolveListening));
    }
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  const get = async (path: string) => {
    const response = await fetch(`${await base()}${path}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${await base()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('serves the initial state with everything the dashboard needs', async () => {
    const { status, body } = await get('/api/state');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.turn, 0);
    assert.strictEqual(body.month, '1900-01-01');
    assert.strictEqual(body.lastTurn, null);
    assert.strictEqual((body.regions as unknown[]).length, 10);
    assert.strictEqual((body.polities as unknown[]).length, 2);
    assert.ok((body.revision as string).startsWith('sha256:'));
    // The investment preview needs this coefficient client-side.
    assert.ok(typeof (body.economy as { infrastructureBpPerMoney: number }).infrastructureBpPerMoney === 'number');
  });

  it('serves the dashboard page', async () => {
    const response = await fetch(`${await base()}/`);
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Economy Playtest/);
  });

  it('resolves a month with an investment and returns ledger, report and events', async () => {
    const { status, body } = await post('/api/turn', {
      commands: [
        {
          kind: 'economy.invest-region',
          commandId: '6a1f5c1e-0d2b-4d3a-9a51-0000000000aa',
          actorPolityId: 'polity:ostreya',
          targetRegionId: 'region:dev-2x5:A4',
          effectiveMonth: '1900-01-01',
          spend: 1000,
        },
      ],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.turn, 1);
    assert.strictEqual(body.month, '1900-02-01');
    const lastTurn = body.lastTurn as {
      ledger: { polities: Array<{ polityId: string; investment?: { spend: number }; taxTotal: number }> };
      report: string;
      rejections: unknown[];
      invariantsChecked: string[];
    };
    const ostreya = lastTurn.ledger.polities.find((p) => p.polityId === 'polity:ostreya')!;
    assert.strictEqual(ostreya.investment?.spend, 1000);
    assert.strictEqual(ostreya.taxTotal, 17820);
    assert.deepStrictEqual(lastTurn.rejections, []);
    assert.ok(lastTurn.invariantsChecked.length >= 6);
    assert.match(lastTurn.report, /# Turn 1 — 1900-01-01/);
    assert.strictEqual((body.history as unknown[]).length, 1);
  });

  it('reports a rejected command instead of failing the turn', async () => {
    const { status, body } = await post('/api/turn', {
      commands: [
        {
          kind: 'economy.invest-region',
          commandId: '6a1f5c1e-0d2b-4d3a-9a51-0000000000bb',
          actorPolityId: 'polity:vindar',
          targetRegionId: 'region:dev-2x5:A1',
          effectiveMonth: '1900-02-01',
          spend: 500,
        },
      ],
    });
    assert.strictEqual(status, 200);
    const rejections = (body.lastTurn as { rejections: Array<{ reason: string }> }).rejections;
    assert.strictEqual(rejections.length, 1);
    assert.strictEqual(rejections[0].reason, 'foreign-target');
  });

  it('rejects a malformed commands payload with 400 and does not advance', async () => {
    const before = await get('/api/state');
    const { status, body } = await post('/api/turn', { commands: [{ kind: 'nonsense' }] });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'invalid commands');
    const after = await get('/api/state');
    assert.strictEqual(after.body.revision, before.body.revision);
  });

  it('reset returns to the initial revision', async () => {
    const initial = (await get('/api/state')).body;
    assert.ok((initial.turn as number) > 0);
    const { body } = await post('/api/reset', {});
    assert.strictEqual(body.turn, 0);
    assert.strictEqual(body.lastTurn, null);
    assert.strictEqual((body.history as unknown[]).length, 0);
  });
});
