// node check.mjs
// 엔진이 2026-09-17 G-LAB 별무리 배포 자료를 그대로 재현하는지 확인한다.
// 기준 랩이나 오프셋을 건드리면 여기서 먼저 깨진다.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { session, pace } from './calc.js';

const plan = JSON.parse(readFileSync('./plan.json', 'utf8'));
const f = plan.types['800+800바퀴'];

// 9/17 별무리 원본: [총바퀴, 분할, 전반질주, 후반질주, 회복]
const actual = [
  [38, 24,  90,  88, 100],
  [34, 20,  94,  92, 104],
  [34, 20,  98,  96, 108],
  [34, 20, 102, 100, 112],
  [30, 20, 107, 105, 117],
  [30, 20, 112, 110, 122],
  [26, 16, 132, 130, 142],
  [22, 12, 145, 143, 155],
];

plan.groups.forEach((g, i) => {
  const s = session(g, i, f, plan.offsets);
  const [total, split, front, back, rec] = actual[i];
  assert.equal(s.laps, total, `${g.id} 총바퀴`);
  assert.equal(s.split, split, `${g.id} 분할`);
  assert.equal(s.rep, front, `${g.id} 전반 질주`);
  assert.equal(s.back, back, `${g.id} 후반 질주`);
  assert.equal(s.rec, rec, `${g.id} 회복`);
  // 질주 = 회복 + 1 이어야 마지막 회복 생략 구조가 맞는다
  assert.equal(s.reps, s.recs + 1, `${g.id} 질주/회복 횟수`);
  // 전반 바퀴수가 실제 분할점과 일치하는지
  assert.equal(s.fReps * 4, split, `${g.id} 전반 구성`);
});

// S조: 38바퀴 = 15.2km, 질주 10회
const s0 = session(plan.groups[0], 0, f, plan.offsets);
assert.equal(s0.km, 15.2);
assert.equal(s0.reps, 10);

assert.equal(pace(90), `3'45"`);
assert.equal(pace(145), `6'03"`);

// 주차의 훈련 이름은 조별표가 있거나, 적어도 단계 표에 등록돼 있어야 한다
plan.weeks.forEach(w => {
  assert.ok(plan.types[w.type] || w.type in plan.stageOf, `${w.n}주차 알 수 없는 타입: ${w.type}`);
  if (w.longType) assert.ok(plan.longTypes[w.longType], `${w.n}주차 알 수 없는 장거리: ${w.longType}`);
  assert.ok(w.long !== undefined, `${w.n}주차 일요일 내용 없음`);
});

// 단계 표의 값은 progression 안에 있어야 한다 (빈 문자열은 단계 없음)
Object.entries(plan.stageOf).forEach(([k, v]) =>
  assert.ok(v === '' || plan.progression.includes(v), `stageOf ${k} -> ${v} 가 progression 에 없다`));

// 정의만 해두고 안 쓰는 타입이 없어야 한다
const usedTypes = new Set(plan.weeks.map(w => w.type));
Object.keys(plan.types).forEach(k => assert.ok(usedTypes.has(k), `쓰이지 않는 타입: ${k}`));

// 사다리형: 시퀀스에서 계산한 바퀴수가 배포표의 총 바퀴와 맞아야 한다
const L = plan.types['파틀렉'];
plan.groups.forEach((g, i) => {
  const seq = L.seq[i].split('').map(Number);
  const sprint = seq.reduce((a, b) => a + b, 0);
  assert.equal(sprint + seq.length - 1, L.laps[i], `${g.id} 사다리 바퀴수`);
  assert.equal(L.reps[i].length, 4, `${g.id} 블록 랩타임 4개`);
  // 블록이 짧을수록 빨라야 한다
  L.reps[i].forEach((v, k) => { if (k) assert.ok(v < L.reps[i][k - 1], `${g.id} ${4 - k}바퀴가 더 느리다`); });
});
const REC = [102, 106, 112, 118, 124, 128, 134, 144];
assert.deepEqual(L.rec, REC, '사다리 회복 랩');

console.log('ok / 9월 17일 별무리 자료 8개 조 재현 확인');

// 크루 배포 원본 표 재현 (2/12 반포 2000+400, 2/26 연대 3000+600)
[['2000+400', [[84,150,6],[92,160,5],[100,170,5],[108,180,5],[116,190,4],[124,200,4],[132,210,3],[140,220,3]]],
 ['3000+600', [[86,210,4],[96,240,4],[106,270,4],[116,300,3],[126,330,3],[136,360,3],[146,390,3],[156,420,2]]]
].forEach(([key, rows]) => {
  const t = plan.types[key];
  plan.groups.forEach((g, i) => {
    const s = session(g, i, t, plan.offsets);
    const [rep, rec, n] = rows[i];
    assert.equal(s.rep, rep, `${key} ${g.id} 질주`);
    assert.equal(s.rec, rec, `${key} ${g.id} 회복`);
    assert.equal(s.sets, n, `${key} ${g.id} 세트`);
  });
  // 질주와 회복이 등차인지
  const d = a => new Set(a.slice(1).map((v, j) => v - a[j]));
  assert.equal(d(t.reps).size, 1, `${key} 질주 등차 아님`);
  assert.equal(d(t.recSec).size, 1, `${key} 회복 등차 아님`);
});

// 19개 주차가 빠짐없이 1~19인지
assert.deepEqual(plan.weeks.map(w => w.n), [...Array(19)].map((_, i) => i + 1));

console.log('ok / PAC 배포표 2종 재현, 등차 확인, 19주차 연속성 확인');
