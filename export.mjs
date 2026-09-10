// node export.mjs > 훈련표_검토.txt
// 코치 검토용 텍스트. 조별표가 없는 주차를 드러내는 게 목적이다.

import { readFileSync } from 'node:fs';
import { session, pace } from './calc.js';

const p = JSON.parse(readFileSync('./plan.json', 'utf8'));
const md = d => d ? `${+d.split('-')[1]}/${+d.split('-')[2]}` : '';
const L = [];
const miss = { thu: [], sun: [], derived: [] };

L.push('G･LAB 훈련표 검토');
L.push(`${p.season.name} / 목표 ${p.season.race} ${md(p.season.raceDate)} / 전 ${p.season.totalWeeks}주`);
L.push('https://studio-noe.github.io/g-lab/');
L.push('');
L.push('조별 상세표가 있는 주차는 첫 조와 마지막 조 수치를 함께 적었다.');
L.push('없는 주차는 [조별표 없음] 으로 표시했다.');
L.push('');
L.push('='.repeat(56));

// 목요일 조별표 한 줄 요약
function thuLine(t) {
  const first = session(p.groups[0], 0, t, p.offsets);
  const last = session(p.groups[7], 7, t, p.offsets);
  if (t.mode === 'ladder')
    return `S조 ${t.seq[0]} ${t.laps[0]}바퀴 질주 ${t.reps[0].join('/')}초 회복 ${t.rec[0]}초`
         + `\n            7조 ${t.seq[7]} ${t.laps[7]}바퀴 질주 ${t.reps[7].join('/')}초 회복 ${t.rec[7]}초`;
  if (t.mode === 'laps')
    return `S조 ${first.laps}바퀴 질주 ${first.rep}초 회복 ${first.rec}초`
         + `\n            7조 ${last.laps}바퀴 질주 ${last.rep}초 회복 ${last.rec}초`;
  return `S조 ${first.rep}초 x ${first.sets}세트 회복 ${first.recTime}`
       + `\n            7조 ${last.rep}초 x ${last.sets}세트 회복 ${last.recTime}`;
}

p.weeks.forEach(w => {
  const t = p.types[w.type];
  L.push('');
  L.push(`${w.n}주차  ${md(w.thu)}(목)${w.sun ? ` / ${md(w.sun)}(일)` : ''}`);
  if (w.race) L.push(`  대회  ${w.race}`);

  L.push(`  목요일  ${t ? t.label : w.type}`);
  if (!t) { L.push('          [조별표 없음]'); miss.thu.push(w.n); }
  else {
    L.push(`          ${thuLine(t)}`);
    if (t.derived) { L.push('          [추정치. 실제 배포표 아님]'); miss.derived.push(w.n); }
  }

  if (!w.sun) { L.push('  일요일  없음'); return; }
  L.push(`  일요일  ${w.long}`);
  const lt = w.longType && p.longTypes[w.longType];
  if (!lt) { L.push('          [조별표 없음]'); miss.sun.push(w.n); }
  else {
    lt.groups.forEach((g, i) => {
      const tag = g.laps.length
        ? `${g.target} / ${g.laps.map(v => `${v.slice(0, -2)}'${v.slice(-2)}"`).join(' ')}`
        : '[자료 없음]';
      L.push(`          ${p.groups[i].id}  ${tag}`);
    });
  }
});

L.push('');
L.push('='.repeat(56));
L.push('');
L.push('확인 필요');
L.push('');
L.push(`1. 목요일 조별표가 없는 주차 : ${miss.thu.join(', ')}주차`);
L.push('   훈련명만 있고 조별 랩타임이 없다. 배포했던 표가 있으면 보내달라.');
L.push('');
L.push(`2. 일요일 조별표가 없는 주차 : ${miss.sun.join(', ')}주차`);
L.push('   장소만 있고 조별 페이스가 없다.');
L.push('');
L.push(`3. 계산 추정치인 주차 : ${miss.derived.join(', ')}주차`);
L.push('   실제 배포표가 없어 조별 기준 페이스에서 계산한 값이다. 원본으로 교체해야 한다.');
L.push('');
L.push('4. 12주차 일요일 7조 자료 없음');
L.push('   9/13 남산 장거리 원본이 6조까지만 확인됐다. 7조가 별도로 있는지 확인 필요.');
L.push('');
L.push('5. 조 배정 10km 기준이 자료마다 다르다');
L.push('   현재 반영값은 기준 배포 자료를 따른다.');
L.push('   조    현재    9/10 자료');
[[3, 44, 45], [4, 46, 48], [5, 48, 52]].forEach(([g, a, b]) =>
  L.push(`   ${g}조    ${a}분    ${b}분`));
L.push('   어느 쪽이 맞는지 확정 필요.');
L.push('');
L.push('현재 반영된 조 배정 기준');
p.groups.forEach(g => L.push(`   ${g.id}  10km ${g.tenK}  목표 ${g.goal}`));

console.log(L.join('\n'));
