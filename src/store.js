/* store.js — window.Store：状态、撤销重做、持久化、快照（成员 A） */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var KEY_STATE = 'paike.state.v1';
  var KEY_SNAP = 'paike.snapshots.v1';
  var HISTORY_LIMIT = 100;
  var TYPES = ['classes', 'subjects', 'teachers', 'plans', 'lessons'];
  var DEFAULT_DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五'];
  var DEFAULT_PERIODS = ['第一节', '第二节', '第三节', '第四节', '第五节', '第六节'];

  var seedState = null;
  var cur = null;          // 当前（或事务中的草稿）state
  var base = null;         // 事务开始前的 state
  var depth = 0;           // 事务嵌套深度
  var changed = false;     // 事务内是否有实际变更
  var rev = 0;             // 每次变更自增，用于查询缓存失效
  var undoStack = [], redoStack = [];
  var subs = [];
  var memStore = {};       // localStorage 不可用时的内存降级
  var uidN = 0;

  /* ---------- 工具 ---------- */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function nz(v) { return v === undefined || v === '' ? null : v; }

  function ls() {
    try { var l = root.localStorage; return l && typeof l.getItem === 'function' ? l : null; } catch (e) { return null; }
  }
  function storeGet(key) {
    var l = ls();
    if (l) { try { var v = l.getItem(key); if (v != null) return v; } catch (e) {} }
    return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
  }
  function storeSet(key, val) {
    memStore[key] = val;
    var l = ls();
    if (!l) return false;
    try { l.setItem(key, val); return true; } catch (e) { return false; }
  }

  function uid(prefix) {
    uidN = (uidN + 1) % 1679616;
    return (prefix || 'id') + '_' + Date.now().toString(36) + uidN.toString(36) +
      Math.floor(Math.random() * 46656).toString(36);
  }

  /* ---------- 规范化 ---------- */
  function normClass(o, i) {
    return { id: o.id || uid('c'), name: String(o.name == null ? '' : o.name), grade: String(o.grade == null ? '' : o.grade),
      order: typeof o.order === 'number' ? o.order : i + 1, headTeacherId: nz(o.headTeacherId) };
  }
  function normSubject(o) {
    var c = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : '#90a4ae';
    return { id: o.id || uid('s'), name: String(o.name == null ? '' : o.name), color: c };
  }
  function normTeacher(o) {
    return { id: o.id || uid('t'), name: String(o.name == null ? '' : o.name), note: String(o.note == null ? '' : o.note) };
  }
  function normPlan(o) {
    var h = Number(o.hours);
    return { id: o.id || uid('p'), classId: o.classId, subjectId: o.subjectId, teacherId: nz(o.teacherId),
      hours: isFinite(h) && h > 0 ? Math.floor(h) : 0 };
  }
  function normLesson(o) {
    return { id: o.id || uid('l'), classId: o.classId, day: Number(o.day), period: Number(o.period),
      subjectId: o.subjectId, teacherId: nz(o.teacherId), locked: !!o.locked };
  }
  var NORM = { classes: normClass, subjects: normSubject, teachers: normTeacher, plans: normPlan, lessons: normLesson };

  function normalize(src) {
    var s = clone(src) || {};
    var st = s.settings || {};
    var out = {
      version: 1,
      meta: Object.assign({ title: '', school: '' }, s.meta || {}),
      settings: {
        days: Array.isArray(st.days) ? st.days.map(String) : DEFAULT_DAYS.slice(),
        periods: Array.isArray(st.periods) ? st.periods.map(String) : DEFAULT_PERIODS.slice(),
        breaks: Array.isArray(st.breaks) ? st.breaks.filter(function (b) { return b && isInt(Number(b.after)); })
          .map(function (b) { return { after: Number(b.after), label: String(b.label == null ? '' : b.label) }; }) : []
      },
      classes: [], subjects: [], teachers: [], plans: [], lessons: []
    };
    Object.keys(st).forEach(function (k) { if (!(k in out.settings)) out.settings[k] = st[k]; });
    var seen = {};
    function uniq(o, p) { if (!o.id || seen[o.id]) o.id = uid(p); seen[o.id] = 1; return o; }
    (s.classes || []).forEach(function (o, i) { if (o) out.classes.push(uniq(normClass(o, i), 'c')); });
    (s.subjects || []).forEach(function (o) { if (o) out.subjects.push(uniq(normSubject(o), 's')); });
    (s.teachers || []).forEach(function (o) { if (o) out.teachers.push(uniq(normTeacher(o), 't')); });
    var C = {}, S = {}, T = {};
    out.classes.forEach(function (o) { C[o.id] = 1; });
    out.subjects.forEach(function (o) { S[o.id] = 1; });
    out.teachers.forEach(function (o) { T[o.id] = 1; });
    out.classes.forEach(function (o) { if (o.headTeacherId && !T[o.headTeacherId]) o.headTeacherId = null; });
    (s.plans || []).forEach(function (o) {
      if (!o) return; var p = normPlan(o);
      if (!C[p.classId] || !S[p.subjectId]) return;
      if (p.teacherId && !T[p.teacherId]) p.teacherId = null;
      out.plans.push(uniq(p, 'p'));
    });
    var D = out.settings.days.length, P = out.settings.periods.length, cell = {};
    (s.lessons || []).forEach(function (o) {
      if (!o) return; var l = normLesson(o);
      if (!C[l.classId] || !S[l.subjectId]) return;
      if (!isInt(l.day) || !isInt(l.period) || l.day < 0 || l.period < 0 || l.day >= D || l.period >= P) return;
      var k = l.classId + '|' + l.day + '|' + l.period;
      if (cell[k]) return;
      cell[k] = 1;
      if (l.teacherId && !T[l.teacherId]) l.teacherId = null;
      out.lessons.push(uniq(l, 'l'));
    });
    return out;
  }

  /* ---------- 通知 / 持久化 ---------- */
  function persist() { try { storeSet(KEY_STATE, JSON.stringify(cur)); } catch (e) {} }
  function notify() {
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](cur); } catch (e) { if (root.console) console.error(e); }
    }
  }

  /* ---------- 事务核心 ---------- */
  function begin() {
    if (depth === 0) { base = cur; cur = clone(base); changed = false; rev++; }
    depth++;
  }
  function end(ok) {
    depth--;
    if (depth > 0) return;
    if (!ok || !changed) { cur = base; base = null; rev++; return; }
    mergeDuplicatePlans();
    undoStack.push(base);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    base = null;
    persist();
    notify();
  }
  // 同班同科同老师的教学任务合并为一条（换老师、删老师后可能出现），节数相加
  function mergeDuplicatePlans() {
    var seen = {}, out = [];
    cur.plans.forEach(function (p) {
      var k = p.classId + '|' + p.subjectId + '|' + (p.teacherId || '');
      if (seen[k]) { seen[k].hours += p.hours; rev++; } else { seen[k] = p; out.push(p); }
    });
    cur.plans = out;
  }
  function mark() { changed = true; rev++; }
  function mutate(fn) {
    begin();
    var ok = false;
    try { var r = fn(); ok = true; return r; } finally { end(ok); }
  }

  /* ---------- 查询缓存 ---------- */
  var cache = { rev: -1 };
  function idx() {
    if (cache.rev === rev && cache.state === cur) return cache;
    var c = { rev: rev, state: cur, cell: {}, byId: {}, tslot: {} };
    TYPES.forEach(function (t) {
      var m = {}; (cur[t] || []).forEach(function (o) { m[o.id] = o; }); c.byId[t] = m;
    });
    cur.lessons.forEach(function (l) {
      c.cell[l.classId + '|' + l.day + '|' + l.period] = l;
      if (l.teacherId != null) {
        var k = l.teacherId + '|' + l.day + '|' + l.period;
        (c.tslot[k] || (c.tslot[k] = [])).push(l);
      }
    });
    cache = c;
    return c;
  }
  function findIndex(type, id) {
    var arr = cur[type];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }
  function checkType(type) {
    if (TYPES.indexOf(type) < 0) throw new Error('未知类型：' + type);
  }
  function inRange(day, period) {
    return isInt(day) && isInt(period) && day >= 0 && period >= 0 &&
      day < cur.settings.days.length && period < cur.settings.periods.length;
  }

  /* ---------- 内部变更（须在 begin/end 内调用） ---------- */
  function removeLessonsWhere(pred) {
    var before = cur.lessons.length;
    cur.lessons = cur.lessons.filter(function (l) { return !pred(l); });
    if (cur.lessons.length !== before) mark();
  }
  function placeLesson(l) {
    // 同格已有课则先删除，保证每格最多一条
    var k = l.classId + '|' + l.day + '|' + l.period;
    var old = idx().cell[k];
    if (old && old.id !== l.id) removeLessonsWhere(function (x) { return x.id === old.id; });
  }

  /* ---------- API ---------- */
  var Store = root.Store = {};

  Store.init = function (seed) {
    seedState = normalize(seed || {});
    var loaded = null;
    try {
      var raw = storeGet(KEY_STATE);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && Array.isArray(obj.lessons)) loaded = normalize(obj);
      }
    } catch (e) { loaded = null; }
    cur = loaded || clone(seedState);
    base = null; depth = 0; changed = false; rev++;
    undoStack = []; redoStack = [];
    return cur;
  };

  Store.get = function () { return cur; };

  Store.subscribe = function (fn) {
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  };

  Store.uid = uid;

  Store.lookup = function (type, id) {
    checkType(type);
    return idx().byId[type][id];
  };

  Store.add = function (type, obj) {
    checkType(type);
    return mutate(function () {
      var o = NORM[type](Object.assign({}, obj || {}), cur[type].length);
      if (idx().byId[type][o.id]) o.id = uid(type.charAt(0));
      if (type === 'lessons') {
        if (!inRange(o.day, o.period)) throw new Error('节次超出范围');
        placeLesson(o);
      }
      if (type === 'plans' && o.teacherId === undefined) o.teacherId = null;
      cur[type].push(o);
      mark();
      return o;
    });
  };

  Store.update = function (type, id, patch) {
    checkType(type);
    return mutate(function () {
      var i = findIndex(type, id);
      if (i < 0) return undefined;
      var p = Object.assign({}, patch || {}); delete p.id;
      var o = NORM[type](Object.assign({}, cur[type][i], p), i);
      o.id = id;
      if (type === 'lessons') {
        if (!inRange(o.day, o.period)) throw new Error('节次超出范围');
        placeLesson(o);
        i = findIndex(type, id);
      }
      cur[type][i] = o;
      mark();
      return o;
    });
  };

  Store.remove = function (type, id) {
    checkType(type);
    return mutate(function () {
      var i = findIndex(type, id);
      if (i < 0) return false;
      cur[type].splice(i, 1);
      if (type === 'classes') {
        cur.plans = cur.plans.filter(function (p) { return p.classId !== id; });
        cur.lessons = cur.lessons.filter(function (l) { return l.classId !== id; });
      } else if (type === 'subjects') {
        cur.plans = cur.plans.filter(function (p) { return p.subjectId !== id; });
        cur.lessons = cur.lessons.filter(function (l) { return l.subjectId !== id; });
      } else if (type === 'teachers') {
        cur.plans.forEach(function (p) { if (p.teacherId === id) p.teacherId = null; });
        cur.lessons.forEach(function (l) { if (l.teacherId === id) l.teacherId = null; });
        cur.classes.forEach(function (c) { if (c.headTeacherId === id) c.headTeacherId = null; });
      }
      mark();
      return true;
    });
  };

  Store.setSettings = function (patch) {
    return mutate(function () {
      var s = Object.assign({}, cur.settings, clone(patch || {}));
      if (!Array.isArray(s.days)) s.days = cur.settings.days;
      if (!Array.isArray(s.periods)) s.periods = cur.settings.periods;
      if (!Array.isArray(s.breaks)) s.breaks = cur.settings.breaks;
      cur.settings = s;
      mark();
      var D = s.days.length, P = s.periods.length;
      removeLessonsWhere(function (l) { return l.day >= D || l.period >= P; });
      return s;
    });
  };

  Store.setMeta = function (patch) {
    return mutate(function () {
      cur.meta = Object.assign({}, cur.meta, clone(patch || {}));
      mark();
      return cur.meta;
    });
  };

  /* 课表操作 */
  Store.lessonAt = function (classId, day, period) {
    return idx().cell[classId + '|' + day + '|' + period] || null;
  };

  Store.setLesson = function (classId, day, period, data) {
    data = data || {};
    return mutate(function () {
      if (!idx().byId.classes[classId]) throw new Error('班级不存在');
      if (!inRange(day, period)) throw new Error('节次超出范围');
      var old = Store.lessonAt(classId, day, period);
      var tid = nz(data.teacherId);
      if (old) {
        var i = findIndex('lessons', old.id);
        var l = Object.assign({}, old, { subjectId: data.subjectId, teacherId: tid });
        if (data.locked !== undefined) l.locked = !!data.locked;
        cur.lessons[i] = l;
        mark();
        return l;
      }
      var n = { id: uid('l'), classId: classId, day: day, period: period, subjectId: data.subjectId,
        teacherId: tid, locked: !!data.locked };
      cur.lessons.push(n);
      mark();
      return n;
    });
  };

  Store.clearLesson = function (classId, day, period) {
    return mutate(function () {
      var old = Store.lessonAt(classId, day, period);
      if (!old) return false;
      removeLessonsWhere(function (x) { return x.id === old.id; });
      return true;
    });
  };

  Store.moveLesson = function (from, to) {
    if (!from || !to) return false;
    return mutate(function () {
      if (from.classId === to.classId && from.day === to.day && from.period === to.period) return false;
      if (!inRange(to.day, to.period) || !idx().byId.classes[to.classId]) return false;
      var a = Store.lessonAt(from.classId, from.day, from.period);
      if (!a) return false;
      var b = Store.lessonAt(to.classId, to.day, to.period);
      var ia = findIndex('lessons', a.id);
      cur.lessons[ia] = Object.assign({}, a, { classId: to.classId, day: to.day, period: to.period });
      if (b) {
        var ib = findIndex('lessons', b.id);
        cur.lessons[ib] = Object.assign({}, b, { classId: from.classId, day: from.day, period: from.period });
      }
      mark();
      return true;
    });
  };

  Store.toggleLock = function (lessonId) {
    return mutate(function () {
      var i = findIndex('lessons', lessonId);
      if (i < 0) return false;
      cur.lessons[i] = Object.assign({}, cur.lessons[i], { locked: !cur.lessons[i].locked });
      mark();
      return cur.lessons[i].locked;
    });
  };

  /* 查询 */
  Store.teacherLessons = function (teacherId) {
    return cur.lessons.filter(function (l) { return l.teacherId === teacherId; });
  };
  Store.classLessons = function (classId) {
    return cur.lessons.filter(function (l) { return l.classId === classId; });
  };

  Store.conflicts = function () {
    var ts = idx().tslot, out = [];
    Object.keys(ts).forEach(function (k) {
      var arr = ts[k];
      if (arr.length > 1) {
        out.push({ type: 'teacher', teacherId: arr[0].teacherId, day: arr[0].day, period: arr[0].period,
          lessonIds: arr.map(function (l) { return l.id; }) });
      }
    });
    out.sort(function (a, b) { return a.day - b.day || a.period - b.period; });
    return out;
  };

  Store.checkPlacement = function (classId, day, period, teacherId) {
    if (teacherId == null || teacherId === '') return [];
    var arr = idx().tslot[teacherId + '|' + day + '|' + period] || [];
    return arr.filter(function (l) { return l.classId !== classId; });
  };

  Store.planStatus = function () {
    var cnt = {};
    cur.lessons.forEach(function (l) {
      var k = l.classId + '|' + l.subjectId + '|' + l.teacherId;
      cnt[k] = (cnt[k] || 0) + 1;
    });
    return cur.plans.map(function (p) {
      return { plan: p, placed: cnt[p.classId + '|' + p.subjectId + '|' + p.teacherId] || 0 };
    });
  };

  Store.teacherLoad = function () {
    var m = {};
    var out = cur.teachers.map(function (t) {
      var r = { teacher: t, total: 0, bySubject: {}, byClass: {} }; m[t.id] = r; return r;
    });
    cur.lessons.forEach(function (l) {
      var r = l.teacherId != null && m[l.teacherId];
      if (!r) return;
      r.total++;
      r.bySubject[l.subjectId] = (r.bySubject[l.subjectId] || 0) + 1;
      r.byClass[l.classId] = (r.byClass[l.classId] || 0) + 1;
    });
    return out;
  };

  /* 历史 */
  Store.canUndo = function () { return depth === 0 && undoStack.length > 0; };
  Store.canRedo = function () { return depth === 0 && redoStack.length > 0; };
  Store.undo = function () {
    if (!Store.canUndo()) return false;
    redoStack.push(cur);
    cur = undoStack.pop();
    rev++; persist(); notify();
    return true;
  };
  Store.redo = function () {
    if (!Store.canRedo()) return false;
    undoStack.push(cur);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    cur = redoStack.pop();
    rev++; persist(); notify();
    return true;
  };

  /* 批量 */
  Store.transaction = function (fn) { return mutate(fn); };

  /* 整体替换 */
  Store.replaceAll = function (newState) {
    var n = normalize(newState);
    return mutate(function () { cur = n; mark(); return true; });
  };
  Store.resetToSeed = function () { return Store.replaceAll(seedState || {}); };

  /* 快照 */
  function readSnaps() {
    try {
      var raw = storeGet(KEY_SNAP);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeSnaps(arr) {
    try { return storeSet(KEY_SNAP, JSON.stringify(arr)); } catch (e) { return false; }
  }
  function snapMeta(s) {
    return { id: s.id, name: s.name, time: s.time, lessonCount: (s.state && s.state.lessons || []).length };
  }
  Store.snapshots = function () { return readSnaps().map(snapMeta); };
  Store.saveSnapshot = function (name) {
    var arr = readSnaps();
    var s = { id: uid('snap'), name: String(name || ('方案 ' + (arr.length + 1))), time: Date.now(), state: clone(cur) };
    arr.push(s);
    var ok = writeSnaps(arr);
    notify();
    var m = snapMeta(s); m.persisted = ok;
    return m;
  };
  Store.restoreSnapshot = function (id) {
    var s = readSnaps().filter(function (x) { return x.id === id; })[0];
    if (!s) return false;
    return Store.replaceAll(s.state);
  };
  Store.deleteSnapshot = function (id) {
    var arr = readSnaps(), n = arr.filter(function (x) { return x.id !== id; });
    if (n.length === arr.length) return false;
    writeSnaps(n);
    notify();
    return true;
  };

  // 未调用 init 时也保证可用
  cur = normalize({});
})();
