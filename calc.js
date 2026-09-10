// 조별표 산출 엔진.
// 조마다 기준 랩타임(400m, 초) 하나만 있으면 나머지 강도는 오프셋으로 전부 나온다.
// float(+10)과 후반 가속(-2)은 2026-09-17 G-LAB 별무리 자료에서 역산한 확정값이다.

export const pace = lap => {
  const s = Math.round(lap * 2.5);            // 400m 랩 -> km 페이스
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
};

export const clock = sec => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const zones = (group, offsets) =>
  Object.fromEntries(Object.entries(offsets).map(([k, v]) => [k, group.lap + v]));

// 세트형: 질주 N회 + 회복 N-1회 (마지막 회복 생략)
function sets(group, i, type, offsets) {
  const rep = group.lap + offsets[type.zone] + (type.repAdd || 0);
  const rec = group.lap + type.recAdd;
  const n = type.sets[i];
  const metres = n * (type.rep + type.rec) - type.rec;

  return {
    rep, rec, sets: n, metres,
    time: n * (rep * type.rep / 400 + rec * type.rec / 400) - rec * type.rec / 400,
  };
}

// 바퀴형(파틀렉): 총 바퀴수를 주고 분할 지점부터 질주를 backFaster초 빠르게.
// 800+800이므로 한 블록 = 4바퀴(질주 2 + 회복 2), 마지막 회복은 생략한다.
function laps(group, i, type) {
  const total = type.laps[i], split = type.split[i];
  const front = group.lap, back = front - type.backFaster, rec = group.lap + type.recAdd;

  const reps = Math.ceil(total / 4), recs = Math.floor(total / 4);
  const fReps = Math.ceil(split / 4), fRecs = Math.floor(split / 4);
  const bReps = reps - fReps, bRecs = recs - fRecs;

  return {
    rep: front, back, rec, reps, recs, fReps, bReps, split,
    metres: total * 400,
    time: (fReps * front + bReps * back + recs * rec) * 2,   // 800m = 랩 x 2
  };
}

// 표형: 크루가 실제로 배포한 표를 그대로 쓴다. 회복은 페이스가 아니라 시간으로 주어진다.
function table(i, type) {
  const rep = type.reps[i], rec = type.recSec[i], n = type.sets[i];
  return {
    rep, rec, sets: n, recIsTime: true,
    last: type.last ? type.last[i] : '',
    metres: n * type.rep + (n - 1) * type.rec,
    time: type.time ? type.time[i] * 60 : n * rep * type.rep / 400 + (n - 1) * rec,
  };
}

// 사다리형: 질주 블록 바퀴수가 4-3-2-1-2-3... 으로 오르내린다.
// 블록마다 회복 400m 1바퀴가 붙고 마지막 블록만 회복이 없다.
function ladder(i, type) {
  const seq = type.seq[i].split('').map(Number);
  const reps = type.reps[i];                 // [4바퀴랩, 3바퀴랩, 2바퀴랩, 1바퀴랩]
  const rec = type.rec[i];
  const lapOf = n => reps[4 - n];            // 4바퀴 -> reps[0], 1바퀴 -> reps[3]
  const sprintLaps = seq.reduce((a, b) => a + b, 0);
  const recLaps = seq.length - 1;
  return {
    seq, reps, rec, blocks: seq.length, sprintLaps, recLaps,
    rep: reps[0],                            // 대표값은 가장 긴 블록
    metres: (sprintLaps + recLaps) * 400,
    time: seq.reduce((a, n) => a + n * lapOf(n), 0) + recLaps * rec,
  };
}

export function session(group, i, type, offsets) {
  const r = type.mode === 'ladder' ? ladder(i, type)
          : type.mode === 'laps' ? laps(group, i, type)
          : type.mode === 'table' ? table(i, type)
          : sets(group, i, type, offsets);
  return {
    ...r,
    repPace: pace(r.rep),
    recPace: pace(r.recIsTime && type.mode !== 'ladder' ? r.rec * 400 / type.rec : r.rec),
    backPace: r.back ? pace(r.back) : null,
    repTime: type.mode === 'ladder' ? clock(r.rep * 4) : clock(r.rep * type.rep / 400),
    // 표형은 회복이 통째로 초 단위, 나머지는 랩타임 x 거리
    recTime: type.mode === 'ladder' ? clock(r.rec)
           : clock(r.recIsTime ? r.rec : r.rec * type.rec / 400),
    recPaceLap: r.recIsTime ? Math.round(r.rec * 400 / type.rec) : r.rec,
    km: Math.round(r.metres / 100) / 10,
    laps: r.metres / 400,
    total: clock(r.time),
  };
}
