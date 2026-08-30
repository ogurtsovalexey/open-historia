import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.join(__dirname, '..', 'src');

function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports: string[] = [];

  // Match import statements
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return imports.filter(imp =>
    imp.startsWith('./') || imp.startsWith('../')
  ).map(imp => {
    const sourceImport = imp.replace(/\.js$/, '.ts');
    const fullPath = path.resolve(path.dirname(filePath), sourceImport);
    return path.relative(srcDir, fullPath);
  }).filter(imp => {
    // Only include imports that point to files in our src directory
    return fs.existsSync(path.join(srcDir, imp));
  });
}

function findCycles(graph: Readonly<Record<string, readonly string[]>>): string[][] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, currentPath: string[] = []): void {
    if (recursionStack.has(node)) {
      const cycleStart = currentPath.indexOf(node);
      cycles.push([...currentPath.slice(cycleStart), node]);
      return;
    }

    if (visited.has(node)) return;
    visited.add(node);
    recursionStack.add(node);

    for (const neighbor of graph[node] ?? []) {
      dfs(neighbor, [...currentPath, node]);
    }

    recursionStack.delete(node);
  }

  for (const node of Object.keys(graph)) {
    dfs(node);
  }
  return cycles;
}

function checkForCycles(): void {
  const files = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => path.join(srcDir, f));

  const graph: Record<string, string[]> = {};

  // Build import graph
  for (const file of files) {
    const relativePath = path.relative(srcDir, file);
    graph[relativePath] = extractImports(file);
  }

  const cycles = findCycles(graph);

  if (cycles.length > 0) {
    console.error('Dependency cycles detected in domain package:');
    for (const cycle of cycles) {
      console.error('  ' + cycle.join(' -> '));
    }
    process.exit(1);
  }

  console.log('No dependency cycles detected in domain package.');

  const selfTestCycles = findCycles({
    'a.ts': ['b.ts'],
    'b.ts': ['a.ts']
  });
  if (selfTestCycles.length !== 1) {
    throw new Error('Cycle detector self-test failed');
  }
  console.log('Cycle detector self-test passed.');
}

// Run check
checkForCycles();
