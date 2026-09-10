// node build.mjs
// index.html + calc.js + plan.json 을 glab.html 한 파일로 합친다.
// 서버 없이 열리므로 카톡으로 보내거나 폰에서 바로 볼 수 있다.
// logo.png 가 있으면 data URI 로 심어서 단일 파일에서도 로고가 뜬다.
// 크롬이 있으면 og.html 로 카톡 공유 카드(og.png)도 다시 뽑는다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { seal, open as unseal } from './crypt.mjs';

// 입장코드는 .code 파일에 둔다. git 에 올라가지 않는다.
// 바꾸려면  printf '새코드' > .code  후 다시 빌드한다.
if (!existsSync('.code')) {
  console.error("빌드 실패: .code 가 없다.  printf '입장코드' > .code  먼저 실행할 것");
  process.exit(1);
}
const CODE = readFileSync('.code', 'utf8').trim();
if (CODE.length < 4) { console.error('빌드 실패: 입장코드가 너무 짧다'); process.exit(1); }

// plan.enc 를 되돌려 plan.json 을 복구한다.  node build.mjs --decrypt
if (process.argv.includes('--decrypt')) {
  const back = await unseal(readFileSync('plan.enc', 'utf8').trim(), CODE);
  writeFileSync('plan.json', back + '\n');
  console.log('plan.json 복구됨');
  process.exit(0);
}

const engine = readFileSync('calc.js', 'utf8').replaceAll('export ', '');
const plan = readFileSync('plan.json', 'utf8').trim();

let out = readFileSync('index.html', 'utf8').replace(
  /<script type="module">[\s\S]*?<\/script>/,
  m => '<script>\n' + engine + '\n' +
    m.replace(/^<script type="module">|<\/script>$/g, '')
     .replace(/^.*await import\(.*calc\.js.*$/m, '')
     .replace('const ENC = null, RAW = null;', 'const ENC = null, RAW = ' + plan + ';')
     .replace('const plan = await unlock();', 'const plan = RAW;')
    + '\n</script>');

// 인라인된 스크립트가 문법적으로 성립하는지 확인한다.
// 모듈일 땐 스코프가 갈려서 안 보이던 이름 충돌이 여기서 잡힌다.
const code = out.match(/<script>([\s\S]*?)<\/script>/)[1];
try { new Function(code); } catch (e) { console.error('빌드 실패:', e.message); process.exit(1); }

// id 중복 검사. 중복되면 getElementById 가 엉뚱한 요소를 집는다.
const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dup.length) { console.error('빌드 실패: id 중복', [...new Set(dup)]); process.exit(1); }

writeFileSync('glab.html', out);
console.log('glab.html', (out.length / 1024).toFixed(1) + 'KB  (평문. git 에 올리지 않는다)');

// 웹에 올라가는 건 암호문뿐이다. 저장소가 public 이어도 훈련 내용은 안 보인다.
const enc = await seal(plan, CODE);
writeFileSync('plan.enc', enc + '\n');
if (JSON.stringify(JSON.parse(await unseal(enc, CODE))) !== JSON.stringify(JSON.parse(plan))) {
  console.error('빌드 실패: 복호화 검증 실패'); process.exit(1);
}
console.log('plan.enc', (enc.length / 1024).toFixed(1) + 'KB  (AES-GCM / PBKDF2 300k)');

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(chrome)) {
  try {
    execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars',
      '--screenshot=og.png', '--window-size=1200,630', `file://${process.cwd()}/og.html`],
      { stdio: 'ignore' });
    console.log('og.png 갱신됨 (1200x630)');
  } catch { console.log('og.png 갱신 실패. 기존 파일을 유지한다.'); }
} else {
  console.log('크롬 없음. og.png 는 기존 파일을 유지한다.');
}

// 파비콘. icon-src.png(로고 원본)에서 필요한 크기만 뽑는다.
if (existsSync('icon-src.png')) {
  for (const size of [512, 180, 32]) {
    execFileSync('sips', ['-z', String(size), String(size), 'icon-src.png',
      '--out', `icon-${size}.png`], { stdio: 'ignore' });
  }
  console.log('파비콘 갱신됨 (512/180/32)');
} else {
  console.log('icon-src.png 없음. 파비콘은 기존 파일을 유지한다.');
}
