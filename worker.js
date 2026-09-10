// 카카오 로그인 확인용 워커. Cloudflare Workers 에 올린다.
//
//   GET /login  카카오 인가 화면으로 보낸다.
//   GET /cb     인가코드를 토큰으로 바꾸고, 확인되면 사이트로 #c=입장코드 를 달아 돌려보낸다.
//   GET /admin  같은 로그인을 거쳐, 허용된 카카오 id 에게만 접속 기록을 보여준다.
//
// 입장코드는 워커 시크릿(ENTRY_CODE)에만 있다. 페이지에는 로그인한 사람만 받아간다.
// 받아간 뒤엔 지금까지처럼 브라우저가 plan.enc 를 직접 푼다. 복호화는 손대지 않았다.
//
// 시크릿 : KAKAO_REST_KEY, KAKAO_CLIENT_SECRET(안 켰으면 생략), ENTRY_CODE, ADMIN_IDS
// 변수   : SITE (돌아갈 페이지 주소)
// 저장소 : LOGINS (KV). 카카오 id → { n 닉네임, f 첫 접속, l 마지막 접속, c 횟수 }

const back = (env, frag) => Response.redirect(env.SITE + '#' + frag, 302);

const authorize = (env, redirect_uri, state) =>
  // ponytail: state 를 위조 방지용으로 쓰지 않고 돌아갈 곳 표시로만 쓴다. 통과해도
  // 상대가 얻는 건 자기가 직접 로그인해도 받았을 입장코드뿐이다. /admin 은 id 로 다시 막는다.
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
  const key = String(me.id), now = new Date().toISOString();
  const prev = (await env.LOGINS.get(key, 'json')) ?? {};
  await env.LOGINS.put(key, JSON.stringify({
    n: me.properties?.nickname ?? prev.n ?? '',
    f: prev.f ?? now,
    l: now,
    c: (prev.c ?? 0) + 1,
  }));
}

async function admin(env, me) {
  const ok = (env.ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ok.includes(String(me.id))) {
    // 처음 여는 사람은 여기서 자기 id 를 확인해 ADMIN_IDS 에 넣는다.
    return page(`<p style="font:15px/1.6 system-ui;padding:24px">권한이 없습니다.<br>
      내 카카오 id : <b>${esc(me.id)}</b></p>`, 403);
  }
  // ponytail: 사람 수만큼 list + get 을 돈다. 크루 규모면 충분하다. 수백 명이 되면 D1.
  const { keys } = await env.LOGINS.list();
  const rows = await Promise.all(keys.map(async k =>
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

    if (url.pathname === '/login') return authorize(env, redirect_uri, '');
    if (url.pathname === '/admin') return authorize(env, redirect_uri, 'admin');

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
      const boss = (env.ADMIN_IDS ?? '').split(',').map(x => x.trim()).includes(String(me.id));
      return back(env, 'c=' + encodeURIComponent(env.ENTRY_CODE) +
        '&n=' + encodeURIComponent(p.nickname ?? '') +
        '&p=' + encodeURIComponent(p.thumbnail_image ?? p.profile_image ?? '') +
        (boss ? '&a=1' : ''));
    }

    return new Response('g-lab auth', { status: 404 });
  },
};
