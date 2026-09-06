// 상담자용 앱 — 실시간 참여자 목록 · 상담 가이드 · 당일 집계

import { getArea, getStrength } from './data.js';
import { rankStrengths, MAX_SCORE } from './scoring.js';
import { subscribeResults, todayKey, initStore, getMode } from './store.js';
import { STAFF_PIN } from './firebase-config.js';

const SESSION_KEY = 'booth:staff-ok';
const $ = (id) => document.getElementById(id);

let rows = [];
let selectedId = null;
let unsubscribe = null;

// ── PIN 게이트 ─────────────────────────────────────

function unlock() {
  $('pin-gate').style.display = 'none';
  $('staff-shell').classList.add('active');
  start();
}

function checkPin() {
  const value = $('pin-input').value.trim();
  if (value === String(STAFF_PIN)) {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* noop */ }
    unlock();
  } else {
    $('pin-error').textContent = 'PIN이 맞지 않습니다.';
    $('pin-input').value = '';
    $('pin-input').focus();
  }
}

$('pin-submit').addEventListener('click', checkPin);
$('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });

// ── 데이터 구독 ────────────────────────────────────

async function watch(dateKey) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  rows = [];
  selectedId = null;
  render();
  unsubscribe = await subscribeResults(dateKey, (list) => {
    rows = list;
    render();
  });
}

async function start() {
  const today = todayKey();
  $('date-pick').value = today;
  $('date-pick').addEventListener('change', (e) => watch(e.target.value || today));

  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === btn));
      document.querySelectorAll('.pane').forEach((p) =>
        p.classList.toggle('active', p.id === btn.dataset.pane));
    });
  });

  await initStore();
  const pill = $('mode-pill');
  if (getMode() === 'cloud') {
    pill.textContent = '실시간 연결됨';
    pill.className = 'pill';
  } else {
    pill.textContent = '로컬 모드 (이 기기만)';
    pill.className = 'pill off';
  }

  watch(today);
}

// ── 렌더 ───────────────────────────────────────────

function timeOf(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function render() {
  renderList();
  renderPerson();
  renderStats();
  $('count-label').textContent = `${rows.length}명`;
}

function renderList() {
  const el = $('person-list');
  if (!rows.length) {
    el.innerHTML = `<div class="empty">아직 참여자가 없어요.<br>QR을 스캔해 검사를 마치면<br>여기에 자동으로 나타납니다.</div>`;
    return;
  }

  el.innerHTML = rows.map((r) => {
    const area = getArea(r.areaId);
    return `
      <button class="person ${r.id === selectedId ? 'on' : ''}" data-id="${r.id}">
        <span class="pcode">${r.code ?? '----'}</span>
        <span class="pmeta">${area ? area.emoji + ' ' + area.name : r.areaId}<br>${timeOf(r.createdAtLocal)}</span>
      </button>`;
  }).join('');

  el.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedId = btn.dataset.id;
      renderList();
      renderPerson();
    });
  });
}

function renderPerson() {
  const box = $('person-detail');
  const placeholder = $('person-placeholder');
  const row = rows.find((r) => r.id === selectedId);

  if (!row) {
    placeholder.style.display = '';
    box.innerHTML = '';
    return;
  }
  placeholder.style.display = 'none';

  const area = getArea(row.areaId);
  if (!area) { box.innerHTML = `<p class="muted">알 수 없는 영역: ${row.areaId}</p>`; return; }

  const ranked = rankStrengths(row.areaId, row.scores);
  const top = row.top3 || ranked.slice(0, 3).map((r) => r.id);

  const cards = top.map((id, i) => {
    const s = getStrength(row.areaId, id);
    const score = row.scores[id];
    return `
      <div class="guide-card">
        <span class="tag">TOP ${i + 1}</span>
        <h3>${s.emoji} ${s.name}</h3>
        <div class="sc-line">${s.via} · ${score} / ${MAX_SCORE}점</div>
        <p class="desc">${s.short}</p>
        <ul>${s.counselor.map((c) => `<li>${c}</li>`).join('')}</ul>
      </div>`;
  }).join('');

  const all = ranked.map((r) => {
    const s = getStrength(row.areaId, r.id);
    const pct = Math.round((r.score / MAX_SCORE) * 100);
    return `<div class="tally-row">
      <span>${s.emoji} ${s.name}</span>
      <span class="tbar"><i style="width:${pct}%"></i></span>
      <span class="tn">${r.score}</span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <span style="font-size:30px;font-weight:800;color:var(--accent-deep)">${row.code ?? '----'}</span>
      <span class="muted">${area.emoji} ${area.name} · ${timeOf(row.createdAtLocal)}</span>
    </div>
    ${cards}
    <h3 style="font-size:16px;margin:22px 0 12px">강점 6개 전체 점수</h3>
    <div class="tally">${all}</div>`;
}

function renderStats() {
  if (!rows.length) {
    $('stat-row').innerHTML = `<div class="stat"><div class="n">0</div><div class="l">참여자</div></div>`;
    $('tally').innerHTML = `<p class="muted">아직 집계할 결과가 없어요.</p>`;
    $('area-tally').innerHTML = '';
    return;
  }

  // TOP 3에 등장한 횟수로 강점 집계
  const strengthCount = new Map();
  const areaCount = new Map();

  rows.forEach((r) => {
    areaCount.set(r.areaId, (areaCount.get(r.areaId) || 0) + 1);
    (r.top3 || []).forEach((id) => {
      const key = `${r.areaId}|${id}`;
      strengthCount.set(key, (strengthCount.get(key) || 0) + 1);
    });
  });

  const sortedStrengths = [...strengthCount.entries()]
    .map(([key, n]) => {
      const [areaId, id] = key.split('|');
      return { s: getStrength(areaId, id), n };
    })
    .filter((x) => x.s)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const sortedAreas = [...areaCount.entries()]
    .map(([areaId, n]) => ({ a: getArea(areaId), n }))
    .filter((x) => x.a)
    .sort((a, b) => b.n - a.n);

  const topStrength = sortedStrengths[0];
  const topArea = sortedAreas[0];

  $('stat-row').innerHTML = `
    <div class="stat"><div class="n">${rows.length}</div><div class="l">오늘 참여자</div></div>
    <div class="stat"><div class="n" style="font-size:22px">${topStrength ? topStrength.s.emoji + ' ' + topStrength.s.name : '-'}</div><div class="l">가장 많이 나온 강점</div></div>
    <div class="stat"><div class="n" style="font-size:22px">${topArea ? topArea.a.emoji + ' ' + topArea.a.name : '-'}</div><div class="l">인기 영역</div></div>`;

  const maxN = sortedStrengths[0]?.n || 1;
  $('tally').innerHTML = sortedStrengths.map(({ s, n }) => `
    <div class="tally-row">
      <span>${s.emoji} ${s.name}</span>
      <span class="tbar"><i style="width:${(n / maxN) * 100}%"></i></span>
      <span class="tn">${n}</span>
    </div>`).join('');

  const maxA = sortedAreas[0]?.n || 1;
  $('area-tally').innerHTML = sortedAreas.map(({ a, n }) => `
    <div class="tally-row">
      <span>${a.emoji} ${a.name}</span>
      <span class="tbar"><i style="width:${(n / maxA) * 100}%"></i></span>
      <span class="tn">${n}</span>
    </div>`).join('');
}

// 같은 탭 세션 동안은 PIN 재입력 없이 유지
try {
  if (sessionStorage.getItem(SESSION_KEY) === '1') unlock();
  else $('pin-input').focus();
} catch {
  $('pin-input').focus();
}
