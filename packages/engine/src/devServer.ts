/**
 * Local playtest server for the economy slice (canon 00, phase P1).
 *
 *   node dist/devServer.js [--scenario <file>] [--port 5173]
 *
 * Holds one campaign in memory, exposes it as JSON and serves the dashboard.
 * Zero model calls, no network egress, no wall clock — the tick stays pure and
 * this file only wraps it. Not part of the shipping game.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { parseTurnCommands } from './commands.js';
import type { TurnCommandsFile } from './commands.js';
import { parseScenario } from './scenario.js';
import type { EconScenario } from './scenario.js';
import { initState } from './state.js';
import type { EconWorldState } from './state.js';
import { runTurn } from './pipeline.js';
import type { CompletedTurn } from './pipeline.js';

/**
 * Walk up to the package root so both build layouts work:
 * dist/devServer.js and dist-test/src/devServer.js.
 */
function findPackageRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot locate package root from ${start}`);
}

const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SCENARIO = join(PACKAGE_ROOT, 'fixtures', 'scenario-dev-2x5', 'scenario.json');

export interface Session {
  scenarioRaw: unknown;
  scenario: EconScenario;
  initial: EconWorldState;
  state: EconWorldState;
  turns: CompletedTurn[];
}

export function createSession(scenarioRaw: unknown): Session {
  const scenario = parseScenario(scenarioRaw);
  const initial = initState(scenario);
  return { scenarioRaw, scenario, initial, state: initial, turns: [] };
}

export function snapshot(session: Session): unknown {
  const last = session.turns.at(-1);
  return {
    scenario: {
      scenarioId: session.scenario.scenarioId,
      displayName: session.scenario.displayName,
      label: session.scenario.label,
    },
    turn: session.state.turn,
    month: session.state.month,
    revision: session.state.revision,
    activeResources: session.state.activeResources,
    economy: session.state.economy,
    polities: session.state.polities,
    regions: session.state.regions,
    lastTurn: last
      ? {
          month: last.result.ledger.month,
          ledger: last.result.ledger,
          events: last.result.events,
          rejections: last.result.rejections,
          report: last.report,
          invariantsChecked: last.result.invariantsChecked,
        }
      : null,
    history: session.turns.map((entry) => ({
      turn: entry.result.state.turn,
      month: entry.result.ledger.month,
      revision: entry.result.state.revision,
      rejected: entry.result.rejections.length,
    })),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface ServerOptions {
  scenarioRaw: unknown;
  /** 0 lets the OS pick a free port (used by tests). */
  port: number;
}

/** Start the playtest server; the caller owns its lifetime. */
export function startServer(options: ServerOptions): Server {
  let session = createSession(options.scenarioRaw);

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = req.url ?? '/';
        if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
          const html = readFileSync(join(PACKAGE_ROOT, 'web', 'index.html'), 'utf8');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (req.method === 'GET' && url === '/api/state') {
          sendJson(res, 200, snapshot(session));
          return;
        }
        if (req.method === 'POST' && url === '/api/turn') {
          const body = (await readBody(req)) as { commands?: unknown };
          let commands: TurnCommandsFile;
          try {
            commands = parseTurnCommands({ commands: body.commands ?? [] });
          } catch (error) {
            sendJson(res, 400, {
              error: 'invalid commands',
              detail: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          const completed = runTurn(session.state, commands);
          session.turns.push(completed);
          session.state = completed.result.state;
          sendJson(res, 200, snapshot(session));
          return;
        }
        if (req.method === 'POST' && url === '/api/reset') {
          session = createSession(session.scenarioRaw);
          sendJson(res, 200, snapshot(session));
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (error) {
        sendJson(res, 500, {
          error: 'server error',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  server.listen(options.port);
  return server;
}

function main(): void {
  const args = process.argv.slice(2);
  const argValue = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const scenarioPath = argValue('scenario') ?? DEFAULT_SCENARIO;
  const port = Number(argValue('port') ?? 5174);
  const server = startServer({
    scenarioRaw: JSON.parse(readFileSync(scenarioPath, 'utf8')),
    port,
  });
  server.on('listening', () => {
    process.stdout.write(`Open Historia economy playtest: http://localhost:${port}\n`);
    process.stdout.write(`scenario: ${scenarioPath}\n`);
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) main();
