// Firebase 웹 설정 — 이 파일만 채우면 실시간 동기화가 켜집니다.
//
// 채우는 법:
//   1) https://console.firebase.google.com 에서 프로젝트 생성
//   2) 웹 앱(</>) 추가 → firebaseConfig 객체 복사
//   3) 아래 빈 문자열 자리에 붙여넣기
//   4) Firestore Database 생성 (위치: asia-northeast3) 후 보안 규칙 적용
//
// 비워두면 자동으로 '로컬 모드'로 동작합니다 (같은 기기 안에서만 결과 공유).
// 이 키들은 공개돼도 되는 값입니다. 실제 보안은 Firestore 보안 규칙이 담당합니다.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC6eR4-m47x4yz47v4Jdwzv_f_dsHCjZRg',
  authDomain: 'light-7a28b.firebaseapp.com',
  projectId: 'light-7a28b',
  storageBucket: 'light-7a28b.firebasestorage.app',
  messagingSenderId: '860382941631',
  appId: '1:860382941631:web:0b7e5ff8b13c27ecbc110a'
};

// 상담자용 화면 진입 PIN. 부스 운영자만 아는 값으로 바꿔서 쓰세요.
export const STAFF_PIN = '2026';
