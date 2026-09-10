// node worker.test.mjs
// 카카오와 KV 를 흉내 낸 stub 으로 워커의 분기만 확인한다. 실제 로그인은 배포 후 눈으로 본다.
import assert from 'node:assert';
import worker from './worker.js';

const KV = () => {
  const m = new Map(), meta = new Map();
  return {
    m, meta,
    get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v, o) => { m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); },
    delete: async k => { m.delete(k); meta.delete(k); },
    list: async (o) => ({
      keys: [...m.keys()].filter(n => !o?.prefix || n.startsWith(o.prefix))
        .map(name => ({ name, metadata: meta.get(name) })),
    }),
  };
};

const ME = { id: 7, properties: { nickname: '노에', thumbnail_image: 'https://img/t.jpg' } };
const kakao = u => (u.includes('/oauth/token') ? { access_token: 'T' } : ME);

const go = (path, env, fake = kakao) => {
  globalThis.fetch = async u => ({ json: async () => fake(String(u)) });
  return worker.fetch(new Request('https://auth.test' + path), env);
};
const env = () => ({ KAKAO_REST_KEY: 'KEY', ENTRY_CODE: '9876', SITE: 'https://x.test/g/',
  SESSION_KEY: 'test-key', LOGINS: KV() });
const loc = r => r.headers.get('location');

let e = env();
let r = await go('/login', e);
assert.match(loc(r), /^https:\/\/kauth\.kakao\.com\/oauth\/authorize\?/);
assert.match(loc(r), /client_id=KEY/);
assert.match(loc(r), /redirect_uri=https%3A%2F%2Fauth\.test%2Fcb/);

// 인가코드를 들고 오면 입장코드와 프로필을 프래그먼트에 달아 돌려보낸다.
r = await go('/cb?code=abc', e);
assert.ok(loc(r).startsWith('https://x.test/g/#c=9876&n=%EB%85%B8%EC%97%90&p=https%3A%2F%2Fimg%2Ft.jpg&t='), loc(r));

// 접속 기록이 남는다. 두 번째 로그인은 첫 접속을 지키고 횟수만 올린다.
let rec = JSON.parse(e.LOGINS.m.get('7'));
assert.equal(rec.c, 1);
assert.equal(rec.n, '노에');
await go('/cb?code=abc', e);
const rec2 = JSON.parse(e.LOGINS.m.get('7'));
assert.equal(rec2.c, 2);
assert.equal(rec2.f, rec.f);
assert.ok(rec2.l >= rec.l);

// 토큰 교환이 깨지면 입장코드는 나가지 않는다.
r = await go('/cb?code=abc', e, () => ({ error: 'invalid_grant' }));
assert.equal(loc(r), 'https://x.test/g/#e=token.invalid_grant');

// 운영자는 링크 표시용 플래그를 같이 받는다.
{
  const ea = { ...e, ADMIN_IDS: '7' };
  const ra = await go('/cb?code=abc', ea);
  assert.ok(loc(ra).endsWith('&a=1'), loc(ra));
  assert.ok(!loc(await go('/cb?code=abc', { ...e, ADMIN_IDS: '99' })).includes('&a=1'));
}

// 사용자가 취소하면 code 없이 돌아온다.
assert.equal(loc(await go('/cb', e)), 'https://x.test/g/#e=cancel');

// /admin 은 같은 로그인을 거치되 state 로 표시하고, 허용 목록에 없으면 막는다.
assert.match(loc(await go('/admin', e)), /state=admin/);
r = await go('/cb?code=abc&state=admin', e);
assert.equal(r.status, 403);
assert.match(await r.text(), /7/);   // 자기 id 를 알려줘 목록에 넣게 한다

// 허용 목록에 있으면 기록이 보인다.
e.ADMIN_IDS = ' 7 ,99';
r = await go('/cb?code=abc&state=admin', e);
assert.equal(r.status, 200);
const html = await r.text();
assert.match(html, /노에/);
assert.match(html, /접속 기록/);

assert.equal((await go('/', e)).status, 404);

// ---- 조 투표 ----
const tokenOf = u => new URL(u.replace('#', '?')).searchParams.get('t');
const token = tokenOf(loc(await go('/cb?code=abc', e)));

const call = (path, opts = {}) => {
  globalThis.fetch = async u => ({ json: async () => kakao(String(u)) });
  return worker.fetch(new Request('https://auth.test' + path, {
    ...opts, headers: { authorization: 'Bearer ' + (opts.token ?? token), 'content-type': 'application/json' },
  }), e);
};

// 토큰이 없거나 위조면 막힌다.
assert.equal((await call('/votes?w=12', { token: '' })).status, 401);
assert.equal((await call('/votes?w=12', { token: token.split('.')[0] + '.wrong' })).status, 401);

// 투표하면 저장되고, 같은 사람이 다시 하면 덮어쓴다.
let v = await (await call('/vote', { method: 'POST', body: JSON.stringify({ w: 12, d: 'thu', g: '3조' }) })).json();
assert.deepEqual(v.votes.thu.map(x => [x.i, x.g, x.n]), [['7', '3조', '노에']]);
v = await (await call('/vote', { method: 'POST', body: JSON.stringify({ w: 12, d: 'thu', g: '4조' }) })).json();
assert.equal(v.votes.thu.length, 1);
assert.equal(v.votes.thu[0].g, '4조');

// 목/일은 따로 센다.
await call('/vote', { method: 'POST', body: JSON.stringify({ w: 12, d: 'sun', g: '개인조깅' }) });
v = await (await call('/votes?w=12')).json();
assert.equal(v.votes.thu[0].g, '4조');
assert.equal(v.votes.sun[0].g, '개인조깅');
assert.equal(v.me, '7');

// 조를 비우면 취소된다.
v = await (await call('/vote', { method: 'POST', body: JSON.stringify({ w: 12, d: 'thu', g: null }) })).json();
assert.equal(v.votes.thu.length, 0);

// 주차가 다르면 섞이지 않는다.
v = await (await call('/votes?w=13')).json();
assert.equal(v.votes.sun.length, 0);

// 접속 기록 화면이 투표 키를 사람으로 세지 않는다.
e.ADMIN_IDS = '7';
const ah = await (await go('/cb?code=abc&state=admin', e)).text();
assert.match(ah, /1명/);

console.log('worker.test.mjs 통과');
