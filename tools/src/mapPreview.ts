import { generateMap, validateMap } from '@squirrel-heist/shared';

const seed = process.argv[2] ?? 'preview-seed';
const result = generateMap(seed);
const validation = validateMap(result.map);
console.log(JSON.stringify({ requestedSeed: seed, actualSeed: result.map.seed, hash: result.map.hash, attempts: result.attempts, usedFallback: result.usedFallback, validation, map: result.map }, null, 2));
