// 카카오 로그인 확인과 조 투표를 맡는 워커. Cloudflare Workers 에 올린다.
//
//   GET  /login   카카오 인가 화면으로 보낸다.
//   GET  /cb      인가코드를 토큰으로 바꾸고, 확인되면 사이트로 돌려보낸다.
//                 이때 입장코드와 함께 서명한 세션 토큰을 같이 넘긴다.
//   GET  /votes   주차별 조 투표 현황. 세션 토큰이 있어야 한다.
//   POST /vote    내 조 투표. 누구인지는 토큰의 서명으로 안다.
//   GET  /feedback      내 후기와 그날 투표한 조.   POST /feedback  후기 저장
//   GET  /feedback/all  한 훈련의 전체 후기. 운영자만.
//   GET  /admin   허용된 카카오 id 에게만 접속 기록을 보여준다.
//
// 왜 토큰이 필요한가.
// 로그인은 본인만 한다. 하지만 로그인이 끝나면 브라우저는 정적 페이지로 돌아가고,
// 거기 남는 건 닉네임 문자열뿐이다. 그 페이지가 "내가 남기석이다" 라고 말해도
// 워커는 확인할 방법이 없다. 그래서 로그인을 확인한 그 자리에서 서명을 하나 채워 보낸다.
//
// 시크릿 : KAKAO_REST_KEY, KAKAO_CLIENT_SECRET(안 켰으면 생략), ENTRY_CODE, ADMIN_IDS, SESSION_KEY
// 변수   : SITE (돌아갈 페이지 주소)
// 저장소 : LOGINS (KV), DB (D1, schema.sql)
//   접속 기록  <카카오 id>            → { n 닉네임, f 첫 접속, l 마지막 접속, c 횟수 }
//   조 투표    v:<주차>:<thu|sun>:<id> → 값은 비우고 메타데이터에 { n 닉네임, g 조, t 시각 }
//              메타데이터를 쓰면 list 한 번으로 전원 투표를 읽는다. get 을 사람 수만큼 돌지 않는다.

const TTL = 7 * 24 * 60 * 60 * 1000;          // 세션 토큰 수명. 페이지의 입장 세션과 맞춘다.
const DAYS = ['thu', 'sun'];

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// atob 는 바이트 문자열을 준다. UTF-8 로 되돌리지 않으면 한글 닉네임이 깨진다.
const b64dec = s => new TextDecoder().decode(
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)));

const key = env => crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_KEY),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const sign = async (env, data) =>
  b64(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(data)));

// 토큰 = base64(내용).base64(서명). 내용은 감출 게 아니라 위조만 막으면 된다.
async function mint(env, me) {
  const payload = b64(new TextEncoder().encode(JSON.stringify({
    i: String(me.id), n: me.properties?.nickname ?? '', e: Date.now() + TTL,
  })));
  return payload + '.' + await sign(env, payload);
}

async function verify(env, token) {
  const [payload, mac] = String(token ?? '').split('.');
  if (!payload || !mac) return null;
  if (await sign(env, payload) !== mac) return null;      // 서명이 다르면 위조다
  try {
    const v = JSON.parse(b64dec(payload));
    return Date.now() > v.e ? null : v;
  } catch (e) { return null; }
}

// 페이지가 직접 부르는 엔드포인트라 origin 을 밝혀준다.
// 토큰은 localStorage 에 있어 다른 사이트가 읽지 못한다. 이 목록은 형식에 가깝다.
const cors = (env, req) => {
  const o = req.headers.get('origin') ?? '';
  const ok = o && (env.SITE.startsWith(o) || o.startsWith('http://localhost:'));
  return ok ? {
    'access-control-allow-origin': o,
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'vary': 'origin',
  } : {};
};

const json = (env, req, data, status = 200) => new Response(JSON.stringify(data),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(env, req) } });

const back = (env, frag) => Response.redirect(env.SITE + '#' + frag, 302);
const admins = env => (env.ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const authorize = (env, redirect_uri, state) =>
  // ponytail: state 를 위조 방지용이 아니라 돌아갈 곳 표시로만 쓴다. 통과해도 상대가 얻는 건
  // 자기가 직접 로그인해도 받았을 것뿐이고, /admin 은 카카오 id 로 다시 막는다.
  Response.redirect('https://kauth.kakao.com/oauth/authorize?' +
    new URLSearchParams({ client_id: env.KAKAO_REST_KEY, redirect_uri, response_type: 'code', state }), 302);

const page = (body, status = 200) => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + body,
  { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const kst = iso => iso
  ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)
  : '';

// 접속 기록. 첫 접속은 남기고 마지막 접속과 횟수만 갱신한다.
async function note(env, me) {
  if (!env.LOGINS || !me.id) return;
  const k = String(me.id), now = new Date().toISOString();
  const prev = (await env.LOGINS.get(k, 'json')) ?? {};
  await env.LOGINS.put(k, JSON.stringify({
    n: me.properties?.nickname ?? prev.n ?? '',
    f: prev.f ?? now,
    l: now,
    c: (prev.c ?? 0) + 1,
  }));
}

// 한 주차의 목/일 투표를 통째로 읽는다. list 두 번이면 끝난다.
async function readVotes(env, week) {
  const out = {};
  for (const d of DAYS) {
    const { keys } = await env.LOGINS.list({ prefix: `v:${week}:${d}:` });
    out[d] = keys.map(k => ({ i: k.name.split(':')[3], ...(k.metadata ?? {}) }));
  }
  return out;
}

// ---- 훈련 후기 ----
// 본인과 운영진만 본다. 통증이나 부상 얘기가 섞이니 공개 범위를 좁게 둔다.
const COND = ['상', '중', '하'], DONE = ['완주', '일부', '중단'], LANE = ['안쪽', '외곽'];

async function feedback(env, req, url, who) {
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const w = Number(b.w), d = b.d;
    if (!w || !DAYS.includes(d) || !COND.includes(b.cond) || !DONE.includes(b.done)) {
      return json(env, req, { error: 'bad' }, 400);
    }
    const row = {
      week: w, day: d, uid: who.i, name: who.n,
      grp: String(b.grp ?? '').slice(0, 20),
      lane: LANE.includes(b.lane) ? b.lane : '',
      cond: b.cond, done: b.done,
      body: String(b.body ?? '').slice(0, 1000),
      at: new Date().toISOString(),
    };
    await env.DB.prepare(`INSERT INTO feedback (week, day, uid, name, grp, lane, cond, done, body, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (week, day, uid) DO UPDATE SET name = excluded.name, grp = excluded.grp,
        lane = excluded.lane, cond = excluded.cond, done = excluded.done, body = excluded.body, at = excluded.at`)
      .bind(row.week, row.day, row.uid, row.name, row.grp, row.lane, row.cond, row.done, row.body, row.at).run();
    return json(env, req, { ok: true, mine: row });
  }

  const w = Number(url.searchParams.get('w')), d = url.searchParams.get('d');
  if (!w || !DAYS.includes(d)) return json(env, req, { error: 'bad' }, 400);

  if (url.pathname === '/feedback/all') {
    if (!admins(env).includes(who.i)) return json(env, req, { error: 'admin' }, 403);
    const { results } = await env.DB.prepare('SELECT * FROM feedback WHERE week = ? AND day = ? ORDER BY at')
      .bind(w, d).all();
    const { keys } = await env.LOGINS.list({ prefix: `v:${w}:${d}:` });
    return json(env, req, { rows: results, votes: keys.length });
  }

  // 내 후기와, 그날 투표한 조. 조는 후기 폼에 미리 채운다.
  const mine = await env.DB.prepare('SELECT * FROM feedback WHERE week = ? AND day = ? AND uid = ?')
    .bind(w, d, who.i).first();
  const v = await env.LOGINS.getWithMetadata(`v:${w}:${d}:${who.i}`);
  return json(env, req, { mine: mine ?? null, grp: v?.metadata?.g ?? '' });
}

async function admin(env, me) {
  if (!admins(env).includes(String(me.id))) {
    // 처음 여는 사람은 여기서 자기 id 를 확인해 ADMIN_IDS 에 넣는다.
    return page(`<p style="font:15px/1.6 system-ui;padding:24px">권한이 없습니다.<br>
      내 카카오 id : <b>${esc(me.id)}</b></p>`, 403);
  }
  // ponytail: 사람 수만큼 list + get 을 돈다. 크루 규모면 충분하다. 수백 명이 되면 D1.
  const { keys } = await env.LOGINS.list();
  const rows = await Promise.all(keys.filter(k => !k.name.startsWith('v:')).map(async k =>
    ({ id: k.name, ...((await env.LOGINS.get(k.name, 'json')) ?? {}) })));
  rows.sort((a, b) => String(b.l ?? '').localeCompare(String(a.l ?? '')));

  return page(`<title>G-LAB 접속 기록</title>
<style>
  body{margin:0;padding:28px 20px;background:#fff;color:#000;
    font:14px/1.5 "Pretendard Variable",Pretendard,system-ui,sans-serif;font-feature-settings:"tnum" 1}
  h1{font-size:22px;letter-spacing:-.02em;margin:0 0 4px}
  p.sum{margin:0 0 22px;font-size:12px;color:#767676}
  table{width:100%;border-collapse:collapse}
  th{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#767676;
    text-align:left;padding:0 10px 8px 0;border-bottom:2px solid #000}
  td{padding:10px 10px 10px 0;border-bottom:1px solid #dcdcdc;font-size:13.5px}
  td.n{font-weight:700}
  td.num{text-align:right;padding-right:0}
</style>
<h1>접속 기록</h1>
<p class="sum">${rows.length}명 / 최근 접속 순 / 시각은 한국 시간</p>
<table><thead><tr><th>닉네임</th><th>카카오 id</th><th>첫 접속</th><th>마지막 접속</th><th class="num" style="text-align:right">횟수</th></tr></thead>
<tbody>${rows.map(r => `<tr><td class="n">${esc(r.n) || '-'}</td><td>${esc(r.id)}</td>
  <td>${kst(r.f)}</td><td>${kst(r.l)}</td><td class="num">${esc(r.c ?? 0)}</td></tr>`).join('')}</tbody></table>`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // 리다이렉트 주소는 워커 자기 자신이다. 카카오 앱에도 이 주소를 등록한다.
    const redirect_uri = url.origin + '/cb';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });

    if (url.pathname === '/login') return authorize(env, redirect_uri, '');
    if (url.pathname === '/admin') return authorize(env, redirect_uri, 'admin');

    // ---- 조 투표 ----
    if (['/votes', '/vote', '/feedback', '/feedback/all'].includes(url.pathname)) {
      const who = await verify(env, (req.headers.get('authorization') ?? '').replace(/^Bearer /, ''));
      if (!who) return json(env, req, { error: 'auth' }, 401);
      if (url.pathname.startsWith('/feedback')) return feedback(env, req, url, who);

      if (url.pathname === '/votes') {
        const week = Number(url.searchParams.get('w'));
        if (!week) return json(env, req, { error: 'week' }, 400);
        return json(env, req, { me: who.i, votes: await readVotes(env, week) });
      }

      const { w, d, g } = await req.json().catch(() => ({}));
      if (!Number(w) || !DAYS.includes(d)) return json(env, req, { error: 'bad' }, 400);
      const k = `v:${Number(w)}:${d}:${who.i}`;
      const mine = g ? { n: who.n, g: String(g).slice(0, 20), t: new Date().toISOString() } : null;
      if (mine) await env.LOGINS.put(k, '', { metadata: mine });
      else await env.LOGINS.delete(k);   // 조를 비우면 투표 취소다

      // KV 는 쓰고 바로 읽으면 이전 값이 나온다. 목록을 그대로 돌려주면 방금 누른 게
      // 없던 일이 되어 화면이 되돌아간다. 그래서 내 칸만 응답에 직접 얹는다.
      const votes = await readVotes(env, Number(w));
      votes[d] = votes[d].filter(v => v.i !== who.i);
      if (mine) votes[d].push({ i: who.i, ...mine });
      return json(env, req, { ok: true, votes });
    }

    if (url.pathname === '/cb') {
      const state = url.searchParams.get('state') ?? '';
      if (!url.searchParams.get('code')) {
        return state === 'admin' ? page('<p>로그인이 취소되었습니다.</p>', 400) : back(env, 'e=cancel');
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.KAKAO_REST_KEY,
        redirect_uri,
        code: url.searchParams.get('code'),
      });
      if (env.KAKAO_CLIENT_SECRET) body.set('client_secret', env.KAKAO_CLIENT_SECRET);

      const tok = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }).then(r => r.json()).catch(() => ({}));
      // 실패하면 카카오가 준 사유를 그대로 페이지까지 들고 간다. 안 보이면 고칠 수가 없다.
      if (!tok.access_token) {
        const why = tok.error ?? 'unknown';
        return state === 'admin' ? page('<p>로그인 실패 : ' + esc(why) + '</p>', 400)
          : back(env, 'e=token.' + encodeURIComponent(why));
      }

      const me = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: 'Bearer ' + tok.access_token },
      }).then(r => r.json()).catch(() => ({}));
      await note(env, me);

      if (state === 'admin') return admin(env, me);

      const p = me.properties ?? {};
      // 운영자면 표시만 넘긴다. 진짜 통과 여부는 /admin 에서 다시 본다.
      const boss = admins(env).includes(String(me.id));
      return back(env, 'c=' + encodeURIComponent(env.ENTRY_CODE) +
        '&n=' + encodeURIComponent(p.nickname ?? '') +
        '&p=' + encodeURIComponent(p.thumbnail_image ?? p.profile_image ?? '') +
        '&t=' + encodeURIComponent(await mint(env, me)) +
        (boss ? '&a=1' : ''));
    }

    return new Response('g-lab auth', { status: 404 });
  },
};
