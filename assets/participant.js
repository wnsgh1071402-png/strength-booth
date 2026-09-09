// 수검자용 앱 — 영역 선택 → 24문항 → 결과

import { AREAS, SCALE, getArea, getStrength, findStrength, BOOTH_NAME } from './data.js';
import { buildQuestions, buildRecord, rankStrengths, MAX_SCORE } from './scoring.js';
import { submitResult, initStore } from './store.js';

const PROGRESS_KEY = 'booth:progress';
const PROGRESS_TTL = 30 * 60 * 1000; // 30분 지난 진행 상황은 버림

const $ = (id) => document.getElementById(id);

const state = {
  areaId: null,
  questions: [],
  answers: [],
  index: 0,
  record: null
};

// ── 화면 전환 ──────────────────────────────────────

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

// ── 진행 상황 임시 저장 (새로고침 대비) ────────────

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      areaId: state.areaId, answers: state.answers, index: state.index, at: Date.now()
    }));
  } catch { /* 저장 실패해도 검사는 계속된다 */ }
}

function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* noop */ }
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    if (!raw || !getArea(raw.areaId)) return null;
    if (Date.now() - raw.at > PROGRESS_TTL) return null;
    return raw;
  } catch {
    return null;
  }
}

// ── 영역 선택 ──────────────────────────────────────

function renderAreas() {
  $('area-list').innerHTML = AREAS.map((a) => `
    <button class="area-card" data-area="${a.id}">
      <span class="emoji">${a.emoji}</span>
      <span>
        <span class="t">${a.name}</span>
        <span class="d">${a.tagline}</span>
      </span>
    </button>`).join('');

  $('area-list').querySelectorAll('[data-area]').forEach((btn) => {
    btn.addEventListener('click', () => startQuiz(btn.dataset.area));
  });
}

// ── 검사 ───────────────────────────────────────────

function startQuiz(areaId, resume = null) {
  state.areaId = areaId;
  state.questions = buildQuestions(areaId);
  state.answers = resume ? resume.answers.slice() : new Array(state.questions.length).fill(null);
  state.index = resume ? Math.min(resume.index, state.questions.length - 1) : 0;

  $('quiz-area-name').textContent = getArea(areaId).name;
  renderQuestion();
  show('screen-quiz');
}

function renderQuestion() {
  const total = state.questions.length;
  const q = state.questions[state.index];
  const picked = state.answers[state.index];

  $('quiz-no').textContent = state.index + 1;
  $('quiz-bar').style.width = `${((state.index) / total) * 100}%`;
  $('quiz-question').textContent = q.text;

  $('quiz-scale').innerHTML = SCALE.map((s) => `
    <button data-v="${s.value}" class="${picked === s.value ? 'picked' : ''}">
      <span class="dot"></span><span>${s.label}</span>
    </button>`).join('');

  $('quiz-scale').querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => answer(Number(btn.dataset.v), btn));
  });

  $('btn-prev').disabled = state.index === 0;
}

// 다음 문항으로 넘어가는 짧은 전환 중에는 입력을 막는다.
// (막지 않으면 빠르게 두 번 탭했을 때 두 번째 탭이 다음 문항의 답으로 기록된다)
let advancing = false;

function answer(value, btn) {
  if (advancing) return;
  advancing = true;

  state.answers[state.index] = value;
  saveProgress();

  // 화면 갱신 전에도 선택한 게 보이도록 즉시 표시
  $('quiz-scale').querySelectorAll('button').forEach((b) => b.classList.toggle('picked', b === btn));

  setTimeout(() => {
    advancing = false;
    if (state.index < state.questions.length - 1) {
      state.index += 1;
      renderQuestion();
    } else {
      finish();
    }
  }, 130);
}

// ── 결과 ───────────────────────────────────────────

async function finish() {
  clearProgress();
  const record = buildRecord(state.areaId, state.answers);
  state.record = record;

  renderResult(record);
  show('screen-result');

  // 서버 확인에 몇 초 걸린다. 그동안 "선생님 화면에 떴다"고 단정하지 않는다.
  $('code-help').textContent = '';
  $('result-notice').innerHTML = '<div class="notice">결과를 선생님 화면으로 보내는 중입니다…</div>';

  const res = await submitResult(record);
  const notice = $('result-notice');

  if (res.ok && res.mode === 'cloud') {
    notice.innerHTML = '';
    $('code-help').textContent = '선생님 화면에 결과가 표시되었습니다';
  } else if (res.mode === 'local') {
    $('code-label').textContent = '내 결과 번호';
    $('code-help').textContent = '';
    notice.innerHTML = `<div class="notice">이 기기에만 저장되었습니다. 선생님께 이 화면을 그대로 보여주십시오.</div>`;
  } else {
    $('code-help').textContent = '';
    notice.innerHTML = `<div class="notice warn">네트워크가 불안정해 선생님 화면으로 전송하지 못했습니다.<br>이 화면을 직접 보여주십시오. 결과는 그대로입니다.</div>`;
  }
}

function renderResult(record) {
  const area = getArea(record.areaId);
  $('result-area').textContent = area.emoji + ' ' + area.name;
  $('result-code').textContent = record.code;

  const ranked = rankStrengths(record.areaId, record.scores);
  const topIds = record.top3;

  $('result-cards').innerHTML = topIds.map((id, i) => {
    const s = getStrength(record.areaId, id);
    return `
      <div class="top-card ${i === 0 ? 'rank1' : ''}">
        <span class="rank-badge">TOP ${i + 1}</span>
        <div class="name">${s.emoji} ${s.name}</div>
        <div class="via">${s.via}</div>
        <p class="desc">${s.result}</p>
        <div class="action"><b>살리는 법 ·</b> ${s.action}</div>
      </div>`;
  }).join('');

  $('result-rest').innerHTML = ranked.map((r) => {
    const s = getStrength(record.areaId, r.id);
    return `<div class="rest-row">
      <span>${s.emoji} ${s.name}</span>
      <span class="sc">${r.score} / ${MAX_SCORE}</span>
    </div>`;
  }).join('');

  renderInterpret(record, topIds);
  renderMatch(record, topIds[0]);
}

/** 1위 강점을 주 유형으로 보고 특징을 펼친다 */
function renderInterpret(record, topIds) {
  const main = getStrength(record.areaId, topIds[0]);
  const others = topIds.slice(1).map((id) => {
    const s = getStrength(record.areaId, id);
    return `<li><b>${s.emoji} ${s.name}</b> ${s.interpret.adds}</li>`;
  }).join('');

  $('result-interpret').innerHTML = `
    <details class="deep" open>
      <summary>내 유형 자세히 보기</summary>
      <div class="deep-body">
        <p class="type-name">${main.emoji} ${main.name} 유형</p>
        <ul class="type-traits">${main.interpret.traits.map((t) => `<li>${t}</li>`).join('')}</ul>
        <p class="deep-h">함께 나온 강점이 더하는 것</p>
        <ul class="type-adds">${others}</ul>
      </div>
    </details>`;
}

/** 잘 맞는 유형 — 근거의 성격이 다르므로 화면에서도 구분해 표시한다 */
function renderMatch(record, topId) {
  const main = getStrength(record.areaId, topId);
  const m = main.interpret.match;

  const card = (label, id, why, note) => {
    const found = findStrength(id);
    if (!found) return '';
    const cross = found.area.id !== record.areaId ? `<span class="ma-area">${found.area.name}</span>` : '';
    return `<div class="match-card">
      <p class="ma-label">${label}</p>
      <p class="ma-name">${found.strength.emoji} ${found.strength.name} ${cross}</p>
      <p class="ma-why">${why}</p>
      <p class="ma-note">${note}</p>
    </div>`;
  };

  $('result-match').innerHTML = `
    <details class="deep">
      <summary>나와 잘 맞는 유형 (재미로 보기)</summary>
      <div class="deep-body">
        ${card('잘 통하는 친구', m.friend, m.friendWhy,
               'VIA 연구에서 함께 나타나는 경향이 큰 강점입니다.')}
        ${card('서로 채워주는 짝', m.partner, m.partnerWhy,
               '검증된 궁합 결과가 아니라, 강점이 지나칠 때를 보완하는 조합으로 골랐습니다.')}
      </div>
    </details>`;
}

// ── 결과 이미지 저장 (외부 라이브러리 없이 canvas로 직접 그림) ──

/**
 * 결과 이미지 생성 — 화면에 보이는 내용을 전부 담는다.
 * 내용 길이에 따라 높이가 달라지므로 같은 그리기 코드를 두 번 돌린다.
 * 1회차(dry)는 좌표만 계산해 전체 높이를 구하고, 2회차에 실제로 그린다.
 */
function drawResultImage(record) {
  const W = 1080;
  const PAD = 70;
  const INNER = 38;
  const TW = W - (PAD + INNER) * 2;

  const area = getArea(record.areaId);
  const top = record.top3.map((id) => getStrength(record.areaId, id));
  const main = top[0];
  const m = main.interpret.match;

  const font = (size, weight = 400) =>
    `${weight} ${size}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  const height = paint(measure, true);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = height;
  paint(cv.getContext('2d'), false);
  return cv;

  function paint(c, dry) {
    if (!dry) {
      c.fillStyle = '#FFFBF3';
      c.fillRect(0, 0, W, height);
      c.fillStyle = '#F2A93B';
      c.fillRect(0, 0, W, 14);
    }

    // ── 머리말 ──
    c.textAlign = 'center';
    let y = 96;
    y = line(c, dry, '✨ ' + BOOTH_NAME, W / 2, y, 32, 700, '#D4831A');
    y = line(c, dry, '나의 강점 TOP 3', W / 2, y + 80, 58, 800, '#2B2620');
    y = line(c, dry, area.emoji + ' ' + area.name, W / 2, y + 44, 28, 400, '#8B8278');
    c.textAlign = 'left';
    y += 54;

    // ── 강점 카드 3장 ──
    top.forEach((s, i) => {
      const start = y;
      let ty = y + INNER + 26;
      ty = line(c, dry, `TOP ${i + 1}`, PAD + INNER, ty, 24, 800, '#D4831A');
      ty = line(c, dry, `${s.emoji} ${s.name}`, PAD + INNER, ty + 54, 44, 800, '#2B2620');
      ty = line(c, dry, s.via, PAD + INNER, ty + 32, 23, 400, '#8B8278');
      ty = block(c, dry, s.result, PAD + INNER, ty + 44, 27, TW, 42, '#5C5349');

      // 살리는 법 상자
      const aLines = wrapLines(c, font(25), '살리는 법 · ' + s.action, TW - 36);
      const boxH = aLines.length * 38 + 34;
      if (!dry) {
        c.fillStyle = '#FFF3DE';
        roundRect(c, PAD + INNER, ty + 16, TW, boxH, 12);
        c.fill();
      }
      let ay = ty + 16 + 34;
      aLines.forEach((t) => {
        if (!dry) { c.font = font(25); c.fillStyle = '#7A4A08'; c.fillText(t, PAD + INNER + 18, ay); }
        ay += 38;
      });
      ty = ty + 16 + boxH;

      const cardH = ty + INNER - start;
      if (!dry) {
        c.fillStyle = '#FFFFFF';
        roundRect(c, PAD, start, W - PAD * 2, cardH, 26);
        c.fill();
        c.strokeStyle = i === 0 ? '#F2A93B' : '#EFE4D2';
        c.lineWidth = i === 0 ? 4 : 2;
        roundRect(c, PAD, start, W - PAD * 2, cardH, 26);
        c.stroke();
        // 카드 배경이 글자를 덮었으므로 같은 자리에 다시 그린다
        paintCardText(c, s, i, start);
      }
      y = start + cardH + 22;
    });

    // ── 내 유형 ──
    y += 26;
    y = line(c, dry, '내 유형', PAD, y, 22, 800, '#D4831A');
    y = line(c, dry, `${main.emoji} ${main.name} 유형`, PAD, y + 50, 40, 800, '#2B2620');
    y += 20;
    main.interpret.traits.forEach((t) => {
      if (!dry) { c.fillStyle = '#F2A93B'; c.beginPath(); c.arc(PAD + 7, y + 12, 6, 0, Math.PI * 2); c.fill(); }
      y = block(c, dry, t, PAD + 28, y + 22, 26, W - PAD * 2 - 28, 40, '#2B2620') + 18;
    });

    y += 34;
    y = line(c, dry, '함께 나온 강점이 더하는 것', PAD, y, 22, 800, '#8B8278');
    y += 18;
    top.slice(1).forEach((s) => {
      y = block(c, dry, `${s.emoji} ${s.name} — ${s.interpret.adds}`, PAD, y + 26, 25, W - PAD * 2, 38, '#5C5349') + 12;
    });

    // ── 잘 맞는 유형 ──
    y += 54;
    y = line(c, dry, '나와 잘 맞는 유형 (재미로 보기)', PAD, y, 22, 800, '#D4831A');
    y += 14;
    y = matchRow(c, dry, y, '잘 통하는 친구', m.friend, m.friendWhy);
    y = matchRow(c, dry, y, '서로 채워주는 짝', m.partner, m.partnerWhy);
    y = block(c, dry, '※ 검증된 궁합 결과가 아니라 강점 조합으로 만든 참고용입니다.',
              PAD, y + 40, 21, W - PAD * 2, 32, '#8B8278');

    // ── 꼬리말 ──
    y += 60;
    c.textAlign = 'center';
    y = line(c, dry, 'VIA 성격강점 분류를 참고한 부스 활동입니다', W / 2, y, 23, 400, '#8B8278');
    c.textAlign = 'left';
    return y + 50;
  }

  // 카드 배경을 칠한 뒤 글자를 다시 얹는다
  function paintCardText(c, s, i, start) {
    let ty = start + INNER + 26;
    ty = line(c, false, `TOP ${i + 1}`, PAD + INNER, ty, 24, 800, '#D4831A');
    ty = line(c, false, `${s.emoji} ${s.name}`, PAD + INNER, ty + 54, 44, 800, '#2B2620');
    ty = line(c, false, s.via, PAD + INNER, ty + 32, 23, 400, '#8B8278');
    ty = block(c, false, s.result, PAD + INNER, ty + 44, 27, TW, 42, '#5C5349');

    const aLines = wrapLines(c, font(25), '살리는 법 · ' + s.action, TW - 36);
    const boxH = aLines.length * 38 + 34;
    c.fillStyle = '#FFF3DE';
    roundRect(c, PAD + INNER, ty + 16, TW, boxH, 12);
    c.fill();
    let ay = ty + 16 + 34;
    aLines.forEach((t) => {
      c.font = font(25);
      c.fillStyle = '#7A4A08';
      c.fillText(t, PAD + INNER + 18, ay);
      ay += 38;
    });
  }

  function matchRow(c, dry, y, label, id, why) {
    const found = findStrength(id);
    if (!found) return y;
    const cross = found.area.id !== record.areaId ? ` (${found.area.name})` : '';
    y = line(c, dry, label, PAD, y + 40, 21, 800, '#8B8278');
    y = line(c, dry, `${found.strength.emoji} ${found.strength.name}${cross}`, PAD, y + 40, 30, 800, '#2B2620');
    return block(c, dry, why, PAD, y + 34, 24, W - PAD * 2, 36, '#5C5349');
  }

  /** 한 줄 그리기 — 그린 뒤의 y를 돌려준다 */
  function line(c, dry, text, x, y, size, weight, color) {
    if (!dry) { c.font = font(size, weight); c.fillStyle = color; c.fillText(text, x, y); }
    return y;
  }

  /** 여러 줄로 감싸 그리기 — 마지막 줄의 y를 돌려준다 */
  function block(c, dry, text, x, y, size, width, lh, color) {
    const ls = wrapLines(c, font(size), text, width);
    ls.forEach((t, i) => {
      if (!dry) { c.font = font(size); c.fillStyle = color; c.fillText(t, x, y + i * lh); }
    });
    return y + (ls.length - 1) * lh;
  }
}

/** 글자 단위로 감싸 줄 배열을 만든다 (한국어는 단어 경계가 넓어 글자 기준이 안전) */
function wrapLines(c, fontSpec, text, maxWidth) {
  c.font = fontSpec;
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (c.measureText(cur + ch).width > maxWidth && cur) {
      out.push(cur);
      cur = ch === ' ' ? '' : ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function saveImage() {
  if (!state.record) return;
  const cv = drawResultImage(state.record);

  cv.toBlob((blob) => {
    if (!blob) return fallbackSave();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `내강점_${state.record.code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
}

// iOS Safari 등 download 속성이 막히는 환경 대비
function fallbackSave() {
  $('result-notice').innerHTML =
    `<div class="notice">이 기기에서는 자동 저장이 되지 않습니다. 화면을 캡처해 저장해 주십시오.</div>`;
}

// ── 초기화 ─────────────────────────────────────────

function reset(toAreas) {
  clearProgress();
  state.areaId = null;
  state.record = null;
  state.answers = [];
  state.index = 0;
  $('result-notice').innerHTML = '';
  $('code-label').textContent = '상담 선생님께 이 번호를 보여주십시오';
  $('code-help').textContent = '선생님 화면에 결과가 표시되었습니다';
  show(toAreas ? 'screen-areas' : 'screen-start');
}

function init() {
  renderAreas();

  $('btn-begin').addEventListener('click', () => show('screen-areas'));
  $('btn-prev').addEventListener('click', () => {
    if (state.index > 0) { state.index -= 1; renderQuestion(); saveProgress(); }
  });
  $('btn-quit').addEventListener('click', () => {
    if (confirm('검사를 그만두시겠습니까? 지금까지 고른 답은 사라집니다.')) reset(true);
  });
  $('btn-again').addEventListener('click', () => reset(false));
  $('btn-other').addEventListener('click', () => reset(true));
  $('btn-save').addEventListener('click', saveImage);

  document.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => show(b.dataset.go));
  });

  // 새로고침으로 중단된 검사가 있으면 이어서
  const progress = loadProgress();
  if (progress && progress.answers.some((a) => a !== null)) {
    startQuiz(progress.areaId, progress);
  }

  // Firestore 연결은 결과 제출 전에 미리 준비해둔다
  initStore();
}

init();
