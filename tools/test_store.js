// node tools/test_store.js — Store / Scheduler 逻辑自测
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var SRC = path.join(__dirname, '..', 'src');
var seed = JSON.parse(fs.readFileSync(path.join(SRC, 'seed.json'), 'utf8'));

function load(withLS) {
  var ctx = { console: console, Date: Date, Math: Math, JSON: JSON, performance: globalThis.performance };
  if (withLS) {
    var data = {};
    ctx.localStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }, _data: data
    };
  }
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'store.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'scheduler.js'), 'utf8'), ctx);
  return ctx;
}

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + name); }
}
function section(n) { console.log('# ' + n); }
function allFull(S) { return S.planStatus().every(function (x) { return x.placed === x.plan.hours; }); }

var ctx = load(false), S = ctx.Store, Sch = ctx.Scheduler;
// 无 localStorage 时内存降级在同一上下文内会保留状态，故各段用全新上下文
function reinit() { ctx = load(false); S = ctx.Store; Sch = ctx.Scheduler; S.init(seed); }
S.init(seed);

section('初始状态');
ok(S.get().lessons.length === 262, '初始 262 节');
ok(S.conflicts().length === 0, '初始无冲突');
ok(allFull(S), 'planStatus 全部 placed==hours');
ok(S.get() !== seed && S.get().lessons !== seed.lessons, 'init 深拷贝 seed');
ok(!S.canUndo() && !S.canRedo(), '初始无历史');
ok(S.lookup('teachers', 't1').name === seed.teachers[0].name, 'lookup');
ok(S.lookup('classes', 'nope') === undefined, 'lookup 不存在返回 undefined');

section('subscribe 通知');
var notes = 0, unsub = S.subscribe(function () { notes++; });

section('setLesson / clearLesson');
var c1 = 'c1';
var empties = [];
for (var d = 0; d < 5; d++) for (var p = 0; p < 6; p++) if (!S.lessonAt(c1, d, p)) empties.push([d, p]);
ok(empties.length === 4, 'c1 有 4 个空格');
var e = empties[0];
var n0 = notes;
var nl = S.setLesson(c1, e[0], e[1], { subjectId: 's3', teacherId: null });
ok(nl && nl.id && nl.locked === false && nl.teacherId === null, '新建 lesson，locked 默认 false');
ok(notes === n0 + 1, 'setLesson 通知一次');
ok(S.get().lessons.length === 263, '263 节');
var occ = S.lessonAt(c1, 0, 0), occId = occ.id;
var ov = S.setLesson(c1, 0, 0, { subjectId: 's2', teacherId: 't2' });
ok(ov.id === occId && ov.subjectId === 's2' && ov.teacherId === 't2', '覆盖保留 id');
ok(S.get().lessons.length === 263, '覆盖不增加条数');
ok(occ.subjectId !== 's2' || occ.teacherId !== 't2', '旧对象未被原地修改');
ok(S.clearLesson(c1, e[0], e[1]) === true && !S.lessonAt(c1, e[0], e[1]), 'clearLesson');
ok(S.clearLesson(c1, e[0], e[1]) === false, '清空空格返回 false');
S.undo(); S.undo(); S.undo();
ok(!S.lessonAt(c1, e[0], e[1]), 'undo 三步还原新建');
ok(S.lessonAt(c1, 0, 0).id === occId && S.lessonAt(c1, 0, 0).subjectId === occ.subjectId, 'undo 还原覆盖');

section('moveLesson / swap');
var a = S.lessonAt(c1, 0, 0), b = S.lessonAt(c1, 0, 1);
S.moveLesson({ classId: c1, day: 0, period: 0 }, { classId: c1, day: 0, period: 1 });
ok(S.lessonAt(c1, 0, 1).id === a.id && S.lessonAt(c1, 0, 0).id === b.id, '目标有课则互换');
var len = S.get().lessons.length;
S.moveLesson({ classId: c1, day: 0, period: 1 }, { classId: c1, day: e[0], period: e[1] });
ok(S.lessonAt(c1, e[0], e[1]).id === a.id && !S.lessonAt(c1, 0, 1), '移动到空格');
ok(S.get().lessons.length === len, '移动不改变总数');
ok(S.moveLesson({ classId: c1, day: 0, period: 1 }, { classId: c1, day: 0, period: 2 }) === false, '源格为空返回 false');
S.undo(); S.undo();
ok(S.lessonAt(c1, 0, 0).id === a.id && S.lessonAt(c1, 0, 1).id === b.id, 'undo 两步还原');

section('toggleLock');
ok(S.toggleLock(a.id) === true && S.lookup('lessons', a.id).locked === true, '锁定');
S.toggleLock(a.id);
ok(S.lookup('lessons', a.id).locked === false, '解锁');

section('冲突检测');
// 找 t1 在 c1 的一节，把另一个班同一时段改成 t1
var lt = S.teacherLessons('t1').filter(function (l) { return l.classId === 'c1'; })[0];
var other = S.lessonAt('c3', lt.day, lt.period);
var cp = S.checkPlacement('c3', lt.day, lt.period, 't1');
ok(cp.length === 1 && cp[0].id === lt.id, 'checkPlacement 返回将冲突的课');
ok(S.checkPlacement('c1', lt.day, lt.period, 't1').length === 0, 'checkPlacement 排除本格');
ok(S.checkPlacement('c3', lt.day, lt.period, null).length === 0, 'teacherId null 不冲突');
S.setLesson('c3', lt.day, lt.period, { subjectId: other.subjectId, teacherId: 't1' });
var cf = S.conflicts();
ok(cf.length === 1 && cf[0].type === 'teacher' && cf[0].teacherId === 't1' && cf[0].lessonIds.length === 2, 'conflicts 发现冲突');
ok(!allFull(S), '改动后 planStatus 不再全满');
S.undo();
ok(S.conflicts().length === 0 && allFull(S), 'undo 后冲突消失');
// null 老师不计冲突
S.transaction(function () {
  S.setLesson('c3', 0, 0, { subjectId: 's3', teacherId: null });
  S.setLesson('c4', 0, 0, { subjectId: 's3', teacherId: null });
});
ok(S.conflicts().length === 0, 'teacherId 为 null 不计冲突');
S.undo();

section('transaction');
var n1 = notes, h1 = 0;
S.transaction(function () {
  S.clearLesson('c3', 0, 0); S.clearLesson('c3', 0, 1);
  S.setLesson('c3', 0, 0, { subjectId: 's1', teacherId: null });
  ok(S.lessonAt('c3', 0, 0).subjectId === 's1', '事务内可读到草稿');
  S.transaction(function () { S.clearLesson('c3', 0, 2); });
});
ok(notes === n1 + 1, '事务只通知一次');
ok(!S.lessonAt('c3', 0, 1) && !S.lessonAt('c3', 0, 2), '事务生效');
S.undo();
ok(S.lessonAt('c3', 0, 1) && S.lessonAt('c3', 0, 2) && allFull(S), '事务一步撤销');
ok(S.canRedo(), 'canRedo');
S.redo(); ok(!S.lessonAt('c3', 0, 1), 'redo');
S.undo();
var cnt = S.get().lessons.length;
try { S.transaction(function () { S.clearLesson('c3', 0, 0); throw new Error('x'); }); } catch (er) {}
ok(S.get().lessons.length === cnt && S.lessonAt('c3', 0, 0), '事务异常回滚');
var n2 = notes; S.transaction(function () { S.clearLesson('c1', e[0], e[1]); });
ok(notes === n2, '无实际变更的事务不通知');

section('撤销深度 ≥50');
reinit();
for (var i = 0; i < 60; i++) S.setMeta({ title: 'T' + i });
var k = 0; while (S.undo()) k++;
ok(k >= 50, '可撤销 ' + k + ' 步');
ok(S.get().meta.title === seed.meta.title, '撤销到初始');
for (i = 0; i < 5; i++) S.redo();
ok(S.get().meta.title === 'T4', 'redo 5 步');
S.setMeta({ title: 'X' });
ok(!S.canRedo(), '新变更清空 redo');

section('级联删除');
reinit();
var t1Count = S.teacherLessons('t1').length;
S.remove('teachers', 't1');
var st = S.get();
ok(!S.lookup('teachers', 't1'), '老师已删');
ok(st.lessons.length === 262, '删老师不删课');
ok(st.lessons.filter(function (l) { return l.teacherId === 't1'; }).length === 0, 'lessons teacherId 置 null');
ok(st.lessons.filter(function (l) { return l.teacherId === null; }).length === t1Count, '置 null 数量正确');
ok(st.plans.every(function (p) { return p.teacherId !== 't1'; }), 'plans teacherId 置 null');
ok(S.lookup('classes', 'c1').headTeacherId === null, '班主任置 null');
S.undo();
ok(S.lookup('teachers', 't1') && S.lookup('classes', 'c1').headTeacherId === 't1', 'undo 恢复老师');
S.remove('classes', 'c3');
st = S.get();
ok(st.classes.length === 8 && !st.plans.some(function (p) { return p.classId === 'c3'; }) &&
  !st.lessons.some(function (l) { return l.classId === 'c3'; }) && st.lessons.length === 232, '删班级级联 plans/lessons');
S.undo();
var s2n = seed.lessons.filter(function (l) { return l.subjectId === 's2'; }).length;
S.remove('subjects', 's2');
st = S.get();
ok(!st.plans.some(function (p) { return p.subjectId === 's2'; }) && st.lessons.length === 262 - s2n, '删科目级联');
S.undo();
ok(S.get().lessons.length === 262 && allFull(S), 'undo 全部恢复');

section('add / update');
var nt = S.add('teachers', { name: '新老师' });
ok(nt.id && S.lookup('teachers', nt.id).name === '新老师' && nt.note === '', 'add 生成 id 与默认字段');
S.update('teachers', nt.id, { name: '改名', id: 'hack' });
ok(S.lookup('teachers', nt.id).name === '改名' && !S.lookup('teachers', 'hack'), 'update 不改 id');
var np = S.add('plans', { classId: 'c1', subjectId: 's3', hours: 1 });
ok(np.teacherId === null, 'plan teacherId 默认 null');
S.remove('plans', np.id);
ok(S.remove('plans', 'nope') === false, '删不存在返回 false');
var ids = {}, dup = false;
for (i = 0; i < 2000; i++) { var u = S.uid('x'); if (ids[u]) dup = true; ids[u] = 1; }
ok(!dup, 'uid 唯一');

section('减少 periods / days');
reinit();
S.setSettings({ periods: ['1', '2', '3', '4', '5'] });
st = S.get();
ok(st.lessons.every(function (l) { return l.period < 5; }), '越界 lesson 已删（periods）');
ok(st.lessons.length === 262 - seed.lessons.filter(function (l) { return l.period >= 5; }).length, '删除数量正确');
S.setSettings({ days: ['一', '二', '三', '四'] });
ok(S.get().lessons.every(function (l) { return l.day < 4; }), '越界 lesson 已删（days）');
S.undo(); S.undo();
ok(S.get().lessons.length === 262 && S.get().settings.periods.length === 6, 'undo 恢复设置与课');

section('teacherLoad');
var tl = S.teacherLoad();
ok(tl.length === seed.teachers.length, '每位老师一条');
var tot = tl.reduce(function (s, x) { return s + x.total; }, 0);
ok(tot === 262, '课时合计 262');
var x1 = tl.filter(function (x) { return x.teacher.id === 't1'; })[0];
ok(Object.keys(x1.byClass).reduce(function (s, c) { return s + x1.byClass[c]; }, 0) === x1.total, 'byClass 合计');

section('replaceAll / resetToSeed');
S.replaceAll({ settings: { days: ['一'], periods: ['1'] }, classes: [{ id: 'z', name: 'Z' }], subjects: [{ id: 'q', name: 'Q' }],
  lessons: [{ classId: 'z', day: 0, period: 0, subjectId: 'q' }, { classId: 'z', day: 3, period: 0, subjectId: 'q' }] });
ok(S.get().lessons.length === 1 && S.get().lessons[0].locked === false, 'replaceAll 规范化');
S.undo();
ok(S.get().lessons.length === 262, 'replaceAll 可撤销');
S.setMeta({ title: 'Y' }); S.resetToSeed();
ok(S.get().meta.title === seed.meta.title && S.canUndo(), 'resetToSeed 可撤销');

section('Scheduler：清空某班后重排');
reinit();
S.transaction(function () { for (var d = 0; d < 5; d++) for (var p = 0; p < 6; p++) S.clearLesson('c5', d, p); });
ok(S.classLessons('c5').length === 0, 'c5 已清空');
var t = Date.now();
var r = Sch.run({ classIds: ['c5'], seed: 1 });
var ms = Date.now() - t;
ok(r.placed === 30 && r.unplaced.length === 0, 'c5 排满 30 节（placed=' + r.placed + '）');
ok(S.conflicts().length === 0, '无冲突');
ok(allFull(S), 'planStatus 全满');
ok(r.changes.length === 30, 'changes 30 条');
S.undo();
ok(S.classLessons('c5').length === 0, 'run 一步撤销');
console.log('  单班耗时 ' + ms + 'ms');

section('Scheduler：全部班级 keepExisting=false');
reinit();
var lockId = S.lessonAt('c3', 0, 0).id; S.toggleLock(lockId);
var lockSnap = JSON.stringify(S.lookup('lessons', lockId));
var worst = 0, allOk = true, softInfo = [];
for (var sd = 1; sd <= 5; sd++) {
  t = Date.now();
  r = Sch.run({ keepExisting: false, seed: sd });
  ms = Date.now() - t; worst = Math.max(worst, ms);
  var good = r.unplaced.length === 0 && S.conflicts().length === 0 && allFull(S) &&
    JSON.stringify(S.lookup('lessons', lockId)) === lockSnap;
  if (!good) { allOk = false; console.log('  seed ' + sd + ' unplaced=' + JSON.stringify(r.unplaced.map(function (u) { return u.plan.id + ':' + u.missing; }))); }
  // 软约束统计
  var st2 = S.get(), over = 0, consec = 0, late = 0;
  var subName = {}; st2.subjects.forEach(function (s) { subName[s.id] = s.name; });
  var grid = {}; st2.lessons.forEach(function (l) { grid[l.classId + '|' + l.day + '|' + l.period] = l; });
  st2.classes.forEach(function (c) {
    for (var d = 0; d < 5; d++) {
      var cc = {};
      for (var p = 0; p < 6; p++) {
        var l = grid[c.id + '|' + d + '|' + p]; if (!l) continue;
        cc[l.subjectId] = (cc[l.subjectId] || 0) + 1;
        var pl = grid[c.id + '|' + d + '|' + (p - 1)];
        if (pl && pl.subjectId === l.subjectId) consec++;
        if (/语文|数学/.test(subName[l.subjectId]) && p >= 3) late++;
      }
      Object.keys(cc).forEach(function (s) { if (cc[s] > 2) over++; });
    }
  });
  softInfo.push('seed' + sd + ':' + ms + 'ms 超上限' + over + ' 连堂' + consec + ' 语数下午' + late);
  S.undo();
}
console.log('  ' + softInfo.join(' | '));
ok(allOk, '5 次全量重排均排满、无冲突、锁定课不动');
ok(worst < 1000, '全量排课 < 1 秒（最慢 ' + worst + 'ms）');
ok(S.get().lessons.length === 262 && allFull(S), '撤销后恢复');

section('Scheduler：keepExisting=true 不动已有课');
reinit();
var before = JSON.stringify(S.get().lessons);
r = Sch.run({});
ok(r.placed === 0 && r.changes.length === 0 && r.unplaced.length === 0, '已排满时无操作');
ok(JSON.stringify(S.get().lessons) === before && !S.canUndo(), '无变化不产生撤销步');
// 删几节后补排
S.transaction(function () { S.clearLesson('c3', 1, 1); S.clearLesson('c3', 2, 3); S.clearLesson('c4', 4, 5); });
var keepIds = S.get().lessons.map(function (l) { return l.id + l.day + l.period; }).sort().join();
r = Sch.run({ seed: 3 });
ok(r.placed === 3 && r.unplaced.length === 0 && S.conflicts().length === 0 && allFull(S), '补排 3 节');
ok(keepIds.split(',').every(function (k) { return S.get().lessons.some(function (l) { return l.id + l.day + l.period === k; }); }), '原有课未被移动');

section('Scheduler：容量不足报告 unplaced');
reinit();
S.add('plans', { classId: 'c3', subjectId: 's1', teacherId: null, hours: 2 });
r = Sch.run({ classIds: ['c3'] });
ok(r.unplaced.length === 1 && r.unplaced[0].missing === 2, '满班无空格时 unplaced missing=2');

section('Scheduler.suggest');
reinit();
S.clearLesson('c5', 2, 2);
var sg = Sch.suggest('c5', 2, 2);
ok(sg.length === S.get().plans.filter(function (p) { return p.classId === 'c5'; }).length, '返回该班全部任务');
ok(sg[0].missing > 0 && sg[0].ok === true, '未排满且可放的排最前');
ok(sg.every(function (x) { return typeof x.reason === 'string' && typeof x.ok === 'boolean' && x.plan; }), '字段齐全');
var bad = sg.filter(function (x) { return !x.ok; });
ok(bad.every(function (x) { return S.checkPlacement('c5', 2, 2, x.plan.teacherId).length > 0; }), 'ok=false 均因老师冲突');

section('localStorage 持久化与快照');
var ctx2 = load(true), S2 = ctx2.Store;
S2.init(seed);
S2.setMeta({ title: '持久化测试' });
ok(JSON.parse(ctx2.localStorage._data['paike.state.v1']).meta.title === '持久化测试', '写入 paike.state.v1');
S2.init(seed);
ok(S2.get().meta.title === '持久化测试', 'init 读取 localStorage');
var sn = S2.saveSnapshot('方案A');
ok(sn.id && S2.snapshots().length === 1 && S2.snapshots()[0].name === '方案A', 'saveSnapshot');
ok(!!ctx2.localStorage._data['paike.snapshots.v1'], '写入 paike.snapshots.v1');
S2.clearLesson('c3', 0, 0);
ok(S2.restoreSnapshot(sn.id) === true && S2.lessonAt('c3', 0, 0), 'restoreSnapshot');
S2.undo();
ok(!S2.lessonAt('c3', 0, 0), 'restoreSnapshot 可撤销');
ok(S2.deleteSnapshot(sn.id) === true && S2.snapshots().length === 0, 'deleteSnapshot');
// 抛异常的 localStorage
var ctx3 = load(true);
ctx3.localStorage.getItem = function () { throw new Error('denied'); };
ctx3.localStorage.setItem = function () { throw new Error('quota'); };
var S3 = ctx3.Store; S3.init(seed);
S3.setMeta({ title: 'm' });
ok(S3.get().meta.title === 'm' && S3.get().lessons.length === 262, 'localStorage 抛异常时降级内存');
var sn3 = S3.saveSnapshot('B');
ok(S3.snapshots().length === 1 && sn3.persisted === false, '快照内存降级');
ok(S.saveSnapshot('无LS').id && S.snapshots().length >= 1, '无 localStorage 环境快照可用');
// 损坏数据
var ctx4 = load(true); ctx4.localStorage.setItem('paike.state.v1', '{bad json');
ctx4.Store.init(seed);
ok(ctx4.Store.get().lessons.length === 262, '损坏数据回退 seed');

section('性能 O(n)');
reinit();
t = Date.now();
for (i = 0; i < 200; i++) { S.setMeta({ title: 'p' + i }); S.conflicts(); S.planStatus(); }
ms = Date.now() - t;
ok(ms < 1500, '200 次 变更+conflicts+planStatus 用时 ' + ms + 'ms');

unsub();
console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
