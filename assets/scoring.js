// 채점 로직 — 수검자용/상담자용이 공유

import { getArea } from './data.js';

export const ITEMS_PER_STRENGTH = 4;
export const MIN_SCORE = ITEMS_PER_STRENGTH * 1;  // 4
export const MAX_SCORE = ITEMS_PER_STRENGTH * 5;  // 20

// 문자열 → 32bit 정수 시드
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — 시드가 같으면 항상 같은 순서
function rng(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 영역의 24문항을 화면 출제 순서로 반환.
 * 같은 강점 4문항이 연달아 나오면 응답 편향이 생기므로 섞되,
 * 영역 id를 시드로 쓴 고정 셔플이라 누가 언제 열어도 순서가 동일하다.
 * (순서가 고정이어야 답안 배열만으로 채점을 재현할 수 있음)
 */
export function buildQuestions(areaId) {
  const area = getArea(areaId);
  if (!area) return [];

  const list = [];
  area.strengths.forEach((s) => {
    s.items.forEach((text, i) => {
      list.push({ strengthId: s.id, text, itemIndex: i });
    });
  });

  const rand = rng(seedFrom(area.id));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.map((q, i) => ({ ...q, no: i + 1 }));
}

/** 답안 배열(문항 순서대로 1~5) → 강점별 합산 점수 */
export function scoreAnswers(areaId, answers) {
  const questions = buildQuestions(areaId);
  const scores = {};
  getArea(areaId).strengths.forEach((s) => { scores[s.id] = 0; });

  questions.forEach((q, i) => {
    const v = Number(answers[i]);
    if (v >= 1 && v <= 5) scores[q.strengthId] += v;
  });
  return scores;
}

/**
 * 점수 → 순위. 동점은 영역에 정의된 순서를 우선한다(기획 문서 규칙).
 * 단 3위가 동점이면 잘라내지 않고 같이 보여준다.
 */
export function rankStrengths(areaId, scores) {
  const order = getArea(areaId).strengths.map((s) => s.id);
  return order
    .map((id) => ({ id, score: scores[id] ?? 0 }))
    .sort((a, b) => (b.score - a.score) || (order.indexOf(a.id) - order.indexOf(b.id)));
}

export function pickTop(areaId, scores, size = 3) {
  const ranked = rankStrengths(areaId, scores);
  if (ranked.length <= size) return ranked;

  const cutoff = ranked[size - 1].score;
  const top = ranked.filter((r, i) => i < size || r.score === cutoff);
  return top;
}

/** 참여자↔상담자 매칭용 4자리 코드 (개인정보 아님, 당일 한정) */
export function makeCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * 제출 레코드 생성.
 * answers는 출제 순서(buildQuestions)대로의 1~5 배열이다. 상담자 화면이
 * "이 문항에 이렇게 답했다"를 보여주려면 합산 점수만으로는 부족해서 함께 남긴다.
 * 순서는 고정 셔플이라 buildQuestions로 언제든 문항과 다시 맞출 수 있다.
 */
export function buildRecord(areaId, answers) {
  const scores = scoreAnswers(areaId, answers);
  const top = pickTop(areaId, scores);
  return {
    code: makeCode(),
    areaId,
    scores,
    top3: top.slice(0, 3).map((t) => t.id),
    answers: answers.map((v) => Number(v) || 0),
    createdAtLocal: Date.now()
  };
}

/**
 * 답안 배열을 문항별로 되돌린다. 상담자 화면 전용.
 * 데이터가 바뀌어 길이가 안 맞으면 빈 배열을 돌려준다(옛 기록 대비).
 */
export function explainAnswers(areaId, answers) {
  if (!Array.isArray(answers)) return [];
  const questions = buildQuestions(areaId);
  if (answers.length !== questions.length) return [];
  return questions.map((q, i) => ({ ...q, value: Number(answers[i]) || 0 }));
}
