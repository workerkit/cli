import { writeFileSync } from 'node:fs';
import { buildProgram } from '../dist/program.js';
import { toolCommandPaths } from '../dist/bind.js';

if (!process.argv[2]) throw Error('Usage: node scripts/capture-help.mjs <output.json> (run build first)');
const program = buildProgram();
const commands = [];
function walk(command, parents = []) {
  const path = [...parents, command.name()];
  let help = '';
  command.configureOutput({ writeOut: text => { help += text; }, writeErr: text => { help += text; } });
  command.outputHelp();
  commands.push({ command: path.join(' '), help });
  for (const child of command.commands) walk(child, path);
}
walk(program);
const toolCommands = toolCommandPaths(program);
writeFileSync(process.argv[2], JSON.stringify({ schemaVersion: 1, provenance: {
  source: 'Actual Commander outputHelp, including after-help hooks; no credentials or API calls',
  baselineLimitation: 'Baseline used helpInformation without after-help hooks, so total sizes are not a behavior comparison.',
}, toolCommands, commands }, null, 2) + '\n');
console.log(JSON.stringify({ tools: Object.keys(toolCommands).length, commands: commands.length, helpChars: commands.reduce((sum, c) => sum + c.help.length, 0) }));
