# G-LAB

Static training schedule on GitHub Pages. Auth and votes on a Cloudflare worker.

## Weekly

```bash
node check.mjs
node build.mjs
```

Edit `weeks` in `plan.json` first. Commit and push.

## Setup

Kakao app: enable login, register `https://<worker>/cb` as Redirect URI.

```bash
npx wrangler deploy
npx wrangler secret put KAKAO_REST_KEY
npx wrangler secret put KAKAO_CLIENT_SECRET   # skip if disabled
npx wrangler secret put ENTRY_CODE            # same as .code
npx wrangler secret put SESSION_KEY           # 32 random bytes
npx wrangler secret put ADMIN_IDS             # comma separated
```

Put the worker URL in `AUTH` in `index.html`.
Rotating `ENTRY_CODE` means `.code`, `node build.mjs` and `wrangler secret put` together.

```bash
node worker.test.mjs
```

## Files

| | |
|---|---|
| `plan.json` `.code` `glab.html` | not committed |
| `plan.enc` | encrypted `plan.json` |
| `index.html` `calc.js` | page and group table engine |
| `build.mjs` `check.mjs` `crypt.mjs` `export.mjs` | build and verify |
| `worker.js` `worker.test.mjs` `wrangler.toml` | worker |
| `og.*` `gate.*` `icon-src.png` | assets |
| `design.html` `DESIGN.md` | design reference |
