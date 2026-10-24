/* views-timetable.js — 成员 B：「课表」「检查」两个视图 */
(function () {
  'use strict';

  var LS_KEY = 'paike.ui.timetable';
  // UI 状态（模块变量 + localStorage 记忆）
  var ui = { mode: 'class', classId: null, teacherId: null, loadSort: 'name', loadDesc: false, problemsOnly: true };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved === 'object') Object.keys(ui).forEach(function (k) { if (k in saved) ui[k] = saved[k]; });
  } catch (e) { /* 忽略 */ }
  if (['class', 'teacher', 'all'].indexOf(ui.mode) < 0) ui.mode = 'class';

  function saveUi() { try { localStorage.setItem(LS_KEY, JSON.stringify(ui)); } catch (e) { /* 忽略 */ } }

  var highlight = null;   // {classId, day, period}：从检查页跳来时高亮的格子
  var hlTimer = null;
  var drag = null;        // {kind:'cell', classId, day, period} | {kind:'plan', planId}
  var judgeCache = {};

  /* ---------- 工具函数 ---------- */
  function esc(s) { return App.esc(s); }
  function st() { return Store.get(); }

  function sortedClasses(s) {
    return s.classes.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function sortedTeachers(s) {
    return s.teachers.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-CN'); });
  }
  function maps(s) {
    var m = { cls: {}, subj: {}, teach: {}, plan: {} };
    s.classes.forEach(function (x) { m.cls[x.id] = x; });
    s.subjects.forEach(function (x) { m.subj[x.id] = x; });
    s.teachers.forEach(function (x) { m.teach[x.id] = x; });
    s.plans.forEach(function (x) { m.plan[x.id] = x; });
    return m;
  }
  function lessonIndex(s) {
    var idx = {};
    s.lessons.forEach(function (l) { idx[l.classId + '|' + l.day + '|' + l.period] = l; });
    return idx;
  }
  function conflictSet() {
    var set = {};
    try {
      (Store.conflicts() || []).forEach(function (c) { (c.lessonIds || []).forEach(function (id) { set[id] = true; }); });
    } catch (e) { console.error(e); }
    return set;
  }
  function placedMap() {
    var m = {};
    try { (Store.planStatus() || []).forEach(function (x) { m[x.plan.id] = x.placed; }); } catch (e) { console.error(e); }
    return m;
  }
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(150,150,150,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function colorOf(M, subjectId) { var s = M.subj[subjectId]; return (s && s.color) || '#999999'; }
  function subjName(M, id) { var s = M.subj[id]; return s ? s.name : '（未知科目）'; }
  function teachName(M, id) { var t = M.teach[id]; return t ? t.name : ''; }
  function clsName(M, id) { var c = M.cls[id]; return c ? c.name : '（未知班级）'; }
  function slotName(day, period) { return App.dayName(day) + ' ' + App.periodName(period); }
  function breaksAfter(s, p) {
    return (s.settings.breaks || []).filter(function (b) { return Number(b.after) === p + 1; });
  }
  function describeConflicts(M, lessons) {
    return lessons.map(function (l) {
      return teachName(M, l.teacherId) + '老师此时已在 ' + clsName(M, l.classId) + ' 上' + subjName(M, l.subjectId);
    }).join('；');
  }
  function titleText(s, suffix) { return ((s.meta && s.meta.title) || '') + ' ' + suffix; }

  function ensureSel(s) {
    var cls = sortedClasses(s);
    if (!s.classes.some(function (c) { return c.id === ui.classId; })) ui.classId = cls[0] ? cls[0].id : null;
    var ts = sortedTeachers(s);
    if (!s.teachers.some(function (t) { return t.id === ui.teacherId; })) ui.teacherId = ts[0] ? ts[0].id : null;
  }

  // 保持滚动位置
  function captureScroll(el, view) {
    var first = el.firstElementChild;
    if (!first || first.getAttribute('data-view') !== view) return null;
    var keep = { win: window.scrollY, els: {} };
    el.querySelectorAll('[data-sk]').forEach(function (x) { keep.els[x.getAttribute('data-sk')] = [x.scrollLeft, x.scrollTop]; });
    return keep;
  }
  function restoreScroll(el, keep) {
    if (!keep) return;
    el.querySelectorAll('[data-sk]').forEach(function (x) {
      var v = keep.els[x.getAttribute('data-sk')];
      if (v) { x.scrollLeft = v[0]; x.scrollTop = v[1]; }
    });
    window.scrollTo(window.scrollX, keep.win);
  }

  function doUndo() {
    if (Store.canUndo()) { Store.undo(); App.toast('已撤销', 'ok'); } else App.toast('没有可以撤销的操作', 'warn');
  }
  function doRedo() {
    if (Store.canRedo()) { Store.redo(); App.toast('已重做', 'ok'); } else App.toast('没有可以重做的操作', 'warn');
  }

  /* ---------- 课表视图 ---------- */
  function renderTimetable(el) {
    var s = st();
    ensureSel(s);
    var keep = captureScroll(el, 'timetable');
    var M = maps(s);
    var root = document.createElement('div');
    root.className = 'pk-tt';
    root.setAttribute('data-view', 'timetable');
    root.appendChild(buildToolbar(s, M));

    if (!s.classes.length) {
      var empty = document.createElement('div');
      empty.className = 'pk-card';
      empty.textContent = '还没有班级，请先到「基础数据」里添加班级、科目、老师和教学任务。';
      root.appendChild(empty);
    } else if (ui.mode === 'teacher') root.appendChild(buildTeacherView(s, M));
    else if (ui.mode === 'all') root.appendChild(buildAllView(s, M));
    else root.appendChild(buildClassView(s, M));

    el.innerHTML = '';
    el.appendChild(root);
    restoreScroll(el, keep);

    if (highlight) {
      var td = root.querySelector('.pk-hl');
      if (td && !keep) td.scrollIntoView({ block: 'center', inline: 'center' });
      if (hlTimer) clearTimeout(hlTimer);
      hlTimer = setTimeout(function () {
        highlight = null;
        document.querySelectorAll('.pk-hl').forEach(function (x) { x.classList.remove('pk-hl'); });
      }, 4000);
    }
  }

  function buildToolbar(s, M) {
    var bar = document.createElement('div');
    bar.className = 'pk-tt-bar pk-noprint';
    var h = '<div class="pk-seg">' +
      [['class', '按班级'], ['teacher', '按老师'], ['all', '总表']].map(function (m) {
        return '<button class="pk-btn' + (ui.mode === m[0] ? ' active' : '') + '" data-mode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>';
    if (ui.mode === 'class') {
      h += '<label class="pk-tt-pick">班级 <select class="pk-select" data-act="pick-class">' +
        sortedClasses(s).map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === ui.classId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') + '</select></label>';
    } else if (ui.mode === 'teacher') {
      h += '<label class="pk-tt-pick">老师 <select class="pk-select" data-act="pick-teacher">' +
        sortedTeachers(s).map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (t.id === ui.teacherId ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        }).join('') + '</select></label>';
    }
    h += '<span class="pk-tt-sp"></span>' +
      '<button class="pk-btn" data-act="undo" title="撤销（Ctrl+Z）"' + (Store.canUndo() ? '' : ' disabled') + '>↶ 撤销</button>' +
      '<button class="pk-btn" data-act="redo" title="重做（Ctrl+Shift+Z / Ctrl+Y）"' + (Store.canRedo() ? '' : ' disabled') + '>↷ 重做</button>' +
      '<button class="pk-btn pk-btn-primary" data-act="auto">⚙ 自动排课</button>' +
      '<button class="pk-btn" data-act="print">🖨 打印</button>';
    bar.innerHTML = h;

    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var mode = b.getAttribute('data-mode');
      if (mode) { ui.mode = mode; saveUi(); App.refresh(); return; }
      var act = b.getAttribute('data-act');
      if (act === 'undo') doUndo();
      else if (act === 'redo') doRedo();
      else if (act === 'auto') openAutoDialog();
      else if (act === 'print') window.print();
    });
    bar.addEventListener('change', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'pick-class') { ui.classId = e.target.value; saveUi(); App.refresh(); }
      if (act === 'pick-teacher') { ui.teacherId = e.target.value; saveUi(); App.refresh(); }
    });
    return bar;
  }

  // 一个格子的课程块
  function lessonBlock(M, l, conf, mainText, subText) {
    var color = colorOf(M, l.subjectId);
    return '<div class="pk-lesson' + (conf ? ' pk-conf' : '') + '" style="background:' + rgba(color, 0.16) +
      ';border-left-color:' + esc(color) + '">' +
      '<div class="pk-l-main">' + (conf ? '<span class="pk-warn-ic" title="有冲突">⚠</span>' : '') + esc(mainText) +
      (l.locked ? '<span class="pk-lock" title="已锁定">🔒</span>' : '') + '</div>' +
      '<div class="pk-l-sub">' + (subText ? esc(subText) : '<span class="pk-muted">（未定老师）</span>') + '</div></div>';
  }

  function isHl(classId, d, p) {
    return highlight && highlight.classId === classId && highlight.day === d && highlight.period === p;
  }

  function buildClassView(s, M) {
    var wrap = document.createElement('div');
    wrap.className = 'pk-tt-layout';
    var idx = lessonIndex(s), cset = conflictSet();
    var cls = M.cls[ui.classId];
    var days = s.settings.days, periods = s.settings.periods;

    var h = '<div class="pk-tt-mainpane"><h2 class="pk-tt-title">' + esc(titleText(s, cls.name + '课表')) + '</h2>' +
      '<div class="pk-tt-scroll" data-sk="class"><table class="pk-grid pk-grid-class"><thead><tr><th class="pk-g-corner">节次</th>' +
      days.map(function (d) { return '<th>' + esc(d) + '</th>'; }).join('') + '</tr></thead><tbody>';
    periods.forEach(function (pn, p) {
      h += '<tr><th class="pk-g-period">' + esc(pn) + '</th>';
      days.forEach(function (dn, d) {
        var l = idx[cls.id + '|' + d + '|' + p];
        h += cellTd(M, cls.id, d, p, l, cset, false);
      });
      h += '</tr>';
      breaksAfter(s, p).forEach(function (b) {
        h += '<tr class="pk-break"><td colspan="' + (days.length + 1) + '">' + esc(b.label) + '</td></tr>';
      });
    });
    h += '</tbody></table></div>' +
      '<p class="pk-muted pk-noprint pk-tt-tip">提示：点格子可以编辑；按住格子拖到别的格子可以移动或互换；⚠ 表示老师时间冲突；🔒 表示已锁定（自动排课不会动它）。</p></div>';

    // 侧栏：教学任务完成度
    var pm = placedMap();
    var plans = s.plans.filter(function (x) { return x.classId === cls.id; }).map(function (x) {
      return { plan: x, placed: pm[x.id] || 0 };
    });
    plans.sort(function (a, b) {
      var ra = a.placed < a.plan.hours ? 0 : (a.placed > a.plan.hours ? 1 : 2);
      var rb = b.placed < b.plan.hours ? 0 : (b.placed > b.plan.hours ? 1 : 2);
      return ra - rb || String(subjName(M, a.plan.subjectId)).localeCompare(subjName(M, b.plan.subjectId), 'zh-CN');
    });
    var need = 0, got = 0;
    plans.forEach(function (x) { need += Number(x.plan.hours) || 0; got += x.placed; });
    var classTotal = s.lessons.filter(function (l) { return l.classId === cls.id; }).length;
    h += '<aside class="pk-tt-side pk-noprint" data-sk="side"><div class="pk-card"><div class="pk-side-h">本班教学任务</div>' +
      '<div class="pk-muted pk-side-sum">课表共 ' + classTotal + ' 节；任务应排 ' + need + ' 节，已排 ' + got + ' 节</div>';
    if (!plans.length) h += '<div class="pk-muted">本班还没有教学任务，可在「基础数据 → 教学任务」中添加。</div>';
    plans.forEach(function (x) {
      var p = x.plan, color = colorOf(M, p.subjectId);
      var under = x.placed < p.hours, over = x.placed > p.hours;
      var badge = under ? '<span class="pk-badge pk-badge-warn">差 ' + (p.hours - x.placed) + '</span>' :
        over ? '<span class="pk-badge pk-badge-err">多 ' + (x.placed - p.hours) + '</span>' : '<span class="pk-badge pk-badge-ok">✓</span>';
      h += '<div class="pk-plan' + (under ? ' pk-plan-drag' : '') + '"' + (under ? ' draggable="true" data-plan="' + esc(p.id) + '" title="拖到左边的空格子里"' : '') +
        ' style="border-left-color:' + esc(color) + ';background:' + rgba(color, 0.10) + '">' +
        '<div class="pk-plan-name">' + (under ? '<span class="pk-grip">⠿</span>' : '') + esc(subjName(M, p.subjectId)) +
        ' <span class="pk-muted">' + esc(teachName(M, p.teacherId) || '未定老师') + '</span></div>' +
        '<div class="pk-plan-num">' + x.placed + ' / ' + p.hours + ' ' + badge + '</div></div>';
    });
    if (plans.some(function (x) { return x.placed < x.plan.hours; })) h += '<div class="pk-muted pk-side-tip">把带 ⠿ 的任务拖到左边空格子里即可排课。</div>';
    h += '</div></aside>';
    wrap.innerHTML = h;
    bindGrid(wrap);
    return wrap;
  }

  function cellTd(M, classId, d, p, l, cset, compact) {
    var conf = l && cset[l.id];
    var cls = 'pk-cell' + (l ? '' : ' pk-cell-empty') + (conf ? ' pk-cell-conf' : '') + (l && l.locked ? ' pk-cell-locked' : '') + (isHl(classId, d, p) ? ' pk-hl' : '');
    var attrs = ' data-c="' + esc(classId) + '" data-d="' + d + '" data-p="' + p + '"' + (l && !l.locked ? ' draggable="true"' : '');
    var tip = l ? subjName(M, l.subjectId) + (l.teacherId ? '（' + teachName(M, l.teacherId) + '）' : '') + (l.locked ? ' 已锁定' : '') : '空，点击排课';
    var inner = '';
    if (l) {
      if (compact) {
        var color = colorOf(M, l.subjectId);
        inner = '<div class="pk-lesson pk-lesson-c' + (conf ? ' pk-conf' : '') + '" style="background:' + rgba(color, 0.16) + ';border-left-color:' + esc(color) + '">' +
          '<div class="pk-l-main">' + (conf ? '<span class="pk-warn-ic">⚠</span>' : '') + esc(subjName(M, l.subjectId)) + (l.locked ? '<span class="pk-lock">🔒</span>' : '') + '</div>' +
          '<div class="pk-l-sub">' + esc(teachName(M, l.teacherId)) + '</div></div>';
      } else inner = lessonBlock(M, l, conf, subjName(M, l.subjectId), teachName(M, l.teacherId));
    } else inner = '<div class="pk-empty-mark">＋</div>';
    return '<td class="' + cls + '"' + attrs + ' title="' + esc(tip) + '">' + inner + '</td>';
  }

  function buildAllView(s, M) {
    var wrap = document.createElement('div');
    var idx = lessonIndex(s), cset = conflictSet();
    var cls = sortedClasses(s), days = s.settings.days, periods = s.settings.periods;
    var h = '<h2 class="pk-tt-title">' + esc(titleText(s, '全校总课表')) + '</h2>' +
      '<div class="pk-tt-scroll" data-sk="all"><table class="pk-grid pk-grid-all" style="--pk-cols:' + cls.length + '"><thead><tr><th>星期</th><th>节次</th>' +
      cls.map(function (c) { return '<th>' + esc(c.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    days.forEach(function (dn, d) {
      periods.forEach(function (pn, p) {
        h += '<tr' + (p === 0 ? ' class="pk-day-start"' : '') + '>';
        if (p === 0) h += '<th class="pk-g-day" rowspan="' + periods.length + '">' + esc(dn) + '</th>';
        h += '<th class="pk-g-period">' + esc(pn) + '</th>';
        cls.forEach(function (c) { h += cellTd(M, c.id, d, p, idx[c.id + '|' + d + '|' + p], cset, true); });
        h += '</tr>';
      });
    });
    h += '</tbody></table></div><p class="pk-muted pk-noprint pk-tt-tip">点格子可编辑，格子之间可拖动（含跨班级）。红框 ⚠ 为老师时间冲突。</p>';
    wrap.innerHTML = h;
    bindGrid(wrap);
    return wrap;
  }

  function buildTeacherView(s, M) {
    var wrap = document.createElement('div');
    var t = M.teach[ui.teacherId];
    if (!t) { wrap.className = 'pk-card'; wrap.textContent = '还没有老师。'; return wrap; }
    var days = s.settings.days, periods = s.settings.periods;
    var mine = (Store.teacherLessons(t.id) || []);
    var slot = {}, byClass = {};
    mine.forEach(function (l) {
      var k = l.day + '|' + l.period;
      (slot[k] = slot[k] || []).push(l);
      byClass[l.classId] = (byClass[l.classId] || 0) + 1;
    });
    var cset = conflictSet();
    var h = '<h2 class="pk-tt-title">' + esc(titleText(s, t.name + '老师课表')) + '</h2>' +
      '<div class="pk-tt-scroll" data-sk="teacher"><table class="pk-grid pk-grid-class"><thead><tr><th class="pk-g-corner">节次</th>' +
      days.map(function (d) { return '<th>' + esc(d) + '</th>'; }).join('') + '</tr></thead><tbody>';
    periods.forEach(function (pn, p) {
      h += '<tr><th class="pk-g-period">' + esc(pn) + '</th>';
      days.forEach(function (dn, d) {
        var list = slot[d + '|' + p] || [];
        var conf = list.length > 1 || list.some(function (l) { return cset[l.id]; });
        h += '<td class="pk-cell pk-cell-t' + (list.length ? '' : ' pk-cell-empty') + (conf ? ' pk-cell-conf' : '') + '">';
        list.forEach(function (l) {
          h += '<div class="pk-t-item" data-c="' + esc(l.classId) + '" data-d="' + d + '" data-p="' + p + '" title="点击编辑">' +
            lessonBlock(M, l, conf, clsName(M, l.classId) + '·' + subjName(M, l.subjectId), null).replace('<span class="pk-muted">（未定老师）</span>', '') + '</div>';
        });
        h += '</td>';
      });
      h += '</tr>';
      breaksAfter(s, p).forEach(function (b) {
        h += '<tr class="pk-break"><td colspan="' + (days.length + 1) + '">' + esc(b.label) + '</td></tr>';
      });
    });
    var detail = sortedClasses(s).filter(function (c) { return byClass[c.id]; }).map(function (c) { return c.name + ' ' + byClass[c.id] + ' 节'; }).join('、');
    h += '</tbody><tfoot><tr><td colspan="' + (days.length + 1) + '" class="pk-t-total">周课时合计：<b>' + mine.length + '</b> 节' +
      (detail ? '（' + esc(detail) + '）' : '') + '</td></tr></tfoot></table></div>' +
      '<p class="pk-muted pk-noprint pk-tt-tip">点击课程可修改该班这一节课。</p>';
    wrap.innerHTML = h;
    wrap.addEventListener('click', function (e) {
      var it = e.target.closest('[data-c]');
      if (it) openEditor(it.getAttribute('data-c'), +it.getAttribute('data-d'), +it.getAttribute('data-p'));
    });
    return wrap;
  }

  /* ---------- 拖拽 ---------- */
  function cellPos(td) { return { classId: td.getAttribute('data-c'), day: +td.getAttribute('data-d'), period: +td.getAttribute('data-p') }; }

  function judge(t) {
    var key = t.classId + '|' + t.day + '|' + t.period;
    if (judgeCache[key]) return judgeCache[key];
    var r = { invalid: false, conflicts: [], msg: '' };
    var tl = Store.lessonAt(t.classId, t.day, t.period);
    if (!drag) r.invalid = true;
    else if (tl && tl.locked) { r.invalid = true; r.msg = '目标格已锁定'; }
    else if (drag.kind === 'cell') {
      var src = Store.lessonAt(drag.classId, drag.day, drag.period);
      if (!src || (drag.classId === t.classId && drag.day === t.day && drag.period === t.period)) r.invalid = true;
      else {
        if (src.teacherId) r.conflicts = (Store.checkPlacement(t.classId, t.day, t.period, src.teacherId) || [])
          .filter(function (l) { return l.id !== src.id; });
        if (tl && tl.teacherId) r.conflicts = r.conflicts.concat((Store.checkPlacement(drag.classId, drag.day, drag.period, tl.teacherId) || [])
          .filter(function (l) { return l.id !== tl.id; }));
      }
    } else {
      var plan = Store.lookup('plans', drag.planId);
      if (!plan) r.invalid = true;
      else if (tl) { r.invalid = true; r.msg = '该格已有课，请拖到空格子'; }
      else if (plan.classId !== t.classId) { r.invalid = true; r.msg = '只能放进本班的格子'; }
      else if (plan.teacherId) r.conflicts = Store.checkPlacement(t.classId, t.day, t.period, plan.teacherId) || [];
    }
    judgeCache[key] = r;
    return r;
  }

  function clearDropMarks() {
    document.querySelectorAll('.pk-drop-ok,.pk-drop-bad,.pk-drop-no,.pk-dragging').forEach(function (x) {
      x.classList.remove('pk-drop-ok', 'pk-drop-bad', 'pk-drop-no', 'pk-dragging');
    });
  }

  function bindGrid(root) {
    root.addEventListener('click', function (e) {
      var td = e.target.closest('td[data-c]');
      if (td) { var p = cellPos(td); openEditor(p.classId, p.day, p.period); }
    });
    root.addEventListener('dragstart', function (e) {
      var pl = e.target.closest && e.target.closest('[data-plan]');
      var td = e.target.closest && e.target.closest('td[data-c]');
      if (pl) { drag = { kind: 'plan', planId: pl.getAttribute('data-plan') }; pl.classList.add('pk-dragging'); }
      else if (td) { drag = Object.assign({ kind: 'cell' }, cellPos(td)); td.classList.add('pk-dragging'); }
      else return;
      judgeCache = {};
      try { e.dataTransfer.setData('text/plain', 'paike'); e.dataTransfer.effectAllowed = drag.kind === 'plan' ? 'copy' : 'move'; } catch (err) { /* 忽略 */ }
    });
    root.addEventListener('dragover', function (e) {
      var td = e.target.closest('td[data-c]');
      if (!td || !drag) return;
      var r = judge(cellPos(td));
      td.classList.remove('pk-drop-ok', 'pk-drop-bad', 'pk-drop-no');
      if (r.invalid) { td.classList.add('pk-drop-no'); return; }
      e.preventDefault();
      try { e.dataTransfer.dropEffect = drag.kind === 'plan' ? 'copy' : 'move'; } catch (err) { /* 忽略 */ }
      td.classList.add(r.conflicts.length ? 'pk-drop-bad' : 'pk-drop-ok');
    });
    root.addEventListener('dragleave', function (e) {
      var td = e.target.closest('td[data-c]');
      if (td && !td.contains(e.relatedTarget)) td.classList.remove('pk-drop-ok', 'pk-drop-bad', 'pk-drop-no');
    });
    root.addEventListener('drop', function (e) {
      var td = e.target.closest('td[data-c]');
      if (!td || !drag) return;
      e.preventDefault();
      var t = cellPos(td), r = judge(t), d = drag;
      drag = null; judgeCache = {};
      clearDropMarks();
      if (r.invalid) { if (r.msg) App.toast(r.msg, 'warn'); return; }
      var M = maps(st());
      if (d.kind === 'cell') Store.moveLesson({ classId: d.classId, day: d.day, period: d.period }, t);
      else {
        var plan = Store.lookup('plans', d.planId);
        Store.setLesson(t.classId, t.day, t.period, { subjectId: plan.subjectId, teacherId: plan.teacherId || null });
      }
      if (r.conflicts.length) App.toast('已放入，但有冲突：' + describeConflicts(M, r.conflicts), 'warn');
    });
    root.addEventListener('dragend', function () { drag = null; judgeCache = {}; clearDropMarks(); });
  }

  /* ---------- 编辑格子 ---------- */
  function openEditor(classId, day, period) {
    var s = st(), M = maps(s);
    var lesson = Store.lessonAt(classId, day, period);
    var locked = !!(lesson && lesson.locked);
    var pm = placedMap();
    var body = document.createElement('div');
    body.className = 'pk-ed';

    var h = '<div class="pk-ed-where"><b>' + esc(clsName(M, classId)) + '</b> · ' + esc(slotName(day, period)) +
      (lesson ? '　当前：<b>' + esc(subjName(M, lesson.subjectId)) + '</b>' + (lesson.teacherId ? '（' + esc(teachName(M, lesson.teacherId)) + '）' : '') : '　当前：空') +
      (locked ? ' 🔒' : '') + '</div>';
    if (locked) h += '<div class="pk-ed-lockmsg">这节课已锁定。如需修改或清空，请先点下方「解锁」。</div>';

    var sugg = [];
    try { sugg = (window.Scheduler && Scheduler.suggest) ? (Scheduler.suggest(classId, day, period) || []) : []; } catch (e) { console.error(e); }
    h += '<div class="pk-ed-sec">本班教学任务（点一下直接排入）</div><div class="pk-ed-quick">';
    if (!sugg.length) h += '<div class="pk-muted">没有可选的教学任务。</div>';
    sugg.forEach(function (x, i) {
      var p = x.plan, color = colorOf(M, p.subjectId), placed = pm[p.id] || 0;
      h += '<button class="pk-ed-q' + (x.ok ? '' : ' pk-ed-q-bad') + '" data-i="' + i + '"' + (locked ? ' disabled' : '') +
        ' style="border-left-color:' + esc(color) + ';background:' + rgba(color, 0.10) + '">' +
        '<span class="pk-ed-q-name">' + esc(subjName(M, p.subjectId)) + ' <span class="pk-muted">' + esc(teachName(M, p.teacherId) || '未定老师') + '</span></span>' +
        '<span class="pk-ed-q-num">已排 ' + placed + ' / 应排 ' + p.hours + '</span>' +
        (x.ok ? '<span class="pk-badge pk-badge-ok">可排</span>' : '<span class="pk-badge pk-badge-err">⚠ 冲突</span>') +
        (x.reason ? '<span class="pk-ed-q-why' + (x.ok ? '' : ' pk-ed-q-whybad') + '">' + esc(x.reason) + '</span>' : '') +
        '</button>';
    });
    h += '</div>';

    h += '<div class="pk-ed-sec">或者手动选择</div><div class="pk-ed-manual">' +
      '<label>科目 <select class="pk-select" data-f="subj"' + (locked ? ' disabled' : '') + '><option value="">（请选择）</option>' +
      s.subjects.map(function (x) { return '<option value="' + esc(x.id) + '"' + (lesson && lesson.subjectId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label>老师 <select class="pk-select" data-f="teacher"' + (locked ? ' disabled' : '') + '><option value="">（暂不指定）</option>' +
      sortedTeachers(s).map(function (x) { return '<option value="' + esc(x.id) + '"' + (lesson && lesson.teacherId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      '</select></label></div><div class="pk-ed-hint"></div>';
    body.innerHTML = h;

    var selS = body.querySelector('[data-f=subj]'), selT = body.querySelector('[data-f=teacher]'), hint = body.querySelector('.pk-ed-hint');
    function updateHint() {
      var tid = selT.value, sid = selS.value, out = [];
      if (tid) {
        var conf = Store.checkPlacement(classId, day, period, tid) || [];
        if (conf.length) out.push('<div class="pk-ed-bad">⚠ 冲突：' + esc(describeConflicts(M, conf)) + '</div>');
        else out.push('<div class="pk-ed-ok">✓ ' + esc(teachName(M, tid)) + '老师这个时间没有别的课</div>');
      }
      if (sid) {
        var plan = s.plans.filter(function (p) { return p.classId === classId && p.subjectId === sid && (!tid || p.teacherId === tid); })[0];
        if (plan && (!tid || plan.teacherId === tid)) out.push('<div class="pk-muted">该教学任务已排 ' + (pm[plan.id] || 0) + ' / 应排 ' + plan.hours + ' 节</div>');
        else out.push('<div class="pk-muted">提示：本班教学任务里没有这一项（仍可保存）</div>');
      }
      hint.innerHTML = out.join('');
    }
    selS.addEventListener('change', function () {
      var plan = s.plans.filter(function (p) { return p.classId === classId && p.subjectId === selS.value; })[0];
      if (plan && plan.teacherId) selT.value = plan.teacherId;
      updateHint();
    });
    selT.addEventListener('change', updateHint);
    updateHint();

    var buttons = [];
    if (lesson) {
      buttons.push({ text: '清空', danger: true, onClick: function () {
        if (locked) { App.toast('已锁定，请先解锁', 'warn'); return false; }
        Store.clearLesson(classId, day, period); App.toast('已清空', 'ok');
      } });
      buttons.push({ text: locked ? '解锁' : '锁定', onClick: function () {
        Store.toggleLock(lesson.id); App.toast(locked ? '已解锁' : '已锁定，自动排课不会改动它', 'ok');
      } });
    }
    buttons.push({ text: '取消' });
    buttons.push({ text: '保存', primary: true, onClick: function () {
      if (locked) { App.toast('已锁定，请先解锁', 'warn'); return false; }
      if (!selS.value) { App.toast('请先选择科目', 'warn'); return false; }
      var tid = selT.value || null;
      var conf = tid ? (Store.checkPlacement(classId, day, period, tid) || []) : [];
      Store.setLesson(classId, day, period, { subjectId: selS.value, teacherId: tid });
      if (conf.length) App.toast('已保存，但有冲突：' + describeConflicts(M, conf), 'warn');
      else App.toast('已保存', 'ok');
    } });

    var modal = App.modal({ title: '编辑课程', body: body, buttons: buttons });
    body.querySelector('.pk-ed-quick').addEventListener('click', function (e) {
      var b = e.target.closest('.pk-ed-q');
      if (!b || b.disabled) return;
      var x = sugg[+b.getAttribute('data-i')];
      var conf = x.plan.teacherId ? (Store.checkPlacement(classId, day, period, x.plan.teacherId) || []) : [];
      Store.setLesson(classId, day, period, { subjectId: x.plan.subjectId, teacherId: x.plan.teacherId || null });
      modal.close();
      if (!x.ok || conf.length) App.toast('已排入，但有问题：' + (conf.length ? describeConflicts(M, conf) : (x.reason || '')), 'warn');
      else App.toast('已排入', 'ok');
    });
  }

  /* ---------- 自动排课 ---------- */
  function openAutoDialog() {
    if (!window.Scheduler || !Scheduler.run) { App.toast('自动排课模块未加载', 'err'); return; }
    var s = st(), M = maps(s);
    var canCur = ui.mode === 'class' && M.cls[ui.classId];
    var body = document.createElement('div');
    body.className = 'pk-auto';
    body.innerHTML = '<div class="pk-auto-row"><b>排哪些班级：</b>' +
      (canCur ? '<label><input type="radio" name="pk-scope" value="cur" checked> 当前班级（' + esc(M.cls[ui.classId].name) + '）</label>' : '') +
      '<label><input type="radio" name="pk-scope" value="all"' + (canCur ? '' : ' checked') + '> 全部班级（' + s.classes.length + ' 个）</label></div>' +
      '<div class="pk-auto-row"><label><input type="checkbox" data-f="keep" checked> 保留已经排好的课，只把空缺补上</label></div>' +
      '<p class="pk-muted">不勾选时，所选班级里没有锁定的课会先清空再重新排；锁定（🔒）的课不会变动。排完后不满意，可以点「撤销」一键恢复。</p>';
    App.modal({ title: '自动排课', body: body, buttons: [{ text: '取消' }, { text: '开始排课', primary: true, onClick: function () {
      var scope = (body.querySelector('input[name=pk-scope]:checked') || {}).value;
      var keep = body.querySelector('[data-f=keep]').checked;
      var ids = scope === 'cur' ? [ui.classId] : sortedClasses(s).map(function (c) { return c.id; });
      var res;
      try { res = Scheduler.run({ classIds: ids, keepExisting: keep }); } catch (e) { console.error(e); App.toast('自动排课出错：' + e.message, 'err'); return; }
      res = res || { placed: 0, unplaced: [] };
      var un = (res.unplaced || []).filter(function (x) { return x.missing > 0; });
      if (!un.length) { App.toast('自动排课完成：新排入 ' + (res.placed || 0) + ' 节，全部排满', 'ok'); return; }
      App.toast('新排入 ' + (res.placed || 0) + ' 节，还有 ' + un.length + ' 项没排满', 'warn');
      setTimeout(function () { showUnplaced(un); }, 0);
    } }] });
  }

  function showUnplaced(un) {
    var M = maps(st());
    var h = '<p>以下教学任务没能全部排进去（通常是老师时间冲突或格子不够），可以手动调整：</p>' +
      '<div class="pk-tt-scroll"><table class="pk-table"><thead><tr><th>班级</th><th>科目</th><th>老师</th><th>还差</th></tr></thead><tbody>' +
      un.map(function (x) {
        return '<tr><td>' + esc(clsName(M, x.plan.classId)) + '</td><td>' + esc(subjName(M, x.plan.subjectId)) + '</td><td>' +
          esc(teachName(M, x.plan.teacherId) || '未定') + '</td><td><span class="pk-badge pk-badge-warn">' + x.missing + ' 节</span></td></tr>';
      }).join('') + '</tbody></table></div>';
    App.modal({ title: '未排进的课程', body: h, buttons: [{ text: '知道了', primary: true }] });
  }

  /* ---------- 检查页 ---------- */
  function jumpTo(classId, day, period) {
    ui.mode = 'class'; ui.classId = classId; saveUi();
    highlight = { classId: classId, day: day, period: period };
    App.show('timetable');
  }

  function renderCheck(el) {
    var s = st(), M = maps(s);
    var keep = captureScroll(el, 'check');
    var root = document.createElement('div');
    root.className = 'pk-ck';
    root.setAttribute('data-view', 'check');
    var lessonById = {};
    s.lessons.forEach(function (l) { lessonById[l.id] = l; });

    // 1. 冲突
    var conflicts = [];
    try { conflicts = Store.conflicts() || []; } catch (e) { console.error(e); }
    var h = '<div class="pk-card pk-ck-sec"><h3>老师时间冲突 ' +
      (conflicts.length ? '<span class="pk-badge pk-badge-err">' + conflicts.length + ' 处</span>' : '<span class="pk-badge pk-badge-ok">没有冲突</span>') + '</h3>';
    if (!conflicts.length) h += '<div class="pk-muted">✓ 所有老师在同一时间都只上一节课。</div>';
    else {
      h += '<div class="pk-muted">点击班级名可跳到该班课表并高亮对应格子。</div><ul class="pk-ck-conf">';
      conflicts.forEach(function (c) {
        h += '<li><span class="pk-warn-ic">⚠</span> <b>' + esc(slotName(c.day, c.period)) + '</b>　' + esc(teachName(M, c.teacherId) || '某') + '老师同时在：';
        h += (c.lessonIds || []).map(function (id) {
          var l = lessonById[id];
          if (!l) return '';
          return '<button class="pk-link" data-jump="' + esc(l.classId) + '|' + l.day + '|' + l.period + '">' + esc(clsName(M, l.classId)) + '（' + esc(subjName(M, l.subjectId)) + '）</button>';
        }).join('、') + '</li>';
      });
      h += '</ul>';
    }
    h += '</div>';

    // 2. 教学任务完成度
    var pm = placedMap();
    var byClass = {};
    s.plans.forEach(function (p) { (byClass[p.classId] = byClass[p.classId] || []).push(p); });
    var nUnder = 0, nOver = 0;
    s.plans.forEach(function (p) { var x = pm[p.id] || 0; if (x < p.hours) nUnder++; else if (x > p.hours) nOver++; });
    h += '<div class="pk-card pk-ck-sec"><h3>教学任务完成度 ' +
      (nUnder ? '<span class="pk-badge pk-badge-warn">未排满 ' + nUnder + '</span> ' : '') +
      (nOver ? '<span class="pk-badge pk-badge-err">超排 ' + nOver + '</span> ' : '') +
      (!nUnder && !nOver ? '<span class="pk-badge pk-badge-ok">全部完成</span>' : '') + '</h3>' +
      '<label class="pk-ck-opt pk-noprint"><input type="checkbox" data-f="problems"' + (ui.problemsOnly ? ' checked' : '') + '> 只看有问题的</label>' +
      '<div class="pk-tt-scroll" data-sk="plans"><table class="pk-table pk-ck-plan"><thead><tr><th>班级</th><th>科目</th><th>老师</th><th>已排 / 应排</th><th>状态</th></tr></thead><tbody>';
    var anyRow = false;
    sortedClasses(s).forEach(function (c) {
      var ps = (byClass[c.id] || []).slice().sort(function (a, b) { return subjName(M, a.subjectId).localeCompare(subjName(M, b.subjectId), 'zh-CN'); });
      var rows = ps.filter(function (p) { return !ui.problemsOnly || (pm[p.id] || 0) !== Number(p.hours); });
      if (!rows.length) return;
      anyRow = true;
      rows.forEach(function (p, i) {
        var x = pm[p.id] || 0, under = x < p.hours, over = x > p.hours;
        h += '<tr class="' + (under ? 'pk-row-warn' : over ? 'pk-row-err' : '') + '">' +
          (i === 0 ? '<th rowspan="' + rows.length + '" class="pk-ck-cls"><button class="pk-link" data-jump="' + esc(c.id) + '">' + esc(c.name) + '</button></th>' : '') +
          '<td>' + esc(subjName(M, p.subjectId)) + '</td><td>' + esc(teachName(M, p.teacherId) || '未定') + '</td>' +
          '<td>' + x + ' / ' + p.hours + '</td><td>' +
          (under ? '<span class="pk-badge pk-badge-warn">还差 ' + (p.hours - x) + ' 节</span>' : over ? '<span class="pk-badge pk-badge-err">多排 ' + (x - p.hours) + ' 节</span>' : '<span class="pk-badge pk-badge-ok">✓ 完成</span>') +
          '</td></tr>';
      });
    });
    if (!anyRow) h += '<tr><td colspan="5" class="pk-muted">' + (s.plans.length ? '✓ 所有教学任务都已按量排好。' : '还没有教学任务。') + '</td></tr>';
    h += '</tbody></table></div></div>';

    // 3. 课表里有、教学任务里没有的课
    var planKey = {};
    s.plans.forEach(function (p) { planKey[p.classId + '|' + p.subjectId + '|' + (p.teacherId || '')] = true; });
    var orphan = {};
    s.lessons.forEach(function (l) {
      var k = l.classId + '|' + l.subjectId + '|' + (l.teacherId || '');
      if (!planKey[k]) (orphan[k] = orphan[k] || { l: l, n: 0 }).n++;
    });
    var orphanList = Object.keys(orphan).map(function (k) { return orphan[k]; });
    if (orphanList.length) {
      h += '<div class="pk-card pk-ck-sec"><h3>课表中有、但教学任务中没有的课 <span class="pk-badge pk-badge-warn">' + orphanList.length + ' 项</span></h3>' +
        '<div class="pk-muted">这些课不计入上面的完成度。可在「基础数据 → 教学任务」中补充，或检查是否排错老师。</div>' +
        '<div class="pk-tt-scroll"><table class="pk-table"><thead><tr><th>班级</th><th>科目</th><th>老师</th><th>节数</th></tr></thead><tbody>' +
        orphanList.map(function (o) {
          return '<tr><td><button class="pk-link" data-jump="' + esc(o.l.classId) + '|' + o.l.day + '|' + o.l.period + '">' + esc(clsName(M, o.l.classId)) + '</button></td><td>' +
            esc(subjName(M, o.l.subjectId)) + '</td><td>' + esc(teachName(M, o.l.teacherId) || '未定') + '</td><td>' + o.n + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    // 4. 老师课时统计
    var load = [];
    try { load = Store.teacherLoad() || []; } catch (e) { console.error(e); }
    var planHours = {};
    s.plans.forEach(function (p) { if (p.teacherId) planHours[p.teacherId] = (planHours[p.teacherId] || 0) + (Number(p.hours) || 0); });
    load = load.slice().sort(function (a, b) {
      var r = ui.loadSort === 'total' ? (a.total - b.total) : String(a.teacher.name).localeCompare(String(b.teacher.name), 'zh-CN');
      return ui.loadDesc ? -r : r;
    });
    var arrow = function (k) { return ui.loadSort === k ? (ui.loadDesc ? ' ▼' : ' ▲') : ' ⇅'; };
    var clsOrder = sortedClasses(s);
    h += '<div class="pk-card pk-ck-sec"><h3>老师课时统计</h3><div class="pk-muted pk-noprint">点表头「老师」「周课时」可排序；点老师姓名可查看他的课表。</div>' +
      '<div class="pk-tt-scroll" data-sk="load"><table class="pk-table pk-ck-load"><thead><tr>' +
      '<th class="pk-sort" data-sort="name">老师' + arrow('name') + '</th><th class="pk-sort" data-sort="total">周课时' + arrow('total') + '</th>' +
      '<th>任务应排</th><th>各班</th><th>各科</th></tr></thead><tbody>';
    var sum = 0;
    load.forEach(function (x) {
      sum += x.total;
      var bc = clsOrder.filter(function (c) { return x.byClass && x.byClass[c.id]; }).map(function (c) { return esc(c.name) + ' ' + x.byClass[c.id]; }).join('、');
      var bs = Object.keys(x.bySubject || {}).map(function (sid) { return esc(subjName(M, sid)) + ' ' + x.bySubject[sid]; }).join('、');
      var ph = planHours[x.teacher.id] || 0;
      h += '<tr><td><button class="pk-link" data-teacher="' + esc(x.teacher.id) + '">' + esc(x.teacher.name) + '</button></td>' +
        '<td><b>' + x.total + '</b></td><td>' + (ph !== x.total ? '<span class="pk-badge pk-badge-warn">' + ph + '</span>' : ph) + '</td>' +
        '<td>' + (bc || '<span class="pk-muted">—</span>') + '</td><td>' + (bs || '<span class="pk-muted">—</span>') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th>合计</th><th>' + sum + '</th><th colspan="3"></th></tr></tfoot></table></div></div>';

    root.innerHTML = h;
    root.addEventListener('click', function (e) {
      var j = e.target.closest('[data-jump]');
      if (j) {
        var a = j.getAttribute('data-jump').split('|');
        if (a.length === 3) jumpTo(a[0], +a[1], +a[2]);
        else { ui.mode = 'class'; ui.classId = a[0]; saveUi(); highlight = null; App.show('timetable'); }
        return;
      }
      var t = e.target.closest('[data-teacher]');
      if (t) { ui.mode = 'teacher'; ui.teacherId = t.getAttribute('data-teacher'); saveUi(); App.show('timetable'); return; }
      var so = e.target.closest('[data-sort]');
      if (so) {
        var k = so.getAttribute('data-sort');
        if (ui.loadSort === k) ui.loadDesc = !ui.loadDesc; else { ui.loadSort = k; ui.loadDesc = k === 'total'; }
        saveUi(); App.refresh();
      }
    });
    root.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-f') === 'problems') { ui.problemsOnly = e.target.checked; saveUi(); App.refresh(); }
    });
    el.innerHTML = '';
    el.appendChild(root);
    restoreScroll(el, keep);
  }

  /* ---------- 键盘快捷键 ---------- */
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('.pk-modal-mask')) return;
    var cur = App.current && App.current();
    if (cur !== 'timetable' && cur !== 'check') return;
    var k = String(e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) { e.preventDefault(); doRedo(); }
  });

  App.registerView('timetable', { title: '课表', render: renderTimetable });
  App.registerView('check', { title: '检查', render: renderCheck });
})();
