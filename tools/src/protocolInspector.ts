import { parseClientMessage } from '@squirrel-heist/shared';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const parsed = parseClientMessage(input.trim());
  console.log(parsed ? JSON.stringify({ valid: true, message: parsed }, null, 2) : JSON.stringify({ valid: false }));
  process.exitCode = parsed ? 0 : 1;
});
