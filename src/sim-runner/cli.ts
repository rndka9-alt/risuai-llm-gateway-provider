import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runStandaloneSimulation } from './sim-runner';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readInput(inputPath: string): Promise<unknown> {
  const absoluteInputPath = resolve(inputPath);
  const source = await readFile(absoluteInputPath, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${absoluteInputPath}: ${describeError(error)}`, {
      cause: error,
    });
  }
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length !== 1) {
    throw new Error('Usage: cache-sim <input.json>');
  }
  const report = await runStandaloneSimulation(await readInput(argumentsList[0]));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`cache-sim: ${describeError(error)}\n`);
  process.exitCode = 1;
});
