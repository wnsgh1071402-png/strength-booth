// 임시 검증 스크립트 (실행 후 삭제)
import { AREAS, findStrength } from './assets/data.js';
import { buildQuestions, scoreAnswers, pickTop } from './assets/scoring.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL: ' + msg); fail++; } };

console.log('=== 1. 데이터 구조 ===');
ok(AREAS.length === 4, `영역 4개 (실제 ${AREAS.length})`);

const ids = [], vias = [], items = [], virtues = [], traits = [];
for (const a of AREAS) {
  ok(a.strengths.length === 6, `${a.name}: 강점 6개 (실제 ${a.strengths.length})`);
  ok(!!a.emoji && !!a.tagline, `${a.name}: emoji/tagline`);
  for (const s of a.strengths) {
    ok(s.items.length === 4, `${a.name}/${s.name}: 문항 4개 (실제 ${s.items.length})`);
    const it = s.interpret;
    ok(!!it, `${a.name}/${s.name}: interpret 누락`);
    for (const f of ['virtue', 'say', 'core', 'optimal', 'overuse', 'underuse']) {
      ok(typeof it?.[f] === 'string' && it[f].length > 0, `${a.name}/${s.name}: interpret.${f} 누락`);
    }
    ok(Array.isArray(it?.pairs) && it.pairs.length === 3, `${a.name}/${s.name}: pairs 3개`);
    ok(Array.isArray(it?.traits) && it.traits.length === 4, `${a.name}/${s.name}: traits 4개`);
    ok(typeof it?.adds === 'string' && it.adds.length > 0, `${a.name}/${s.name}: adds 누락`);
    const mt = it?.match;
    ok(!!mt, `${a.name}/${s.name}: match 누락`);
    if (mt) {
      // 궁합은 반드시 같은 영역 6개 안에서 골라야 한다.
      // 다른 영역을 가리키면 같은 검사를 한 친구끼리 맞춰볼 수 없다.
      const ids6 = a.strengths.map((x) => x.id);
      ok(ids6.includes(mt.friend), `${a.name}/${s.name}: match.friend '${mt.friend}'가 이 영역 밖`);
      ok(ids6.includes(mt.partner), `${a.name}/${s.name}: match.partner '${mt.partner}'가 이 영역 밖`);
      ok(mt.friend !== s.id && mt.partner !== s.id, `${a.name}/${s.name}: 자기 자신과 매칭됨`);
      ok(mt.friend !== mt.partner, `${a.name}/${s.name}: friend와 partner가 같음`);
      ok(mt.friendWhy?.length > 0 && mt.partnerWhy?.length > 0, `${a.name}/${s.name}: 궁합 설명 누락`);
      traits.push(...it.traits);
    }
    it?.pairs.forEach((pid) => {
      ok(!!findStrength(pid), `${a.name}/${s.name}: pairs의 '${pid}'를 찾을 수 없음`);
      ok(pid !== s.id, `${a.name}/${s.name}: pairs에 자기 자신 포함`);
    });
    virtues.push(it?.virtue);
    for (const f of ['id', 'name', 'emoji', 'via', 'short', 'result', 'action']) {
      ok(typeof s[f] === 'string' && s[f].length > 0, `${a.name}/${s.name}: ${f} 누락`);
    }
    ids.push(s.id);
    vias.push(s.via.split('(')[0].split('—')[0].trim());
    s.items.forEach((t) => items.push(t));
  }
}
const vset = [...new Set(virtues)].sort();
console.log(`  강점 ${ids.length}개 / 문항 ${items.length}개 / 해석 ${virtues.length}세트`);
console.log('  덕목:', vset.join(' · '));
ok(traits.length === 96, `유형 특징 96개 (실제 ${traits.length})`);
ok(new Set(traits).size === 96, `유형 특징 중복 (고유 ${new Set(traits).size})`);
ok(vset.length === 6, `VIA 6덕목 (실제 ${vset.length}개: ${vset})`);
const expect = { 지혜: 5, 용기: 4, 인간애: 3, 정의: 3, 절제: 4, 초월: 5 };
Object.entries(expect).forEach(([v, n]) => {
  const got = virtues.filter(x => x === v).length;
  ok(got === n, `덕목 '${v}' 강점 ${n}개여야 함 (실제 ${got})`);
});
ok(ids.length === 24, 'VIA 24개 강점');
ok(items.length === 96, '총 96문항');
ok(new Set(ids).size === 24, `강점 id 중복 (고유 ${new Set(ids).size})`);
ok(new Set(vias).size === 24, `VIA 근거 중복: ${vias.filter((v, i, ar) => ar.indexOf(v) !== i)}`);
ok(new Set(items).size === 96, `문항 문구 중복 (고유 ${new Set(items).size})`);

console.log('=== 2. 문항 셔플 (고정 시드) ===');
for (const a of AREAS) {
  const q1 = buildQuestions(a.id), q2 = buildQuestions(a.id);
  ok(q1.length === 24, `${a.name}: 24문항`);
  ok(JSON.stringify(q1) === JSON.stringify(q2), `${a.name}: 순서 재현성`);
  const cnt = {};
  q1.forEach((q) => { cnt[q.strengthId] = (cnt[q.strengthId] || 0) + 1; });
  ok(Object.values(cnt).every((n) => n === 4), `${a.name}: 강점당 4문항`);
  let maxRun = 1, run = 1;
  for (let i = 1; i < q1.length; i++) {
    run = q1[i].strengthId === q1[i - 1].strengthId ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }
  console.log(`  ${a.name}: 같은 강점 연속 최대 ${maxRun}개`);
  ok(maxRun <= 2, `${a.name}: 연속 3개 이상 발생`);
}

console.log('=== 3. 채점 경계값 ===');
for (const a of AREAS) {
  const hi = scoreAnswers(a.id, new Array(24).fill(5));
  const lo = scoreAnswers(a.id, new Array(24).fill(1));
  ok(Object.values(hi).every((v) => v === 20), `${a.name}: 전부 5점 → 각 20점`);
  ok(Object.values(lo).every((v) => v === 4), `${a.name}: 전부 1점 → 각 4점`);
}

console.log('=== 4. TOP3 정렬·동점 ===');
const area = AREAS[0];
const target = area.strengths[0].id;
const answers = buildQuestions(area.id).map((q) => (q.strengthId === target ? 5 : 1));
const top = pickTop(area.id, scoreAnswers(area.id, answers));
ok(top[0].id === target, `최고점이 1위 (실제 ${top[0].id})`);
ok(top[0].score === 20, '1위 20점');

const tie = pickTop(area.id, scoreAnswers(area.id, new Array(24).fill(3)));
ok(tie.length === 6, `전원 동점 시 전부 표시 (실제 ${tie.length})`);
ok(tie[0].id === area.strengths[0].id, '동점은 정의 순서 우선');

const custom = {};
area.strengths.forEach((s, i) => { custom[s.id] = [20, 18, 15, 15, 10, 8][i]; });
ok(pickTop(area.id, custom).length === 4, `3위 동점이면 4개 표시 (실제 ${pickTop(area.id, custom).length})`);

console.log(fail === 0 ? '\n✅ 전부 통과' : `\n❌ 실패 ${fail}건`);
process.exit(fail ? 1 : 0);
