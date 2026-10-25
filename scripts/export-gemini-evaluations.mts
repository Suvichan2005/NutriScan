import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { geminiEvaluationPaths, readGeminiEvaluation } from '../src/lib/server/gemini-evaluation-recorder';

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const analysisId = value('--analysis');
const followupId = value('--followup');
const format = value('--format') ?? 'markdown';
const name = value('--name') ?? `analysis-${analysisId ?? 'missing'}${followupId ? `-followup-${followupId}` : ''}`;
const comparisonMode = args.includes('--comparison');
if (!analysisId || !/^[0-9a-f-]{36}$/i.test(analysisId) || (followupId && !/^[0-9a-f-]{36}$/i.test(followupId)) || (comparisonMode && !followupId)) {
  throw new Error('Usage: npm run gemini:evaluations:export -- --analysis <UUID> [--followup <UUID>] [--comparison (requires two runs)] [--format markdown|json] [--name safe-file-name]');
}
if (format !== 'markdown' && format !== 'json') throw new Error('Format must be markdown or json.');
if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new Error('Export name must contain only letters, digits, underscores or hyphens.');

const analyses = await Promise.all([analysisId, ...(followupId ? [followupId] : [])].map(readGeminiEvaluation));
const bundle = { format: 'nutriscan-sanitized-gemini-evaluation', version: 1, exportedAt: new Date().toISOString(), analyses };
const directory = path.join(geminiEvaluationPaths.root, 'exports');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (process.platform === 'win32') {
  const account = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  if (!account) throw new Error('Cannot determine the local Windows account for export ACLs.');
  await execFile('icacls', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true });
} else await chmod(directory, 0o700);

const body = format === 'json'
  ? JSON.stringify(bundle, null, 2) + '\n'
  : [
      '# NutriScan Gemini evaluation export',
      '',
      `Exported: ${bundle.exportedAt}`,
      'Image bytes are omitted; local image references are represented by hashes and sizes. Hidden model reasoning is omitted. Profile content follows the capture mode recorded in each manifest.',
      ...analyses.flatMap((analysis, index) => [
        '',
        `## ${comparisonMode ? `Comparison run ${index === 0 ? 'A' : 'B'}` : index === 0 ? 'Initial analysis' : 'Follow-up'}`,
        '',
        '```json',
        JSON.stringify(analysis.manifest, null, 2),
        '```',
        '',
        ...analysis.events.map(event => `### ${(event as { event?: string }).event ?? 'event'}\n\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``),
      ]),
      '',
    ].join('\n');
const output = path.join(directory, `${name}.${format === 'json' ? 'json' : 'md'}`);
await writeFile(output, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
if (process.platform !== 'win32') await chmod(output, 0o600);
else {
  const account = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  if (account) await execFile('icacls', [output, '/inheritance:r', '/grant:r', `${account}:F`], { windowsHide: true });
}
console.log(output);
