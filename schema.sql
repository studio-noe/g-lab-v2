-- 훈련 후기. 한 사람이 한 훈련에 하나. 다시 쓰면 덮어쓴다.
CREATE TABLE IF NOT EXISTS feedback (
  week INTEGER NOT NULL,
  day  TEXT    NOT NULL,   -- thu | sun
  uid  TEXT    NOT NULL,   -- 카카오 id
  name TEXT,
  grp  TEXT,               -- 그날 투표한 조
  lane TEXT,               -- 안쪽 | 외곽 (트랙만)
  cond TEXT    NOT NULL,   -- 상 | 중 | 하
  done TEXT    NOT NULL,   -- 완주 | 일부 | 중단
  body TEXT,
  at   TEXT    NOT NULL,
  PRIMARY KEY (week, day, uid)
);
