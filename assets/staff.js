// 상담자용 앱 — 실시간 참여자 목록 · 상담 가이드 · 당일 집계

import { getArea, getStrength, findStrength, SCALE } from './data.js';
import { rankStrengths, explainAnswers, MAX_SCORE, MIN_SCORE } from './scoring.js';
import { subscribeResults, todayKey, initStore, getMode } from './store.js';
import { STAFF_PIN } from './firebase-config.js';

const SESSION_KEY = 'booth:staff-ok';
const $ = (id) => document.getElementById(id);

let rows = [];
let selectedId = null;
let unsubscribe = null;
let watchToken = 0;

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
  // 날짜를 연속으로 바꾸면 구독 요청이 겹칠 수 있다.
  // 토큰으로 최신 요청만 살려서 오래된 구독이 목록을 덮어쓰지 않게 한다.
  const token = ++watchToken;

  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  rows = [];
  selectedId = null;
  render();

  // DB가 없거나 프로젝트 설정이 틀리면 onSnapshot이 오류도 내지 않고
  // 무한 재시도만 한다. 그러면 배지가 '확인 중'에 멈춰 상담자가 원인을
  // 알 수 없으므로, 응답이 없으면 시간을 재서 알려준다.
  let answered = false;
  const watchdog = setTimeout(() => {
    if (!answered && token === watchToken) {
      setPill('error', new Error('서버 응답 없음 — Firestore 데이터베이스 생성/보안 규칙을 확인하세요'));
    }
  }, 10000);

  const stop = await subscribeResults(
    dateKey,
    (list) => {
      if (token !== watchToken) return;
      rows = list;
      render();
    },
    (status, err) => {
      if (token !== watchToken) return;
      // 'cache'는 아직 서버에 닿지 못한 상태이므로 감시를 유지한다
      if (status !== 'cache') { answered = true; clearTimeout(watchdog); }
      setPill(status, err);
    }
  );

  if (token !== watchToken) { stop(); return; }
  unsubscribe = stop;
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
  if (getMode() !== 'cloud') setPill('local');

  watch(today);
}

/**
 * 연결 상태 표시.
 * SDK 초기화 성공만으로 '연결됨'이라고 하면 DB가 없거나 규칙이 막혀 있어도
 * 연결된 것처럼 보인다. 실제 서버 스냅샷을 받은 뒤에만 초록으로 바꾼다.
 */
function setPill(status, err) {
  const pill = $('mode-pill');
  if (status === 'live') {
    pill.textContent = '실시간 연결됨';
    pill.className = 'pill';
    pill.title = '';
  } else if (status === 'cache') {
    pill.textContent = '서버 응답 대기 중';
    pill.className = 'pill off';
  } else if (status === 'local') {
    pill.textContent = '로컬 모드 (이 기기만)';
    pill.className = 'pill off';
  } else {
    pill.textContent = '연결 실패 — 폰 결과가 안 넘어옵니다';
    pill.className = 'pill off';
    pill.title = err ? String(err.code || err.message || err) : '';
    console.warn('[staff] 연결 실패', err);
  }
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

  // 문항별 응답을 강점별로 모아둔다 (옛 기록은 answers가 없어 빈 배열)
  const byStrength = new Map();
  explainAnswers(row.areaId, row.answers).forEach((q) => {
    if (!byStrength.has(q.strengthId)) byStrength.set(q.strengthId, []);
    byStrength.get(q.strengthId).push(q);
  });

  const cards = top.map((id, i) => {
    const s = getStrength(row.areaId, id);
    const score = row.scores[id];
    const rank = ranked.findIndex((r) => r.id === id) + 1;
    const it = s.interpret;

    // 높게 답한 문항이 위로 오게. 강점 안에서 어디가 두드러지는지 한눈에 보인다.
    const answered = (byStrength.get(id) || []).slice().sort((a, b) => b.value - a.value);

    const itemRows = answered.map((q) => {
      const label = SCALE.find((sc) => sc.value === q.value);
      return `
        <li class="ans ${q.value >= 4 ? 'high' : q.value <= 2 ? 'low' : ''}">
          <span class="v">${label ? label.label : q.value}</span>
          <span class="q">${s.items[q.itemIndex]}</span>
        </li>`;
    }).join('');

    // 같은 강점 안에서 응답이 갈리면 그 자체가 해석거리다
    const inner = innerPattern(answered, s);

    // 함께 나타나는 강점 중 이 학생에게도 상위로 나온 것을 표시
    const pairs = it.pairs.map((pid) => {
      const found = findStrength(pid);
      if (!found) return null;
      const alsoTop = top.includes(pid);
      const sameArea = found.area.id === row.areaId;
      return `<span class="pair ${alsoTop ? 'on' : ''}">${found.strength.emoji} ${found.strength.name}` +
             `${sameArea ? '' : ` <em>${found.area.name}</em>`}${alsoTop ? ' · 이 학생도 상위' : ''}</span>`;
    }).filter(Boolean).join('');

    // 1위는 주 유형으로 특징을 펼치고, 2·3위는 그 유형에 더해지는 결로 붙인다
    const others = i !== 0 ? '' : top.slice(1).map((oid) => {
      const os = getStrength(row.areaId, oid);
      const orank = ranked.findIndex((r) => r.id === oid) + 1;
      return `<li>
        <span class="on-name">${os.emoji} ${os.name}</span>
        <span class="on-sc">${row.scores[oid]}점 · ${orank}위</span>
        <span class="on-add">${os.interpret.adds}</span>
      </li>`;
    }).join('');

    return `
      <div class="guide-card ${i === 0 ? 'main' : ''}">
        <span class="tag">${i === 0 ? '주 유형' : `TOP ${i + 1}`}</span>
        <h3>${s.emoji} ${s.name}${i === 0 ? ' 유형' : ''}</h3>
        <div class="sc-line">${s.via} · 덕목 ${it.virtue} · ${score} / ${MAX_SCORE}점 · 6개 중 ${rank}위</div>

        <div class="traits">
          <div class="ih">${i === 0 ? '이 유형의 특징' : '이 강점의 특징'}</div>
          <ul>${s.interpret.traits.map((t) => `<li>${t}</li>`).join('')}</ul>
        </div>

        ${others ? `
          <div class="interp">
            <div class="ih">함께 나온 강점이 더하는 것</div>
            <ul class="others">${others}</ul>
          </div>` : ''}

        <div class="interp">
          <div class="ih">학생 폰에 뜬 결과 — 같이 보세요</div>
          <div class="phone-echo">
            <p>${s.result}</p>
            <p class="echo-action"><b>살리는 법 ·</b> ${s.action}</p>
          </div>
        </div>

        <details class="bg">
          <summary>배경 — VIA 해석과 응답 내역</summary>

          <div class="interp">
            <div class="ih">이 강점이 재는 것</div>
            <p>${it.core}</p>
          </div>

          <div class="interp two">
            <div>
              <div class="ih ok">잘 쓰이고 있을 때</div>
              <p>${it.optimal}</p>
            </div>
            <div>
              <div class="ih warn">균형이 무너지면</div>
              <p><b>지나칠 때</b> ${it.overuse}<br><b>못 쓸 때</b> ${it.underuse}</p>
            </div>
          </div>

          ${answered.length ? `
            <div class="interp">
              <div class="ih">문항별 응답</div>
              <ul class="answers">${itemRows}</ul>
              ${inner ? `<p class="inner-note">${inner}</p>` : ''}
            </div>` : `<p class="muted" style="margin-top:12px">이 기록에는 문항별 응답이 없습니다(구버전).</p>`}

          <div class="interp">
            <div class="ih">함께 나타나는 강점</div>
            <div class="pairs">${pairs}</div>
          </div>
        </details>
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
    ${readPattern(row, ranked, area)}
    ${cards}
    <h3 style="font-size:16px;margin:22px 0 12px">강점 6개 전체 점수</h3>
    <div class="tally">${all}</div>`;
}

/** 5점 척도 값 -> 보기 문구 */
function labelOf(v) {
  const found = SCALE.find((sc) => sc.value === v);
  return found ? found.label : String(v);
}

/** 목적격 조사 — 앞말 받침에 따라 을/를 */
function objectParticle(word) {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) return '을(를)';
  return (code - 0xAC00) % 28 === 0 ? '를' : '을';
}

/**
 * 한 강점 안에서 응답이 갈리는지 본다. 4문항이 모두 같은 강점을 재는데도
 * 답이 벌어지면 그 강점의 어느 면은 자기 것으로 느끼고 어느 면은 아니라는
 * 뜻이므로, 합산 점수만 볼 때는 사라지는 정보다.
 */
function innerPattern(answered, s) {
  if (answered.length < 4) return '';
  const hi = answered[0];
  const lo = answered[answered.length - 1];
  if (hi.value - lo.value < 2) {
    return hi.value >= 4
      ? '네 문항에 고르게 높이 답했습니다. 이 강점을 전반적으로 자기 것으로 느끼고 있습니다.'
      : '네 문항 응답이 고릅니다. 특별히 두드러지는 면 없이 비슷하게 답했습니다.';
  }
  return `같은 강점인데 "${s.items[hi.itemIndex]}"에는 높게, ` +
         `"${s.items[lo.itemIndex]}"에는 낮게 답했습니다. ` +
         '강점 안에서도 편차가 있다는 뜻이라, 어느 쪽이 실제 모습에 가까운지 확인해볼 만합니다.';
}

/**
 * 응답 분포에서만 읽히는 것들. 학생의 성격·배경을 추측하지 않고,
 * 이 결과가 무엇을 말해주고 무엇을 말해주지 않는지만 짚는다.
 */
function readPattern(row, ranked, area) {
  const values = ranked.map((r) => r.score);
  const hi = values[0];
  const lo = values[values.length - 1];
  const spread = hi - lo;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const notes = [];

  if (spread >= 8) {
    notes.push(`1위 ${hi}점과 6위 ${lo}점의 차이가 ${spread}점으로 뚜렷합니다. 순위에 본인도 동의하는지 물어보기 좋은 결과입니다.`);
  } else if (spread <= 3) {
    notes.push(`6개 강점이 ${spread}점 차이로 고릅니다. 순위를 강조하기보다 "이 중에 어떤 게 제일 너 같아?"라고 직접 물어보세요.`);
  }

  if (mean >= MAX_SCORE - 4) {
    notes.push(`전체 평균 ${mean.toFixed(1)}점으로 전반적으로 높게 응답했습니다. 점수 차이가 작을 수 있으니 숫자보다 이야기에 무게를 두세요.`);
  } else if (mean <= MIN_SCORE + 4) {
    notes.push(`전체 평균 ${mean.toFixed(1)}점으로 전반적으로 낮게 응답했습니다. 낮은 점수를 부족함으로 읽지 말고, 그중 높게 답한 문항부터 짚어주세요.`);
  }

  notes.push(`4개 영역 중 "${area.name}"${objectParticle(area.name)} 골랐습니다. 그 선택 자체를 물어보면 요즘 관심사가 나옵니다.`);

  return `<div class="pattern">
    <div class="pattern-h">이 결과에서 읽을 수 있는 것</div>
    <ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  </div>`;
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
