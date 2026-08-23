import { execFileSync, spawnSync } from 'node:child_process';

const projectId = process.env.PUBLIC_PROJECT_ID;
const metricsToken = process.env.METRICS_TOKEN;
const region = process.env.PUBLIC_REGION ?? 'asia-northeast3';
const service = process.env.PUBLIC_SERVICE ?? 'squirrel-heist';
const repository = process.env.PUBLIC_REPOSITORY ?? 'squirrel-heist';
const metricsSecret = process.env.PUBLIC_METRICS_SECRET ?? 'squirrel-metrics-token';
const dryRun = process.argv.includes('--dry-run');

if (!projectId || !metricsToken) {
  console.error('PUBLIC_PROJECT_ID와 METRICS_TOKEN 환경변수가 필요합니다. 자세한 준비 절차는 docs/DEPLOYMENT.md를 확인하세요.');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{4,28}$/.test(projectId)) {
  console.error('PUBLIC_PROJECT_ID 형식이 올바르지 않습니다.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{32,128}$/.test(metricsToken)) {
  console.error('METRICS_TOKEN은 32~128자의 영문·숫자·밑줄·하이픈 문자열이어야 합니다.');
  process.exit(1);
}

const run = (command, args, options = {}) => {
  const printable = [command, ...args.map((arg) => arg.includes('METRICS_TOKEN=') ? arg.replace(/METRICS_TOKEN=[^|,]+/, 'METRICS_TOKEN=[redacted]') : arg)].join(' ');
  console.info(`$ ${printable}`);
  if (dryRun) return '';
  const stdio = 'input' in options ? ['pipe', 'pipe', 'inherit'] : ['inherit', 'pipe', 'inherit'];
  return execFileSync(command, args, { encoding: 'utf8', stdio, ...options }).trim();
};

if (!dryRun && spawnSync('gcloud', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('gcloud CLI가 필요합니다. Google Cloud CLI를 설치하고 로그인하세요.');
  process.exit(1);
}
if (!dryRun && spawnSync('firebase', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('Firebase CLI가 필요합니다. Firebase CLI를 설치하고 로그인하세요.');
  process.exit(1);
}

const imageTag = process.env.PUBLIC_IMAGE_TAG ?? `public-${Date.now()}`;
const image = `${region}-docker.pkg.dev/${projectId}/${repository}/${service}:${imageTag}`;
const origins = `https://${projectId}.web.app,https://${projectId}.firebaseapp.com`;
const environment = `^|^ALLOWED_ORIGINS=${origins}|MAX_PUBLIC_PLAYERS=24|JOIN_ATTEMPTS_PER_MINUTE=6|BOT_FILL_DELAY_MS=15000|TRUST_PROXY=true`;

const repositoryExists = dryRun ? '' : spawnSync('gcloud', ['artifacts', 'repositories', 'describe', repository, `--location=${region}`, `--project=${projectId}`], { stdio: 'ignore' }).status === 0;
if (!repositoryExists) run('gcloud', ['artifacts', 'repositories', 'create', repository, '--repository-format=docker', `--location=${region}`, `--project=${projectId}`]);
const secretExists = dryRun ? '' : spawnSync('gcloud', ['secrets', 'describe', metricsSecret, `--project=${projectId}`], { stdio: 'ignore' }).status === 0;
if (!secretExists) run('gcloud', ['secrets', 'create', metricsSecret, '--replication-policy=automatic', `--project=${projectId}`]);
run('gcloud', ['secrets', 'versions', 'add', metricsSecret, '--data-file=-', `--project=${projectId}`], { input: metricsToken });
const projectNumber = dryRun ? '000000000000' : run('gcloud', ['projects', 'describe', projectId, '--format=value(projectNumber)']);
run('gcloud', ['secrets', 'add-iam-policy-binding', metricsSecret, `--member=serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`, '--role=roles/secretmanager.secretAccessor', `--project=${projectId}`]);
run('gcloud', ['builds', 'submit', '--tag', image, `--project=${projectId}`, '.']);
run('gcloud', [
  'run', 'deploy', service, `--image=${image}`, `--project=${projectId}`, `--region=${region}`,
  '--allow-unauthenticated', '--ingress=all', '--cpu=1', '--memory=512Mi', '--min-instances=1', '--max-instances=1',
  '--concurrency=32', '--timeout=3600', '--port=8080', `--set-env-vars=${environment}`, `--set-secrets=METRICS_TOKEN=${metricsSecret}:latest`
]);

const cloudRunUrl = dryRun ? 'https://example.run.app' : run('gcloud', ['run', 'services', 'describe', service, `--project=${projectId}`, `--region=${region}`, '--format=value(status.url)']);
const websocketUrl = cloudRunUrl.replace(/^https:/, 'wss:');
run('npm', ['run', 'build', '-w', 'client'], { env: { ...process.env, VITE_WS_URL: websocketUrl } });
run('firebase', ['deploy', '--only', 'hosting', `--project=${projectId}`]);

console.info(`공개 테스트 URL: https://${projectId}.web.app`);
console.info(`Cloud Run 상태 확인: ${cloudRunUrl}/health`);
