# G-LAB

Training schedule for a running crew. Static page on GitHub Pages, auth worker on Cloudflare.

## Weekly

Edit `weeks` in `plan.json`, then:

```bash
node check.mjs
node build.mjs
```

Commit and push. Pages deploys.

## How it works

`plan.json` is never committed. `build.mjs` encrypts it into `plan.enc` (AES-GCM 256 / PBKDF2-SHA256 300k)
with the key in `.code`, also never committed. The page decrypts in the browser.

Kakao login gates the key. The worker holds it and hands it out only after a verified login,
so nobody types it. Keep it long and random.

```
browser → worker /login → Kakao → worker /cb → page #c=<key>
```

Any Kakao account passes. The worker also signs a session token at that point,
which the page sends back when voting. Without it the page could claim any name.

## Group vote

One pick per person per session, Thursday and Sunday separately. Tap the same group again to cancel.
Stored per person in KV as `v:<week>:<thu|sun>:<kakao id>`, payload in metadata so one `list` reads them all.

## Setup

1. Create a Kakao app. Enable Kakao Login, register `https://<worker>/cb` as a Redirect URI.
2. Deploy the worker and set its secrets.

```bash
npx wrangler deploy
npx wrangler secret put KAKAO_REST_KEY
npx wrangler secret put KAKAO_CLIENT_SECRET   # skip if disabled
npx wrangler secret put ENTRY_CODE            # same value as .code
npx wrangler secret put SESSION_KEY           # 32 random bytes
npx wrangler secret put ADMIN_IDS             # kakao ids, comma separated
```

3. Put the worker URL in `AUTH` in `index.html`. Empty falls back to the entry code field.

Rotating the key means three places at once: `.code`, `node build.mjs`, `wrangler secret put ENTRY_CODE`.

```bash
node worker.test.mjs
```

## Files

| | |
|---|---|
| `plan.json` | source of truth. not committed |
| `plan.enc` | encrypted `plan.json`. the only data on the web |
| `.code` | encryption key. not committed |
| `glab.html` | offline single file. plaintext, not committed |
| `calc.js` | group table engine |
| `crypt.mjs` | encrypt / decrypt |
| `index.html` | the page |
| `build.mjs` | builds `plan.enc`, `glab.html`, `og.png`, favicons |
| `check.mjs` | verifies the engine against reference data |
| `export.mjs` | text dump for review |
| `worker.js` | Cloudflare worker: login, session token, votes, admin |
| `worker.test.mjs` | worker tests |
| `wrangler.toml` | worker config |
| `og.html` `og.png` | share card |
| `gate.mp4` `gate.jpg` | login screen background |
| `icon-src.png` | favicon source |
| `design.html` `DESIGN.md` | design reference |

## Group tables

One base lap time (400m, seconds) per group. Everything else is an offset.

```
R -5    I  0    T +5    M +8    float +10    E +22
```

`check.mjs` locks these against the reference data, so a wrong base fails before build.
2000+400 and 3000+600 are not computed. They ship as-is.

## Notes

- Numbers are 400m lap times. An 800m rep is two of them.
- Weeks 1-10 are estimates, marked `draft: true`.
- Group cutoffs (10km) differ between the summer and winter reference sets.
