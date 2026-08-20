import { readFile } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { chromium, firefox, webkit } from '@playwright/test';

const strictWebKit = process.argv.includes('--require-webkit');
const results = [];

async function detectDistribution() {
  if (process.platform !== 'linux') return process.platform;
  try {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    return osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? 'unknown Linux';
  } catch {
    return 'unknown Linux';
  }
}

async function probe(name, browserType, required) {
  try {
    const browser = await browserType.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<title>playtest-preflight</title>');
    const title = await page.title();
    await browser.close();
    if (title !== 'playtest-preflight') throw new Error('page smoke check failed');
    results.push({ name, status: 'PASS', required });
  } catch (error) {
    results.push({
      name,
      status: required ? 'FAIL' : 'CI_REQUIRED',
      required,
      detail: error instanceof Error ? error.message.split('\n')[0] : String(error)
    });
  }
}

const distribution = await detectDistribution();
const nodeMajor = Number(process.versions.node.split('.')[0]);
const supportedNode = [22, 24, 26].includes(nodeMajor);

await probe('chromium', chromium, true);
await probe('firefox', firefox, true);
await probe('webkit', webkit, strictWebKit);

console.log(JSON.stringify({
  distribution,
  node: process.versions.node,
  nodeStatus: supportedNode ? 'PASS' : 'FAIL',
  strictWebKit,
  browsers: results,
  requiredHumanCheck: 'Confirm the latest WebKit E2E GitHub Actions run is green before human playtesting.'
}, null, 2));

if (!supportedNode || results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
