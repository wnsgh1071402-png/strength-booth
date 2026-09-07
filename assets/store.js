// 결과 저장/구독 계층
//
// Firestore가 설정돼 있으면 클라우드 실시간 모드, 아니면 자동으로 로컬 모드.
// 두 모드가 같은 인터페이스를 쓰므로 화면 코드는 어느 쪽인지 신경 쓸 필요가 없다.

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LOCAL_PREFIX = 'booth:results:';
const SYNC_TIMEOUT = 8000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' 시간 초과')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

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
      await withTimeout(
        fs.addDoc(fs.collection(db, 'booths', dateKey, 'results'), {
          code: record.code,
          areaId: record.areaId,
          scores: record.scores,
          top3: record.top3,
          createdAt: fs.serverTimestamp()
        }),
        SYNC_TIMEOUT, '전송'
      );

      // addDoc은 서버에 닿지 못해도 로컬 큐에 넣고 resolve될 수 있다.
      // (DB 미생성·오프라인 등) 실제로 서버가 받았는지는 이걸로 확인해야
      // "선생님 화면에 떴다"는 안내를 거짓으로 하지 않는다.
      await withTimeout(fs.waitForPendingWrites(db), SYNC_TIMEOUT, '서버 확인');

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
 * @param onStatus 연결 상태 알림. 'live'(서버 응답 수신) | 'local' | 'error'
 * @returns {Promise<Function>} 구독 해제 함수
 */
export async function subscribeResults(dateKey, onChange, onStatus = () => {}) {
  await initStore();

  if (mode === 'cloud') {
    const q = fs.query(
      fs.collection(db, 'booths', dateKey, 'results'),
      fs.orderBy('createdAt', 'desc')
    );
    return fs.onSnapshot(
      q,
      (snap) => {
        // 서버에서 스냅샷이 실제로 온 시점에만 '연결됨'으로 본다.
        // SDK 초기화 성공만으로 판단하면 DB가 없어도 연결된 것처럼 보인다.
        onStatus(snap.metadata.fromCache ? 'cache' : 'live');
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
        onStatus('error', err);
        onChange(localRead(dateKey).slice().reverse());
      }
    );
  }

  onStatus('local');

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
