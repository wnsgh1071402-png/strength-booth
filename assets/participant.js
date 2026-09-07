// 수검자용 앱 — 영역 선택 → 24문항 → 결과

import { AREAS, SCALE, getArea, getStrength, BOOTH_NAME } from './data.js';
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
  $('result-notice').innerHTML = '<div class="notice">결과를 선생님 화면으로 보내는 중…</div>';

  const res = await submitResult(record);
  const notice = $('result-notice');

  if (res.ok && res.mode === 'cloud') {
    notice.innerHTML = '';
    $('code-help').textContent = '선생님 화면에 네 결과가 떠 있어';
  } else if (res.mode === 'local') {
    $('code-label').textContent = '내 결과 번호';
    $('code-help').textContent = '';
    notice.innerHTML = `<div class="notice">이 기기에만 저장됐어. 선생님께 이 화면을 그대로 보여주면 돼.</div>`;
  } else {
    $('code-help').textContent = '';
    notice.innerHTML = `<div class="notice warn">네트워크가 불안정해서 선생님 화면으로 못 보냈어.<br>이 화면을 직접 보여주면 돼! 결과는 그대로야.</div>`;
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
}

// ── 결과 이미지 저장 (외부 라이브러리 없이 canvas로 직접 그림) ──

function drawResultImage(record) {
  const area = getArea(record.areaId);
  const W = 1080, H = 1120;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const font = (size, weight = 400) =>
    `${weight} ${size}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

  c.fillStyle = '#FFFBF3';
  c.fillRect(0, 0, W, H);

  c.fillStyle = '#F2A93B';
  c.fillRect(0, 0, W, 14);

  c.textAlign = 'center';
  c.fillStyle = '#D4831A';
  c.font = font(34, 700);
  c.fillText('✨ ' + BOOTH_NAME, W / 2, 120);

  c.fillStyle = '#2B2620';
  c.font = font(64, 800);
  c.fillText('나의 강점 TOP 3', W / 2, 210);

  c.fillStyle = '#8B8278';
  c.font = font(30, 400);
  c.fillText(area.emoji + ' ' + area.name, W / 2, 265);

  let y = 340;
  record.top3.forEach((id, i) => {
    const s = getStrength(record.areaId, id);

    c.fillStyle = '#FFFFFF';
    roundRect(c, 70, y, W - 140, 205, 28);
    c.fill();
    c.strokeStyle = i === 0 ? '#F2A93B' : '#EFE4D2';
    c.lineWidth = i === 0 ? 4 : 2;
    roundRect(c, 70, y, W - 140, 205, 28);
    c.stroke();

    c.textAlign = 'left';
    c.fillStyle = '#D4831A';
    c.font = font(26, 800);
    c.fillText(`TOP ${i + 1}`, 110, y + 58);

    c.fillStyle = '#2B2620';
    c.font = font(46, 800);
    c.fillText(`${s.emoji} ${s.name}`, 110, y + 120);

    c.fillStyle = '#5C5349';
    c.font = font(28, 400);
    wrapText(c, s.short, 110, y + 168, W - 220, 40);

    y += 235;
  });

  c.textAlign = 'center';
  c.fillStyle = '#8B8278';
  c.font = font(24, 400);
  c.fillText('VIA 성격강점 분류를 참고한 부스 활동입니다', W / 2, H - 45);

  return cv;
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

function wrapText(c, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const ch of text) {
    if (c.measureText(line + ch).width > maxWidth && line) {
      c.fillText(line, x, y);
      line = ch;
      y += lineHeight;
    } else {
      line += ch;
    }
  }
  c.fillText(line, x, y);
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
    `<div class="notice">이 기기에선 자동 저장이 안 돼. 화면을 캡처해서 저장해줘!</div>`;
}

// ── 초기화 ─────────────────────────────────────────

function reset(toAreas) {
  clearProgress();
  state.areaId = null;
  state.record = null;
  state.answers = [];
  state.index = 0;
  $('result-notice').innerHTML = '';
  $('code-label').textContent = '상담 선생님께 이 번호를 보여줘';
  $('code-help').textContent = '선생님 화면에 네 결과가 떠 있어';
  show(toAreas ? 'screen-areas' : 'screen-start');
}

function init() {
  renderAreas();

  $('btn-begin').addEventListener('click', () => show('screen-areas'));
  $('btn-prev').addEventListener('click', () => {
    if (state.index > 0) { state.index -= 1; renderQuestion(); saveProgress(); }
  });
  $('btn-quit').addEventListener('click', () => {
    if (confirm('검사를 그만둘까? 지금까지 고른 답은 사라져.')) reset(true);
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
