// 결과 저장/구독 계층
//
// Firestore가 설정돼 있으면 클라우드 실시간 모드, 아니면 자동으로 로컬 모드.
// 두 모드가 같은 인터페이스를 쓰므로 화면 코드는 어느 쪽인지 신경 쓸 필요가 없다.

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LOCAL_PREFIX = 'booth:results:';

let mode = 'local';      // 'cloud' | 'local'
let fs = null;           // firestore 모듈
let db = null;
let initPromise = null;

/** 로컬 시간 기준 YYYY-MM-DD (부스 세션 = 하루) */
export function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function isConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

export function getMode() {
  return mode;
}

export function initStore() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isConfigured()) return (mode = 'local');
    try {
      const [appMod, storeMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-firestore.js')
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      fs = storeMod;
      db = storeMod.getFirestore(app);
      mode = 'cloud';
    } catch (err) {
      console.warn('[store] Firestore 초기화 실패 — 로컬 모드로 전환합니다.', err);
      mode = 'local';
    }
    return mode;
  })();

  return initPromise;
}

// ── 로컬 모드 저장소 ────────────────────────────────────────

function localRead(dateKey) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFIX + dateKey) || '[]');
  } catch {
    return [];
  }
}

function localWrite(dateKey, rows) {
  try {
    localStorage.setItem(LOCAL_PREFIX + dateKey, JSON.stringify(rows));
  } catch (err) {
    console.warn('[store] 로컬 저장 실패', err);
  }
}

// ── 공개 API ───────────────────────────────────────────────

/**
 * 결과 제출.
 * @returns {Promise<{ok: boolean, mode: string}>}
 *   ok=false여도 결과 화면은 정상 표시된다(연결만 실패한 것).
 */
export async function submitResult(record) {
  const dateKey = todayKey();
  await initStore();

  if (mode === 'cloud') {
    try {
      await fs.addDoc(fs.collection(db, 'booths', dateKey, 'results'), {
        code: record.code,
        areaId: record.areaId,
        scores: record.scores,
        top3: record.top3,
        createdAt: fs.serverTimestamp()
      });
      return { ok: true, mode };
    } catch (err) {
      console.warn('[store] 전송 실패 — 로컬에만 남깁니다.', err);
      const rows = localRead(dateKey);
      rows.push({ ...record, id: 'local-' + record.createdAtLocal });
      localWrite(dateKey, rows);
      return { ok: false, mode };
    }
  }

  const rows = localRead(dateKey);
  rows.push({ ...record, id: 'local-' + record.createdAtLocal });
  localWrite(dateKey, rows);
  return { ok: true, mode: 'local' };
}

/**
 * 특정 날짜 결과 구독. 최신순 배열을 콜백으로 넘긴다.
 * @returns {Promise<Function>} 구독 해제 함수
 */
export async function subscribeResults(dateKey, onChange) {
  await initStore();

  if (mode === 'cloud') {
    const q = fs.query(
      fs.collection(db, 'booths', dateKey, 'results'),
      fs.orderBy('createdAt', 'desc')
    );
    return fs.onSnapshot(
      q,
      (snap) => {
        onChange(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAtLocal: data.createdAt?.toMillis?.() ?? Date.now()
          };
        }));
      },
      (err) => {
        console.warn('[store] 구독 오류', err);
        onChange(localRead(dateKey).slice().reverse());
      }
    );
  }

  // 로컬 모드: 같은 브라우저의 다른 탭 변경을 storage 이벤트로 감지 + 주기 확인
  const emit = () => onChange(localRead(dateKey).slice().reverse());
  emit();
  const onStorage = (e) => { if (e.key === LOCAL_PREFIX + dateKey) emit(); };
  window.addEventListener('storage', onStorage);
  const timer = setInterval(emit, 3000);

  return () => {
    window.removeEventListener('storage', onStorage);
    clearInterval(timer);
  };
}
