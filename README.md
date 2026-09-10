# G-LAB 훈련표

GSRC 크루 훈련팀 G-LAB(구파발 러닝랩)의 조별 훈련표.

https://studio-noe.github.io/g-lab/

## 매주 할 일

`plan.json`의 `weeks` 배열만 고치면 된다. 그다음 두 줄.

```bash
node check.mjs   # 원본 자료 재현 검증
node build.mjs   # plan.enc, glab.html, og.png 재생성
```

커밋해서 푸시하면 GitHub Pages가 반영한다.

## 입장코드

저장소가 public이라 훈련 내용을 그냥 올리면 누구나 읽는다.
그래서 `plan.json`은 커밋하지 않고, 입장코드로 암호화한 `plan.enc`만 올린다.
페이지는 첫 화면에서 코드를 받아 브라우저에서 복호화한다.
AES-GCM 256 / PBKDF2-SHA256 30만 회.

코드는 `.code` 파일에 둔다. 이 파일도 커밋하지 않는다.

```bash
printf '새코드' > .code   # 코드 바꾸기
node build.mjs            # 새 코드로 다시 암호화
```

`plan.json`을 잃어버렸으면 `plan.enc`에서 되돌린다.

```bash
node build.mjs --decrypt
```

현재 코드는 네 자리 숫자다. 링크가 밖으로 새는 걸 한 번 걸러내는 장벽이지,
작정하고 뚫으려는 상대를 막는 수단은 아니다. 경우의 수가 1만 가지뿐이라
자동으로 돌리면 풀린다. 그래서 카카오 로그인을 앞에 세운다.

## 카카오 로그인

입장코드를 사람이 외워 나르는 대신 워커가 쥐고 있다가 로그인한 사람에게만 넘긴다.
페이지는 받은 코드로 지금까지와 똑같이 `plan.enc`를 푼다. 복호화는 손대지 않았다.

```
브라우저  →  워커 /login  →  카카오 로그인  →  워커 /cb  →  페이지 #c=입장코드
```

카카오 계정이면 전원 통과한다. 특정 사람만 들이려면 `worker.js`의 `/cb`에서
`me.id`를 허용 목록과 대조하는 줄을 넣으면 된다. 로그인한 사람의 id와 닉네임은
`wrangler tail`로 볼 수 있다.

### 한 번만 하는 준비

1. [카카오 개발자](https://developers.kakao.com)에서 앱을 만든다.
   카카오 로그인을 켜고, Redirect URI에 `https://<워커주소>/cb`를 등록한다.
2. 워커를 올린다. `SITE`는 `wrangler.toml`에 있다.

```bash
npx wrangler deploy
npx wrangler secret put KAKAO_REST_KEY        # REST API 키
npx wrangler secret put KAKAO_CLIENT_SECRET   # 안 켰으면 건너뛴다
npx wrangler secret put ENTRY_CODE            # .code 와 같은 값
```

3. `index.html`의 `AUTH`에 워커 주소를 넣는다. 비워두면 버튼이 안 뜨고 입장코드만 받는다.

```js
const AUTH = 'https://glab-auth.<계정>.workers.dev';
```

입장코드를 바꿀 때는 `.code`, `node build.mjs`, `wrangler secret put ENTRY_CODE` 세 곳이 같이 움직인다.
어긋나면 로그인은 되는데 표가 안 열리고 "입장코드가 바뀌었습니다"가 뜬다.

```bash
node worker.test.mjs   # 워커 분기 확인
```

## 파일

| 파일 | 역할 |
|---|---|
| `plan.json` | 조 기준값, 세션 타입, 주차별 계획. **여기만 고친다**. 커밋 안 함 |
| `plan.enc` | 위를 입장코드로 암호화한 것. 웹에 올라가는 건 이것뿐 |
| `crypt.mjs` | 암복호화 |
| `.code` | 입장코드. 커밋 안 함 |
| `calc.js` | 조별표 산출 엔진 |
| `index.html` | 페이지 |
| `check.mjs` | 크루 배포 원본표 재현 검증 |
| `build.mjs` | 단일 파일(`glab.html`)과 공유 카드(`og.png`) 생성 |
| `og.html` | 공유 카드 원본 |
| `icon-src.png` | 파비콘 원본 로고. 여기서 512/180/32 를 뽑는다 |
| `glab.html` | 서버 없이 열리는 단일 파일. **평문이라 커밋 안 함** |
| `worker.js` | 카카오 로그인 확인 워커. 통과하면 입장코드를 넘긴다 |
| `wrangler.toml` | 워커 설정. `SITE`가 돌아갈 페이지 주소 |
| `worker.test.mjs` | 워커 분기 검증 |
| `gate.mp4` | 입장 화면 배경 영상. Pexels 무료 소재를 1280px / CRF30 으로 다시 인코딩했다 |
| `gate.jpg` | 위 영상의 포스터. 영상이 뜨기 전과 모션 최소화 설정에서 쓰인다 |
| `design.html` | 디자인 가이드 지면 |
| `DESIGN.md` | 디자인 기준 |

## 조별표가 나오는 원리

조마다 기준 랩타임(400m, 초) 하나만 정하면 나머지 강도는 오프셋으로 계산된다.

```
R 반복 = 기준 -5      I 인터벌 = 기준       T 역치 = 기준 +5
M 마라톤 = 기준 +8    회복 = 기준 +10       E 조깅 = 기준 +22
```

회복 `+10`과 후반 가속 `-2`는 2026-09-17 G-LAB 별무리 배포 자료에서 역산한 확정값이다.
`check.mjs`가 이 재현을 검증하므로 기준값을 잘못 건드리면 빌드 전에 걸린다.

2000+400과 3000+600은 계산하지 않고 PAC5기 배포 원본표를 그대로 싣는다.

## 주의

- 표의 숫자는 **400m 랩타임**이다. 800m 구간은 이 랩을 두 번 도는 시간이다.
- 1~10주차는 원본 자료가 없어 변속주 진행 순서로 배치한 추정치다. `draft: true`로 표시된다.
- 조 배정 기준(10km 기록)이 자료마다 다르다. 여름 별무리와 겨울 PAC5기가 서로 다른 사다리를 쓴다.
