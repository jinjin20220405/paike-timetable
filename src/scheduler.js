/* scheduler.js — window.Scheduler：自动排课（成员 A）
 * 算法：贪心初始化 + 模拟退火（班内两格互换），多次重启取最优；
 * 结束后仍有老师冲突的课直接撤出（列入 unplaced），保证硬约束不被违反。 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var W_HARD = 1000;    // 老师冲突
  var W_MAXDAY = 60;    // 同科单日超上限（每超 1 节）
  var W_SPREAD = 4;     // 同科同日多节（每多 1 节）
  var W_CONSEC = 8;     // 同科连堂
  var W_AM = 3;         // 语文/数学排在第 4 节及以后
  var W_EMPTY = 1;      // 空格排在前面的节次（尽量把空节放在最后）
  var TIME_BUDGET = 800; // ms

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function rng(seed) {
    if (seed == null) return Math.random;
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function isPrio(name) { return /语文|数学/.test(name || ''); }
  function key3(c, s, t) { return c + '|' + s + '|' + t; }

  function run(opts) {
    opts = opts || {};
    var Store = root.Store;
    var st = Store.get();
    var D = st.settings.days.length, P = st.settings.periods.length, NS = D * P;
    var keepExisting = opts.keepExisting !== false;
    var respectLocked = opts.respectLocked !== false;
    var maxPer = opts.maxPerDayPerSubject == null ? 2 : Math.max(1, opts.maxPerDayPerSubject | 0);
    var avoidConsec = opts.avoidConsecutiveSame !== false;
    var rand = rng(opts.seed);
    var t0 = now();
    var budget = opts.timeBudget || TIME_BUDGET;

    var allClassIds = st.classes.map(function (c) { return c.id; });
    var classIds = Array.isArray(opts.classIds) && opts.classIds.length
      ? opts.classIds.filter(function (id) { return allClassIds.indexOf(id) >= 0; }) : allClassIds;
    var sel = {}; classIds.forEach(function (id, i) { sel[id] = i; });
    var empty = { placed: 0, unplaced: [], changes: [] };
    if (!NS || !classIds.length) return empty;

    // 索引
    var tIdx = {}, T = 0;
    st.teachers.forEach(function (t) { tIdx[t.id] = T++; });
    var sIdx = {}, sPrio = [], NSUB = 0;
    st.subjects.forEach(function (s) { sIdx[s.id] = NSUB; sPrio.push(isPrio(s.name)); NSUB++; });
    function ti(id) { return id != null && tIdx[id] !== undefined ? tIdx[id] : -1; }

    var NC = classIds.length;
    var cellSub = new Int16Array(NC * NS).fill(-1);
    var cellT = new Int16Array(NC * NS).fill(-1);
    var cellFixed = new Uint8Array(NC * NS);
    var cellUnit = new Int32Array(NC * NS).fill(-1);
    var tc = new Int16Array(Math.max(1, T) * NS);
    var placedBefore = {}; // 保留的课按 班|科|师 计数

    st.lessons.forEach(function (l) {
      var slot = l.day * P + l.period;
      var ci = sel[l.classId];
      var keep = ci === undefined || keepExisting || (l.locked && respectLocked);
      if (!keep) return;
      var t = ti(l.teacherId);
      if (t >= 0) tc[t * NS + slot]++;
      if (ci !== undefined) {
        var c = ci * NS + slot;
        cellSub[c] = sIdx[l.subjectId] !== undefined ? sIdx[l.subjectId] : -1;
        cellT[c] = t; cellFixed[c] = 1;
        var k = key3(l.classId, l.subjectId, l.teacherId);
        placedBefore[k] = (placedBefore[k] || 0) + 1;
      }
    });

    // 待排单元
    var units = []; // {ci, plan, s, t}
    var dropped = [];
    var movable = [];
    for (var ci0 = 0; ci0 < NC; ci0++) {
      var mv = [];
      for (var k0 = 0; k0 < NS; k0++) if (!cellFixed[ci0 * NS + k0]) mv.push(k0);
      movable.push(mv);
    }
    var byClass = classIds.map(function () { return []; });
    st.plans.forEach(function (p) {
      var ci = sel[p.classId];
      if (ci === undefined || sIdx[p.subjectId] === undefined) return;
      var miss = p.hours - (placedBefore[key3(p.classId, p.subjectId, p.teacherId)] || 0);
      for (var i = 0; i < miss; i++) byClass[ci].push({ ci: ci, plan: p, s: sIdx[p.subjectId], t: ti(p.teacherId) });
    });
    byClass.forEach(function (list, ci) {
      var cap = movable[ci].length;
      while (list.length > cap) {
        // 超出空格容量：从剩余单元最多的任务里撤出
        var cnt = {}, best = null;
        list.forEach(function (u) { cnt[u.plan.id] = (cnt[u.plan.id] || 0) + 1; });
        Object.keys(cnt).forEach(function (id) { if (best == null || cnt[id] > cnt[best]) best = id; });
        for (var i = list.length - 1; i >= 0; i--) if (list[i].plan.id === best) { dropped.push(list.splice(i, 1)[0]); break; }
      }
      list.forEach(function (u) { units.push(u); });
    });

    var fixedTc = tc.slice();
    var subCnt = new Int16Array(Math.max(1, NSUB));

    function f(n) { return n > 1 ? n - 1 : 0; }
    function dayCost(ci, d) {
      var b = ci * NS + d * P, cost = 0, prev = -2, p, s;
      for (p = 0; p < P; p++) {
        s = cellSub[b + p];
        if (s < 0) { if (p < P - 2 && !cellFixed[b + p]) cost += W_EMPTY; prev = -2; continue; }
        subCnt[s]++;
        if (avoidConsec && s === prev) cost += W_CONSEC;
        if (sPrio[s] && p >= 3) cost += W_AM;
        prev = s;
      }
      for (p = 0; p < P; p++) {
        s = cellSub[b + p];
        if (s < 0 || subCnt[s] === 0) continue;
        var n = subCnt[s];
        if (n > maxPer) cost += (n - maxPer) * W_MAXDAY;
        if (n > 1) cost += (n - 1) * W_SPREAD;
        subCnt[s] = 0;
      }
      return cost;
    }
    function totalCost() {
      var c = 0, ci, d, i;
      for (ci = 0; ci < NC; ci++) for (d = 0; d < D; d++) c += dayCost(ci, d);
      var h = 0;
      for (i = 0; i < tc.length; i++) h += f(tc[i]);
      return { soft: c, hard: h };
    }
    function hardOf() { var h = 0; for (var i = 0; i < tc.length; i++) h += f(tc[i]); return h; }

    function clearUnits() {
      tc.set(fixedTc);
      for (var i = 0; i < NC * NS; i++) if (!cellFixed[i]) { cellSub[i] = -1; cellT[i] = -1; cellUnit[i] = -1; }
    }
    function put(ci, k, ui) {
      var c = ci * NS + k, u = units[ui];
      cellSub[c] = u.s; cellT[c] = u.t; cellUnit[c] = ui;
      if (u.t >= 0) tc[u.t * NS + k]++;
    }

    function greedyInit() {
      clearUnits();
      for (var ci = 0; ci < NC; ci++) {
        var list = [];
        for (var i = 0; i < units.length; i++) if (units[i].ci === ci) list.push(i);
        // 打乱后按老师繁忙度降序
        for (i = list.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var x = list[i]; list[i] = list[j]; list[j] = x; }
        var free = movable[ci].slice();
        list.forEach(function (ui) {
          var u = units[ui], bestI = -1, bestV = Infinity;
          for (var q = 0; q < free.length; q++) {
            var k = free[q], v = rand();
            if (u.t >= 0) v += tc[u.t * NS + k] * 100;
            var d = Math.floor(k / P), b = ci * NS + d * P, same = 0;
            for (var p = 0; p < P; p++) if (cellSub[b + p] === u.s) same++;
            v += same * 10;
            if (sPrio[u.s] && k % P >= 3) v += 2;
            if (v < bestV) { bestV = v; bestI = q; }
          }
          put(ci, free[bestI], ui);
          free.splice(bestI, 1);
        });
      }
    }

    // 班内交换两格（至少一格有待排单元）
    function swapCells(ci, a, b) {
      var ca = ci * NS + a, cb = ci * NS + b;
      var ta = cellT[ca], tb = cellT[cb];
      if (ta >= 0) { tc[ta * NS + a]--; tc[ta * NS + b]++; }
      if (tb >= 0) { tc[tb * NS + b]--; tc[tb * NS + a]++; }
      var x = cellSub[ca]; cellSub[ca] = cellSub[cb]; cellSub[cb] = x;
      x = cellT[ca]; cellT[ca] = cellT[cb]; cellT[cb] = x;
      x = cellUnit[ca]; cellUnit[ca] = cellUnit[cb]; cellUnit[cb] = x;
    }
    function localCost(ci, a, b) {
      var da = Math.floor(a / P), db = Math.floor(b / P);
      var c = dayCost(ci, da) + (db !== da ? dayCost(ci, db) : 0);
      var ta = cellT[ci * NS + a], tb = cellT[ci * NS + b], h = 0;
      if (ta >= 0) h += f(tc[ta * NS + a]) + f(tc[ta * NS + b]);
      if (tb >= 0 && tb !== ta) h += f(tc[tb * NS + a]) + f(tc[tb * NS + b]);
      return c + h * W_HARD;
    }
    function tryMove(ci, a, b, temp) {
      var ca = ci * NS + a, cb = ci * NS + b;
      if (cellUnit[ca] < 0 && cellUnit[cb] < 0) return 0;
      var before = localCost(ci, a, b);
      swapCells(ci, a, b);
      var delta = localCost(ci, a, b) - before;
      if (delta <= 0 || (temp > 0 && rand() < Math.exp(-delta / temp))) return delta;
      swapCells(ci, a, b);
      return null;
    }

    // 定向修复：对每个冲突单元，尝试班内所有交换中最优的一个
    function repair() {
      var improved = true, guard = 0;
      while (improved && guard++ < 50) {
        improved = false;
        for (var ci = 0; ci < NC; ci++) {
          var mv = movable[ci];
          for (var q = 0; q < mv.length; q++) {
            var a = mv[q], c = ci * NS + a, t = cellT[c];
            if (cellUnit[c] < 0 || t < 0 || tc[t * NS + a] <= 1) continue;
            var bestB = -1, bestD = 0;
            for (var r = 0; r < mv.length; r++) {
              var b = mv[r]; if (b === a) continue;
              var d = tryMove(ci, a, b, 0);
              if (d !== null) { if (d < bestD) { bestD = d; bestB = b; } swapCells(ci, a, b); }
            }
            if (bestB >= 0) { swapCells(ci, a, bestB); improved = true; }
          }
        }
      }
    }

    function anneal(iters) {
      var cls = [];
      for (var ci = 0; ci < NC; ci++) if (movable[ci].length > 1) cls.push(ci);
      if (!cls.length) return;
      var T0 = 30, T1 = 0.3, temp = T0, ratio = Math.pow(T1 / T0, 1 / iters);
      for (var it = 0; it < iters; it++) {
        var ci2 = cls[Math.floor(rand() * cls.length)], mv = movable[ci2];
        var a = mv[Math.floor(rand() * mv.length)], b = mv[Math.floor(rand() * mv.length)];
        if (a !== b) tryMove(ci2, a, b, temp);
        temp *= ratio;
        if ((it & 4095) === 0 && now() - t0 > budget) break;
      }
    }

    var nMovable = 0; movable.forEach(function (m) { nMovable += m.length; });
    var iters = Math.min(400000, Math.max(20000, nMovable * 600));
    var best = null, attempt = 0;
    do {
      greedyInit();
      anneal(iters);
      repair();
      var c = totalCost();
      if (!best || c.hard < best.hard || (c.hard === best.hard && c.soft < best.soft)) {
        best = { hard: c.hard, soft: c.soft, cellUnit: cellUnit.slice() };
      }
      attempt++;
    } while (best.hard > 0 && attempt < 20 && now() - t0 < budget);

    // 恢复最优解
    clearUnits();
    for (var i = 0; i < NC * NS; i++) if (best.cellUnit[i] >= 0) put(Math.floor(i / NS), i % NS, best.cellUnit[i]);

    // 撤出仍冲突的单元，保证硬约束
    for (i = 0; i < NC * NS; i++) {
      var ui = cellUnit[i];
      if (ui < 0) continue;
      var t = cellT[i], k = i % NS;
      if (t >= 0 && tc[t * NS + k] > 1) {
        tc[t * NS + k]--; dropped.push(units[ui]);
        cellSub[i] = -1; cellT[i] = -1; cellUnit[i] = -1;
      }
    }

    // 写入
    var changes = [], placed = 0;
    var finalCnt = {};
    Object.keys(placedBefore).forEach(function (k) { finalCnt[k] = placedBefore[k]; });
    Store.transaction(function () {
      for (var ci = 0; ci < NC; ci++) {
        var cid = classIds[ci];
        for (var k = 0; k < NS; k++) {
          var c = ci * NS + k;
          if (cellFixed[c]) continue;
          var d = Math.floor(k / P), p = k % P;
          var old = Store.lessonAt(cid, d, p);
          var ui = cellUnit[c];
          var before = old ? { subjectId: old.subjectId, teacherId: old.teacherId } : null;
          if (ui >= 0) {
            var u = units[ui]; placed++;
            var kk = key3(cid, u.plan.subjectId, u.plan.teacherId);
            finalCnt[kk] = (finalCnt[kk] || 0) + 1;
            if (old && old.subjectId === u.plan.subjectId && old.teacherId === u.plan.teacherId && !old.locked) continue;
            Store.setLesson(cid, d, p, { subjectId: u.plan.subjectId, teacherId: u.plan.teacherId, locked: false });
            changes.push({ classId: cid, day: d, period: p, before: before,
              after: { subjectId: u.plan.subjectId, teacherId: u.plan.teacherId } });
          } else if (old) {
            Store.clearLesson(cid, d, p);
            changes.push({ classId: cid, day: d, period: p, before: before, after: null });
          }
        }
      }
    });

    var unplaced = [];
    st = Store.get();
    st.plans.forEach(function (p) {
      if (sel[p.classId] === undefined) return;
      var miss = p.hours - (finalCnt[key3(p.classId, p.subjectId, p.teacherId)] || 0);
      if (miss > 0) unplaced.push({ plan: p, missing: miss });
    });
    return { placed: placed, unplaced: unplaced, changes: changes };
  }

  function suggest(classId, day, period) {
    var Store = root.Store, st = Store.get();
    var P = st.settings.periods.length;
    var here = Store.lessonAt(classId, day, period);
    var status = Store.planStatus().filter(function (x) { return x.plan.classId === classId; });
    var dayCnt = {}, prevSub = null, nextSub = null;
    st.lessons.forEach(function (l) {
      if (l.classId !== classId || l.day !== day) return;
      if (here && l.id === here.id) return;
      dayCnt[l.subjectId] = (dayCnt[l.subjectId] || 0) + 1;
      if (l.period === period - 1) prevSub = l.subjectId;
      if (l.period === period + 1) nextSub = l.subjectId;
    });
    var subName = {}; st.subjects.forEach(function (s) { subName[s.id] = s.name; });
    var clsName = {}; st.classes.forEach(function (c) { clsName[c.id] = c.name; });
    var out = status.map(function (x) {
      var p = x.plan, reasons = [], ok = true;
      var isHere = here && here.subjectId === p.subjectId && here.teacherId === p.teacherId;
      var placed = x.placed - (isHere ? 1 : 0); // 不计本格
      var missing = p.hours - placed;
      var conf = Store.checkPlacement(classId, day, period, p.teacherId);
      if (conf.length) {
        ok = false;
        reasons.push('老师此时已在' + conf.map(function (l) { return clsName[l.classId] || l.classId; }).join('、') + '上课');
      }
      if (isHere) reasons.push('当前格即此任务');
      if (missing <= 0) reasons.push('已排满（' + x.placed + '/' + p.hours + '）');
      else reasons.push('还差 ' + missing + ' 节');
      var dc = dayCnt[p.subjectId] || 0;
      if (dc > 0) reasons.push('当天已有 ' + dc + ' 节');
      if (prevSub === p.subjectId || nextSub === p.subjectId) reasons.push('会形成连堂');
      if (isPrio(subName[p.subjectId]) && period >= 3 && P > 3) reasons.push('建议排在上午');
      return { plan: p, ok: ok, reason: reasons.join('；'), missing: missing, placed: x.placed, conflicts: conf };
    });
    out.sort(function (a, b) {
      var fa = a.missing > 0 ? 0 : 1, fb = b.missing > 0 ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return b.missing - a.missing;
    });
    return out;
  }

  root.Scheduler = { run: run, suggest: suggest };
})();
