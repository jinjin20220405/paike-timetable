/* views-admin.js — 成员 C：「基础数据」视图（班级 / 科目 / 老师 / 教学任务 / 学期设置） */
(function () {
  'use strict';

  // ---------- UI 状态（render 重调时保持） ----------
  var ui = { sub: 'classes', planClass: '' };
  var SUBS = [['classes', '班级'], ['subjects', '科目'], ['teachers', '老师'], ['plans', '教学任务'], ['settings', '学期设置']];
  var PALETTE = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f',
    '#90a4ae', '#dce775', '#7986cb', '#4fc3f7', '#ff8a65', '#aed581', '#9575cd', '#4dd0e1', '#ffd54f', '#f48fb1'];
  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

  // ---------- 工具 ----------
  function esc(s) { return App.esc(s); }
  function S() { return Store.get(); }
  function find(type, id) {
    if (id == null || id === '') return undefined;
    var arr = S()[type] || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return undefined;
  }
  function nameOf(type, id, dflt) { var o = find(type, id); return o ? o.name : (dflt == null ? '' : dflt); }
  function tName(id) { return id ? nameOf('teachers', id, '（已删除）') : '未指定老师'; }
  function sortedClasses() {
    return S().classes.slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'zh');
    });
  }
  function classRank() { var m = {}; sortedClasses().forEach(function (c, i) { m[c.id] = i; }); return m; }
  function subjectRank() { var m = {}; S().subjects.forEach(function (s, i) { m[s.id] = i; }); return m; }
  function countBy(arr, key) {
    var m = {};
    arr.forEach(function (x) { var k = x[key] == null ? '' : x[key]; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function sumBy(arr, key, field) {
    var m = {};
    arr.forEach(function (x) { m[x[key]] = (m[x[key]] || 0) + (Number(x[field]) || 0); });
    return m;
  }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function trimName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function dupName(type, name, exceptId) {
    return S()[type].some(function (o) { return o.id !== exceptId && trimName(o.name) === name; });
  }
  function slotText(l) { return App.dayName(l.day) + ' ' + App.periodName(l.period); }
  function newId(prefix) { try { return Store.uid(prefix); } catch (e) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } }

  function teacherOptions(sel, emptyText, exceptId) {
    var h = '<option value="">' + esc(emptyText == null ? '未指定' : emptyText) + '</option>';
    S().teachers.forEach(function (t) {
      if (t.id === exceptId) return;
      h += '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    });
    return h;
  }
  function classOptions(sel, emptyText) {
    var h = emptyText != null ? '<option value="">' + esc(emptyText) + '</option>' : '';
    sortedClasses().forEach(function (c) {
      h += '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });
    return h;
  }
  function subjectOptions(sel, exceptId) {
    var h = '';
    S().subjects.forEach(function (s) {
      if (s.id === exceptId) return;
      h += '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    });
    return h;
  }

  /** 带 HTML 内容的确认框 */
  function confirmBox(title, html, okText, onOk, danger) {
    return App.modal({
      title: title,
      body: '<div class="pk-ad-confirm">' + html + '</div>',
      buttons: [{ text: '取消' }, { text: okText || '确定', primary: !danger, danger: !!danger, onClick: onOk }]
    });
  }

  /** 表单弹窗。fields: [{key,label,type,value,options:[[v,t]],placeholder,list,hint,show(vals)}]
   *  onSave(vals, err) 返回 true 关闭；返回 false/调用 err(msg) 保持打开 */
  function formModal(title, fields, okText, onSave) {
    var form = document.createElement('form');
    form.className = 'pk-ad-form';
    form.onsubmit = function (e) { e.preventDefault(); };
    fields.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'pk-ad-frow';
      row.setAttribute('data-key', f.key);
      var id = 'pk-ad-f-' + f.key;
      var inner = '<label class="pk-ad-flabel" for="' + id + '">' + esc(f.label) + '</label><div class="pk-ad-fctl">';
      if (f.type === 'select') {
        inner += '<select class="pk-select" id="' + id + '" name="' + f.key + '">' + f.options.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.value == null ? '' : f.value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>';
      } else if (f.type === 'radio') {
        inner += f.options.map(function (o, i) {
          return '<label class="pk-ad-radio"><input type="radio" name="' + f.key + '" value="' + esc(o[0]) + '"' +
            (String(o[0]) === String(f.value) || (f.value == null && i === 0) ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
        }).join('');
      } else if (f.type === 'checks') {
        inner += '<div class="pk-ad-checks">' + f.options.map(function (o) {
          return '<label class="pk-ad-check"><input type="checkbox" name="' + f.key + '" value="' + esc(o[0]) + '"' +
            (o[2] === false ? '' : ' checked') + '> ' + o[1] + '</label>';
        }).join('') + '</div>';
      } else {
        var t = f.type || 'text';
        inner += '<input class="pk-input" id="' + id + '" name="' + f.key + '" type="' + t + '"' +
          (f.list ? ' list="' + id + '-list"' : '') +
          (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
          (t === 'number' ? ' min="0" max="40" step="1"' : '') +
          ' value="' + esc(f.value == null ? '' : f.value) + '" autocomplete="off">';
        if (f.list) inner += '<datalist id="' + id + '-list">' + f.list.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>';
      }
      if (f.hint) inner += '<div class="pk-ad-hint">' + f.hint + '</div>';
      inner += '</div>';
      row.innerHTML = inner;
      form.appendChild(row);
    });
    var errBox = document.createElement('div');
    errBox.className = 'pk-ad-err';
    form.appendChild(errBox);

    function vals() {
      var v = {};
      fields.forEach(function (f) {
        if (f.type === 'radio') {
          var c = form.querySelector('input[name="' + f.key + '"]:checked'); v[f.key] = c ? c.value : '';
        } else if (f.type === 'checks') {
          v[f.key] = Array.prototype.map.call(form.querySelectorAll('input[name="' + f.key + '"]:checked'), function (x) { return x.value; });
        } else {
          var e = form.querySelector('[name="' + f.key + '"]'); v[f.key] = e ? e.value : '';
        }
      });
      return v;
    }
    function updateVis() {
      var v = vals();
      fields.forEach(function (f) {
        if (!f.show) return;
        var row = form.querySelector('.pk-ad-frow[data-key="' + f.key + '"]');
        if (row) row.style.display = f.show(v) ? '' : 'none';
      });
    }
    form.addEventListener('change', updateVis);
    form.addEventListener('input', function () { errBox.textContent = ''; });
    updateVis();

    var m = App.modal({
      title: title, body: form,
      buttons: [{ text: '取消' }, {
        text: okText || '保存', primary: true, onClick: function () {
          var msg = null;
          var r = onSave(vals(), function (s) { msg = s; });
          if (msg) { errBox.textContent = msg; return false; }
          return r === false ? false : undefined;
        }
      }]
    });
    // 回车提交、自动聚焦
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
        e.preventDefault();
        var btn = form.closest('.pk-modal').querySelector('.pk-btn-primary'); if (btn) btn.click();
      }
    });
    setTimeout(function () { var first = form.querySelector('input[type=text],input:not([type])'); if (first) first.focus(); }, 30);
    return m;
  }

  /** 收集把一组课改给 teacherId 后会产生的冲突 */
  function collectConflicts(lessons, teacherId) {
    if (!teacherId) return [];
    var out = [], seen = {};
    lessons.forEach(function (l) {
      var arr = [];
      try { arr = Store.checkPlacement(l.classId, l.day, l.period, teacherId) || []; } catch (e) { arr = []; }
      arr.forEach(function (c) {
        if (seen[l.id + '|' + c.id]) return;
        seen[l.id + '|' + c.id] = 1;
        out.push({ lesson: l, other: c });
      });
    });
    return out;
  }
  function conflictListHtml(conf, teacherId) {
    var tn = esc(tName(teacherId));
    return '<ul class="pk-ad-conf">' + conf.slice(0, 30).map(function (c) {
      return '<li>' + esc(slotText(c.lesson)) + '：' + esc(nameOf('classes', c.lesson.classId)) + ' ' + esc(nameOf('subjects', c.lesson.subjectId)) +
        ' ⟷ ' + tn + ' 已在 ' + esc(nameOf('classes', c.other.classId)) + ' 上 ' + esc(nameOf('subjects', c.other.subjectId)) + '</li>';
    }).join('') + (conf.length > 30 ? '<li>……共 ' + conf.length + ' 处</li>' : '') + '</ul>';
  }

  function pageHead(title, desc, btns) {
    return '<div class="pk-ad-head"><div><h2 class="pk-ad-h2">' + esc(title) + '</h2>' +
      (desc ? '<div class="pk-muted pk-ad-desc">' + desc + '</div>' : '') + '</div>' +
      '<div class="pk-row pk-noprint">' + (btns || '') + '</div></div>';
  }
  function bind(body, handlers) {
    body.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t || !body.contains(t) || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
      var h = handlers[t.getAttribute('data-act')];
      if (h) { e.preventDefault(); h(t.getAttribute('data-id'), t); }
    });
    body.addEventListener('change', function (e) {
      var t = e.target.closest('[data-chg]');
      if (!t || !body.contains(t)) return;
      var h = handlers[t.getAttribute('data-chg')];
      if (h) h(t.getAttribute('data-id'), t);
    });
  }

  // =====================================================================
  // 班级
  // =====================================================================
  function pageClasses(body) {
    var st = S(), cls = sortedClasses();
    var lc = countBy(st.lessons, 'classId'), ph = sumBy(st.plans, 'classId', 'hours');
    var h = pageHead('班级', '共 ' + cls.length + ' 个班。用 ↑ ↓ 调整显示顺序；新开平行班时可复制已有班级的教学任务。',
      '<button class="pk-btn pk-btn-primary" data-act="add">＋ 新增班级</button>');
    h += '<table class="pk-table pk-ad-table"><thead><tr><th class="pk-ad-w-sort">排序</th><th>班级名称</th><th>年级</th><th>班主任</th><th>周课时（已排 / 计划）</th><th class="pk-ad-w-ops">操作</th></tr></thead><tbody>';
    if (!cls.length) h += '<tr><td colspan="6" class="pk-muted pk-ad-empty">还没有班级，点击右上角「新增班级」。</td></tr>';
    cls.forEach(function (c, i) {
      var placed = lc[c.id] || 0, plan = ph[c.id] || 0;
      var badge = placed === plan ? 'pk-badge-ok' : (placed < plan ? 'pk-badge-warn' : 'pk-badge-err');
      h += '<tr><td class="pk-ad-nowrap">' +
        '<button class="pk-btn pk-ad-sm" data-act="up" data-id="' + esc(c.id) + '"' + (i === 0 ? ' disabled' : '') + ' title="上移">↑</button> ' +
        '<button class="pk-btn pk-ad-sm" data-act="down" data-id="' + esc(c.id) + '"' + (i === cls.length - 1 ? ' disabled' : '') + ' title="下移">↓</button></td>' +
        '<td><b>' + esc(c.name) + '</b></td><td>' + esc(c.grade || '') + '</td>' +
        '<td><select class="pk-select" data-chg="head" data-id="' + esc(c.id) + '">' + teacherOptions(c.headTeacherId, '（无）') + '</select></td>' +
        '<td><span class="pk-badge ' + badge + '">' + placed + ' / ' + plan + '</span></td>' +
        '<td class="pk-ad-nowrap"><button class="pk-btn pk-ad-sm" data-act="edit" data-id="' + esc(c.id) + '">编辑</button> ' +
        '<button class="pk-btn pk-ad-sm pk-btn-danger" data-act="del" data-id="' + esc(c.id) + '">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    body.innerHTML = h;
    bind(body, {
      add: function () { classForm(null); },
      edit: function (id) { classForm(find('classes', id)); },
      del: function (id) { deleteClass(id); },
      up: function (id) { moveClass(id, -1); },
      down: function (id) { moveClass(id, 1); },
      head: function (id, t) {
        Store.update('classes', id, { headTeacherId: t.value || null });
        App.toast('已设置班主任', 'ok');
      }
    });
  }

  function moveClass(id, dir) {
    var cls = sortedClasses();
    var i = cls.findIndex(function (c) { return c.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= cls.length) return;
    var t = cls[i]; cls[i] = cls[j]; cls[j] = t;
    Store.transaction(function () {
      cls.forEach(function (c, k) { if (c.order !== k + 1) Store.update('classes', c.id, { order: k + 1 }); });
    });
  }

  function classForm(c) {
    var st = S();
    var grades = [];
    st.classes.forEach(function (x) { if (x.grade && grades.indexOf(x.grade) < 0) grades.push(x.grade); });
    var tOpts = [['', '（无）']].concat(st.teachers.map(function (t) { return [t.id, t.name]; }));
    var fields = [
      { key: 'name', label: '班级名称', value: c ? c.name : '', placeholder: '如：三（3）班' },
      { key: 'grade', label: '年级', value: c ? c.grade : '', list: grades, placeholder: '如：三年级' },
      { key: 'head', label: '班主任', type: 'select', value: c ? (c.headTeacherId || '') : '', options: tOpts }
    ];
    if (!c) {
      fields.push({ key: 'copyFrom', label: '教学任务', type: 'select', value: '',
        options: [['', '不复制（之后手动添加）']].concat(sortedClasses().map(function (x) {
          return [x.id, '复制「' + x.name + '」的教学任务'];
        })), hint: '新开平行班时，可直接复制同年级班级的科目和每周节数。' });
      fields.push({ key: 'copyT', label: '老师', type: 'radio', value: '0',
        options: [['0', '不复制老师（之后再指定）'], ['1', '同时复制任课老师']],
        show: function (v) { return !!v.copyFrom; } });
    }
    formModal(c ? '编辑班级' : '新增班级', fields, c ? '保存' : '新增', function (v, err) {
      var name = trimName(v.name);
      if (!name) return err('班级名称不能为空');
      if (dupName('classes', name, c && c.id)) return err('已有同名班级「' + name + '」');
      var grade = trimName(v.grade), head = v.head || null;
      if (c) {
        Store.update('classes', c.id, { name: name, grade: grade, headTeacherId: head });
        App.toast('已保存班级「' + name + '」', 'ok');
        return true;
      }
      var maxOrder = 0;
      S().classes.forEach(function (x) { maxOrder = Math.max(maxOrder, x.order || 0); });
      var src = v.copyFrom ? S().plans.filter(function (p) { return p.classId === v.copyFrom; }) : [];
      var copyT = v.copyT === '1';
      Store.transaction(function () {
        var nc = Store.add('classes', { id: newId('c'), name: name, grade: grade, order: maxOrder + 1, headTeacherId: head });
        var cid = (nc && nc.id) || null;
        if (!cid) { var f = S().classes.filter(function (x) { return x.name === name; })[0]; cid = f && f.id; }
        src.forEach(function (p) {
          Store.add('plans', { id: newId('p'), classId: cid, subjectId: p.subjectId, teacherId: copyT ? (p.teacherId || null) : null, hours: p.hours });
        });
      });
      App.toast('已新增班级「' + name + '」' + (src.length ? '，复制了 ' + src.length + ' 条教学任务' : ''), 'ok');
      return true;
    });
  }

  function deleteClass(id) {
    var c = find('classes', id); if (!c) return;
    var st = S();
    var nl = st.lessons.filter(function (l) { return l.classId === id; }).length;
    var np = st.plans.filter(function (p) { return p.classId === id; }).length;
    confirmBox('删除班级', '<p>确定删除班级「<b>' + esc(c.name) + '</b>」吗？</p><p>将同时删除该班 <b>' + nl + '</b> 节课和 <b>' + np +
      '</b> 条教学任务。</p><p class="pk-muted">删除后可以用「课表」页的撤销恢复。</p>', '删除', function () {
      Store.remove('classes', id);
      App.toast('已删除班级「' + c.name + '」', 'ok');
    }, true);
  }

  // =====================================================================
  // 科目
  // =====================================================================
  function charSim(a, b) {
    var A = {}, B = {}, inter = 0, uni = 0;
    String(a).replace(/[\s·/／、与和及]/g, '').split('').forEach(function (ch) { A[ch] = 1; });
    String(b).replace(/[\s·/／、与和及]/g, '').split('').forEach(function (ch) { B[ch] = 1; });
    Object.keys(A).forEach(function (k) { uni++; if (B[k]) inter++; });
    Object.keys(B).forEach(function (k) { if (!A[k]) uni++; });
    return uni ? inter / uni : 0;
  }
  function similarSubjects() {
    var subs = S().subjects, groups = [], used = {};
    for (var i = 0; i < subs.length; i++) {
      if (used[subs[i].id]) continue;
      var g = [subs[i]];
      for (var j = i + 1; j < subs.length; j++) {
        if (used[subs[j].id]) continue;
        var a = subs[i].name, b = subs[j].name;
        if (Math.min(a.length, b.length) >= 3 && charSim(a, b) >= 0.7) { g.push(subs[j]); used[subs[j].id] = 1; }
      }
      if (g.length > 1) { used[subs[i].id] = 1; groups.push(g); }
    }
    return groups;
  }

  function pageSubjects(body) {
    var st = S();
    var lc = countBy(st.lessons, 'subjectId'), pc = countBy(st.plans, 'subjectId');
    var h = pageHead('科目', '共 ' + st.subjects.length + ' 个科目。点击色块可更改课表中的显示颜色。名称不同但其实是同一科目的，可用「合并」。',
      '<button class="pk-btn pk-btn-primary" data-act="add">＋ 新增科目</button>');
    var sim = similarSubjects();
    if (sim.length) {
      h += '<div class="pk-card pk-ad-tip"><b>名称相近、可能是同一科目：</b>' + sim.map(function (g) {
        return '<div class="pk-ad-tipline">' + g.map(function (s) { return '「' + esc(s.name) + '」（' + (lc[s.id] || 0) + '节）'; }).join('、') +
          ' <button class="pk-btn pk-ad-sm" data-act="merge" data-id="' + esc(g[g.length - 1].id) + '">合并…</button></div>';
      }).join('') + '</div>';
    }
    h += '<table class="pk-table pk-ad-table"><thead><tr><th class="pk-ad-w-color">颜色</th><th>科目名称</th><th>已排节数</th><th>教学任务</th><th class="pk-ad-w-ops3">操作</th></tr></thead><tbody>';
    if (!st.subjects.length) h += '<tr><td colspan="5" class="pk-muted pk-ad-empty">还没有科目。</td></tr>';
    st.subjects.forEach(function (s) {
      h += '<tr><td><input type="color" class="pk-ad-color" data-chg="color" data-id="' + esc(s.id) + '" value="' + esc(normColor(s.color)) + '" title="更改颜色"></td>' +
        '<td><span class="pk-ad-chip" style="background:' + esc(normColor(s.color)) + '"></span><b>' + esc(s.name) + '</b></td>' +
        '<td>' + (lc[s.id] || 0) + ' 节</td><td>' + (pc[s.id] || 0) + ' 条</td>' +
        '<td class="pk-ad-nowrap"><button class="pk-btn pk-ad-sm" data-act="edit" data-id="' + esc(s.id) + '">编辑</button> ' +
        '<button class="pk-btn pk-ad-sm" data-act="merge" data-id="' + esc(s.id) + '"' + (st.subjects.length < 2 ? ' disabled' : '') + '>合并到…</button> ' +
        '<button class="pk-btn pk-ad-sm pk-btn-danger" data-act="del" data-id="' + esc(s.id) + '">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    body.innerHTML = h;
    bind(body, {
      add: function () { subjectForm(null); },
      edit: function (id) { subjectForm(find('subjects', id)); },
      del: function (id) { deleteSubject(id); },
      merge: function (id) { mergeSubject(id); },
      color: function (id, t) { Store.update('subjects', id, { color: t.value }); }
    });
  }
  function normColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#90a4ae'; }

  function subjectForm(s) {
    var used = S().subjects.map(function (x) { return String(x.color).toLowerCase(); });
    var dflt = PALETTE.filter(function (c) { return used.indexOf(c) < 0; })[0] || PALETTE[S().subjects.length % PALETTE.length];
    formModal(s ? '编辑科目' : '新增科目', [
      { key: 'name', label: '科目名称', value: s ? s.name : '', placeholder: '如：书法' },
      { key: 'color', label: '颜色', type: 'color', value: s ? normColor(s.color) : dflt }
    ], s ? '保存' : '新增', function (v, err) {
      var name = trimName(v.name);
      if (!name) return err('科目名称不能为空');
      if (dupName('subjects', name, s && s.id)) return err('已有同名科目「' + name + '」');
      if (s) Store.update('subjects', s.id, { name: name, color: v.color });
      else Store.add('subjects', { id: newId('s'), name: name, color: v.color });
      App.toast((s ? '已保存' : '已新增') + '科目「' + name + '」', 'ok');
      return true;
    });
  }

  function deleteSubject(id) {
    var s = find('subjects', id); if (!s) return;
    var st = S();
    var nl = st.lessons.filter(function (l) { return l.subjectId === id; }).length;
    var np = st.plans.filter(function (p) { return p.subjectId === id; }).length;
    confirmBox('删除科目', '<p>确定删除科目「<b>' + esc(s.name) + '</b>」吗？</p><p>将同时删除课表中 <b>' + nl + '</b> 节该科目的课和 <b>' + np +
      '</b> 条教学任务。</p>' + (nl ? '<p class="pk-muted">如果只是名称写法不同，请改用「合并到…」，课不会丢失。</p>' : ''), '删除', function () {
      Store.remove('subjects', id);
      App.toast('已删除科目「' + s.name + '」', 'ok');
    }, true);
  }

  function mergeSubject(id) {
    var a = find('subjects', id); if (!a) return;
    if (S().subjects.length < 2) return App.toast('只有一个科目，无法合并', 'warn');
    // 默认目标：名称最相近的科目
    var best = null, bs = -1;
    S().subjects.forEach(function (s) { if (s.id !== id) { var v = charSim(s.name, a.name); if (v > bs) { bs = v; best = s; } } });
    var st = S();
    var nl = st.lessons.filter(function (l) { return l.subjectId === id; }).length;
    var np = st.plans.filter(function (p) { return p.subjectId === id; }).length;
    formModal('合并科目', [
      { key: 'to', label: '合并到', type: 'select', value: best ? best.id : '', options: S().subjects.filter(function (s) { return s.id !== id; }).map(function (s) { return [s.id, s.name]; }),
        hint: '「' + esc(a.name) + '」的 ' + nl + ' 节课、' + np + ' 条教学任务将改为所选科目，然后删除「' + esc(a.name) + '」。同班同老师的教学任务会合并节数。' }
    ], '合并', function (v, err) {
      var b = find('subjects', v.to);
      if (!b) return err('请选择要合并到的科目');
      doMergeSubject(a, b);
      App.toast('已把「' + a.name + '」合并到「' + b.name + '」（' + nl + ' 节课）', 'ok');
      return true;
    });
  }
  function doMergeSubject(a, b) {
    var st = S();
    var plansA = st.plans.filter(function (p) { return p.subjectId === a.id; }).map(function (p) { return { id: p.id, classId: p.classId, teacherId: p.teacherId || null, hours: Number(p.hours) || 0 }; });
    var bMap = {};
    st.plans.forEach(function (p) { if (p.subjectId === b.id) bMap[p.classId + '|' + (p.teacherId || '')] = { id: p.id, hours: Number(p.hours) || 0 }; });
    var lessonIds = st.lessons.filter(function (l) { return l.subjectId === a.id; }).map(function (l) { return l.id; });
    Store.transaction(function () {
      plansA.forEach(function (p) {
        var k = p.classId + '|' + (p.teacherId || ''), dup = bMap[k];
        if (dup) { dup.hours += p.hours; Store.update('plans', dup.id, { hours: dup.hours }); Store.remove('plans', p.id); }
        else { Store.update('plans', p.id, { subjectId: b.id }); bMap[k] = { id: p.id, hours: p.hours }; }
      });
      lessonIds.forEach(function (lid) { Store.update('lessons', lid, { subjectId: b.id }); });
      Store.remove('subjects', a.id);
    });
  }

  // =====================================================================
  // 老师
  // =====================================================================
  function teacherPairs(tid) {
    var st = S(), map = {}, list = [];
    function get(cid, sid) {
      var k = cid + '|' + sid;
      if (!map[k]) { map[k] = { classId: cid, subjectId: sid, plans: [], lessons: [] }; list.push(map[k]); }
      return map[k];
    }
    st.plans.forEach(function (p) { if (p.teacherId === tid) get(p.classId, p.subjectId).plans.push(p); });
    st.lessons.forEach(function (l) { if (l.teacherId === tid) get(l.classId, l.subjectId).lessons.push(l); });
    var cr = classRank(), sr = subjectRank();
    list.sort(function (x, y) { return (cr[x.classId] || 0) - (cr[y.classId] || 0) || (sr[x.subjectId] || 0) - (sr[y.subjectId] || 0); });
    return list;
  }

  function pageTeachers(body) {
    var st = S();
    var lc = countBy(st.lessons, 'teacherId'), ph = sumBy(st.plans.filter(function (p) { return p.teacherId; }), 'teacherId', 'hours');
    var heads = {};
    st.classes.forEach(function (c) { if (c.headTeacherId) (heads[c.headTeacherId] = heads[c.headTeacherId] || []).push(c.name); });
    var unassigned = lc[''] || 0;
    var h = pageHead('老师', '共 ' + st.teachers.length + ' 位老师。' + (unassigned ? '<span class="pk-badge pk-badge-warn">有 ' + unassigned + ' 节课未指定老师</span> ' : '') +
      '老师调动时用「换老师」，可一次把其任教的班级/科目转给另一位老师。',
      '<button class="pk-btn pk-btn-primary" data-act="add">＋ 新增老师</button>');
    h += '<table class="pk-table pk-ad-table"><thead><tr><th>姓名</th><th>备注</th><th>任教班级与科目</th><th>周课时（已排 / 计划）</th><th class="pk-ad-w-ops3">操作</th></tr></thead><tbody>';
    if (!st.teachers.length) h += '<tr><td colspan="5" class="pk-muted pk-ad-empty">还没有老师。</td></tr>';
    st.teachers.forEach(function (t) {
      var pairs = teacherPairs(t.id), byClass = [], cm = {};
      pairs.forEach(function (p) {
        if (!cm[p.classId]) { cm[p.classId] = []; byClass.push(p.classId); }
        cm[p.classId].push(nameOf('subjects', p.subjectId));
      });
      var teach = byClass.map(function (cid) { return '<span class="pk-ad-tc"><b>' + esc(nameOf('classes', cid)) + '</b>：' + esc(cm[cid].join('、')) + '</span>'; }).join('');
      if (heads[t.id]) teach = '<span class="pk-badge">班主任：' + esc(heads[t.id].join('、')) + '</span> ' + teach;
      var placed = lc[t.id] || 0, plan = ph[t.id] || 0;
      h += '<tr><td class="pk-ad-nowrap"><b>' + esc(t.name) + '</b></td><td class="pk-muted">' + esc(t.note || '') + '</td>' +
        '<td>' + (teach || '<span class="pk-muted">暂无</span>') + '</td>' +
        '<td><span class="pk-badge ' + (placed === plan ? 'pk-badge-ok' : 'pk-badge-warn') + '">' + placed + ' / ' + plan + '</span></td>' +
        '<td class="pk-ad-nowrap"><button class="pk-btn pk-ad-sm" data-act="edit" data-id="' + esc(t.id) + '">编辑</button> ' +
        '<button class="pk-btn pk-ad-sm" data-act="swap" data-id="' + esc(t.id) + '"' + (pairs.length ? '' : ' disabled') + '>换老师</button> ' +
        '<button class="pk-btn pk-ad-sm pk-btn-danger" data-act="del" data-id="' + esc(t.id) + '">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    body.innerHTML = h;
    bind(body, {
      add: function () { teacherForm(null); },
      edit: function (id) { teacherForm(find('teachers', id)); },
      del: function (id) { deleteTeacher(id); },
      swap: function (id) { swapTeacher(id); }
    });
  }

  function teacherForm(t) {
    formModal(t ? '编辑老师' : '新增老师', [
      { key: 'name', label: '姓名', value: t ? t.name : '' },
      { key: 'note', label: '备注', value: t ? (t.note || '') : '', placeholder: '可不填，如：兼教务' }
    ], t ? '保存' : '新增', function (v, err) {
      var name = trimName(v.name);
      if (!name) return err('姓名不能为空');
      if (dupName('teachers', name, t && t.id)) return err('已有同名老师「' + name + '」，如确为两人请加以区分（如「' + name + '（数学）」）');
      if (t) Store.update('teachers', t.id, { name: name, note: trimName(v.note) });
      else Store.add('teachers', { id: newId('t'), name: name, note: trimName(v.note) });
      App.toast((t ? '已保存' : '已新增') + '老师「' + name + '」', 'ok');
      return true;
    });
  }

  function deleteTeacher(id) {
    var t = find('teachers', id); if (!t) return;
    var st = S();
    var nl = st.lessons.filter(function (l) { return l.teacherId === id; }).length;
    var np = st.plans.filter(function (p) { return p.teacherId === id; }).length;
    var nh = st.classes.filter(function (c) { return c.headTeacherId === id; }).map(function (c) { return c.name; });
    confirmBox('删除老师', '<p>确定删除老师「<b>' + esc(t.name) + '</b>」吗？</p><p>其已排的 <b>' + nl + '</b> 节课和 <b>' + np +
      '</b> 条教学任务将变为「未指定老师」（课本身保留）。' + (nh.length ? '同时取消其 ' + esc(nh.join('、')) + ' 的班主任。' : '') + '</p>' +
      (nl ? '<p class="pk-muted">如果是老师调动，建议先用「换老师」把课转给接任老师。</p>' : ''), '删除', function () {
      Store.remove('teachers', id);
      App.toast('已删除老师「' + t.name + '」', 'ok');
    }, true);
  }

  function swapTeacher(fromId) {
    var from = find('teachers', fromId); if (!from) return;
    var pairs = teacherPairs(fromId);
    if (!pairs.length) return App.toast('该老师没有教学任务或已排课', 'warn');
    var tOpts = [['', '— 请选择 —']].concat(S().teachers.filter(function (t) { return t.id !== fromId; }).map(function (t) { return [t.id, t.name]; }))
      .concat([['__new__', '＋ 新老师（输入姓名）']]);
    formModal('换老师：' + from.name, [
      { key: 'pairs', label: '要转交的', type: 'checks', options: pairs.map(function (p, i) {
        var hrs = p.plans.reduce(function (s, x) { return s + (Number(x.hours) || 0); }, 0);
        return [String(i), esc(nameOf('classes', p.classId)) + ' · ' + esc(nameOf('subjects', p.subjectId)) +
          ' <span class="pk-muted">（计划 ' + hrs + ' 节，已排 ' + p.lessons.length + ' 节）</span>'];
      }) },
      { key: 'to', label: '转给', type: 'select', value: '', options: tOpts },
      { key: 'newName', label: '新老师姓名', value: '', show: function (v) { return v.to === '__new__'; } }
    ], '下一步', function (v, err) {
      var sel = v.pairs.map(function (i) { return pairs[Number(i)]; });
      if (!sel.length) return err('请至少勾选一项');
      if (!v.to) return err('请选择接任的老师');
      var newName = null, toId = v.to;
      if (toId === '__new__') {
        newName = trimName(v.newName);
        if (!newName) return err('请输入新老师姓名');
        if (dupName('teachers', newName)) return err('已有老师「' + newName + '」，请直接在列表中选择');
        toId = null;
      }
      var lessons = [], plans = [];
      sel.forEach(function (p) { lessons = lessons.concat(p.lessons); plans = plans.concat(p.plans); });
      var conf = toId ? collectConflicts(lessons, toId) : [];
      var toName = newName || nameOf('teachers', toId);
      setTimeout(function () {
        var html = '<p>将把「<b>' + esc(from.name) + '</b>」的 <b>' + plans.length + '</b> 条教学任务、<b>' + lessons.length + '</b> 节已排课转给「<b>' + esc(toName) + '</b>」' +
          (newName ? '（新建老师）' : '') + '：</p><p class="pk-muted">' + sel.map(function (p) { return esc(nameOf('classes', p.classId) + ' ' + nameOf('subjects', p.subjectId)); }).join('、') + '</p>';
        if (conf.length) html += '<p class="pk-ad-warn">⚠ 发现 ' + conf.length + ' 处时间冲突（' + esc(toName) + ' 同一时间已有课）：</p>' + conflictListHtml(conf, toId) +
          '<p class="pk-muted">仍可转交，之后在「检查」页处理冲突。</p>';
        else html += '<p class="pk-ad-ok">✓ 没有时间冲突。</p>';
        confirmBox('确认换老师', html, conf.length ? '仍然转交' : '确定转交', function () {
          doSwap(plans, lessons, toId, newName);
          App.toast('已转交给「' + toName + '」：' + lessons.length + ' 节课' + (conf.length ? '，有 ' + conf.length + ' 处冲突待处理' : ''), conf.length ? 'warn' : 'ok');
        });
      }, 0);
      return true;
    });
  }
  function doSwap(plans, lessons, toId, newName) {
    var st = S();
    var tMap = {};
    if (toId) st.plans.forEach(function (p) { if (p.teacherId === toId) tMap[p.classId + '|' + p.subjectId] = { id: p.id, hours: Number(p.hours) || 0 }; });
    var pl = plans.map(function (p) { return { id: p.id, classId: p.classId, subjectId: p.subjectId, hours: Number(p.hours) || 0 }; });
    var lids = lessons.map(function (l) { return l.id; });
    Store.transaction(function () {
      if (!toId) {
        var nt = Store.add('teachers', { id: newId('t'), name: newName, note: '' });
        toId = (nt && nt.id) || (S().teachers.filter(function (t) { return t.name === newName; })[0] || {}).id;
      }
      pl.forEach(function (p) {
        var k = p.classId + '|' + p.subjectId, dup = tMap[k];
        if (dup) { dup.hours += p.hours; Store.update('plans', dup.id, { hours: dup.hours }); Store.remove('plans', p.id); }
        else { Store.update('plans', p.id, { teacherId: toId }); tMap[k] = { id: p.id, hours: p.hours }; }
      });
      lids.forEach(function (id) { Store.update('lessons', id, { teacherId: toId }); });
    });
  }

  // =====================================================================
  // 教学任务
  // =====================================================================
  function placedMap() {
    var m = {};
    try {
      (Store.planStatus() || []).forEach(function (x) { if (x && x.plan) m[x.plan.id] = x.placed; });
      return m;
    } catch (e) {
      var st = S();
      st.plans.forEach(function (p) {
        m[p.id] = st.lessons.filter(function (l) { return l.classId === p.classId && l.subjectId === p.subjectId && (l.teacherId || null) === (p.teacherId || null); }).length;
      });
      return m;
    }
  }

  function pageplans(body) {
    var st = S();
    if (ui.planClass && !find('classes', ui.planClass)) ui.planClass = '';
    var cr = classRank(), sr = subjectRank(), pm = placedMap();
    var plans = st.plans.filter(function (p) { return !ui.planClass || p.classId === ui.planClass; })
      .sort(function (a, b) { return (cr[a.classId] || 0) - (cr[b.classId] || 0) || (sr[a.subjectId] || 0) - (sr[b.subjectId] || 0); });
    var totH = 0, totP = 0;
    var h = pageHead('教学任务', '教学任务 = 某班某科由谁教、每周几节，是自动排课的依据。老师和节数可以直接在表格里改。',
      '<label class="pk-muted">班级：</label><select class="pk-select" data-chg="filter">' + classOptions(ui.planClass, '全部班级') + '</select>' +
      '<button class="pk-btn pk-btn-primary" data-act="add">＋ 新增教学任务</button>' +
      '<button class="pk-btn" data-act="regen" title="以课表中实际已排的课为准，重新生成教学任务">按当前课表重新生成</button>');
    h += '<table class="pk-table pk-ad-table"><thead><tr><th>班级</th><th>科目</th><th>老师</th><th class="pk-ad-w-num">每周节数</th><th>已排 / 应排</th><th class="pk-ad-w-ops1">操作</th></tr></thead><tbody>';
    if (!plans.length) h += '<tr><td colspan="6" class="pk-muted pk-ad-empty">' + (ui.planClass ? '该班' : '') + '暂无教学任务。可点「新增教学任务」，或「按当前课表重新生成」。</td></tr>';
    plans.forEach(function (p) {
      var placed = pm[p.id] || 0, hrs = Number(p.hours) || 0;
      totH += hrs; totP += placed;
      var badge = placed === hrs ? 'pk-badge-ok' : (placed < hrs ? 'pk-badge-warn' : 'pk-badge-err');
      var sub = find('subjects', p.subjectId);
      h += '<tr><td>' + esc(nameOf('classes', p.classId)) + '</td>' +
        '<td><span class="pk-ad-chip" style="background:' + esc(normColor(sub && sub.color)) + '"></span>' + esc(sub ? sub.name : '（已删除）') + '</td>' +
        '<td><select class="pk-select' + (p.teacherId ? '' : ' pk-ad-unset') + '" data-chg="teacher" data-id="' + esc(p.id) + '">' + teacherOptions(p.teacherId, '未指定老师') + '</select></td>' +
        '<td><input type="number" class="pk-input pk-ad-num" min="0" max="40" step="1" data-chg="hours" data-id="' + esc(p.id) + '" value="' + hrs + '"></td>' +
        '<td><span class="pk-badge ' + badge + '">' + placed + ' / ' + hrs + '</span>' + (placed > hrs ? ' <span class="pk-muted">超排</span>' : (placed < hrs ? ' <span class="pk-muted">差 ' + (hrs - placed) + '</span>' : '')) + '</td>' +
        '<td><button class="pk-btn pk-ad-sm pk-btn-danger" data-act="del" data-id="' + esc(p.id) + '">删除</button></td></tr>';
    });
    if (plans.length) h += '<tr class="pk-ad-total"><td colspan="3">合计（' + plans.length + ' 条）</td><td>' + totH + '</td><td>' + totP + ' / ' + totH + '</td><td></td></tr>';
    h += '</tbody></table>';
    body.innerHTML = h;
    bind(body, {
      filter: function (id, t) { ui.planClass = t.value; App.refresh(); },
      add: function () { planForm(); },
      del: function (id) { deletePlan(id); },
      regen: function () { regenPlans(); },
      hours: function (id, t) {
        var n = Number(t.value);
        if (t.value === '' || !isFinite(n) || n < 0 || n > 40 || Math.floor(n) !== n) {
          App.toast('每周节数应为 0～40 的整数', 'err'); App.refresh(); return;
        }
        Store.update('plans', id, { hours: n });
        App.toast('已改为每周 ' + n + ' 节', 'ok');
      },
      teacher: function (id, t) { changePlanTeacher(id, t.value || null); }
    });
  }

  function changePlanTeacher(planId, newT) {
    var st = S(), p = find('plans', planId); if (!p) return;
    var oldT = p.teacherId || null;
    if (oldT === newT) return;
    var lessons = st.lessons.filter(function (l) { return l.classId === p.classId && l.subjectId === p.subjectId && (l.teacherId || null) === oldT; });
    var dup = st.plans.filter(function (q) { return q.id !== p.id && q.classId === p.classId && q.subjectId === p.subjectId && (q.teacherId || null) === newT; })[0];
    var conf = collectConflicts(lessons, newT);
    var label = nameOf('classes', p.classId) + ' ' + nameOf('subjects', p.subjectId);
    var lids = lessons.map(function (l) { return l.id; }), hours = Number(p.hours) || 0;
    function apply() {
      Store.transaction(function () {
        if (dup) { Store.update('plans', dup.id, { hours: (Number(dup.hours) || 0) + hours }); Store.remove('plans', p.id); }
        else Store.update('plans', p.id, { teacherId: newT });
        lids.forEach(function (id) { Store.update('lessons', id, { teacherId: newT }); });
      });
      App.toast(label + ' 改由「' + tName(newT) + '」任教' + (lids.length ? '，已同步 ' + lids.length + ' 节课' : '') +
        (conf.length ? '，有 ' + conf.length + ' 处冲突' : ''), conf.length ? 'warn' : 'ok');
    }
    if (!conf.length) return apply();
    App.refresh(); // 先恢复下拉框显示，取消时不残留
    confirmBox('老师时间冲突', '<p>把 <b>' + esc(label) + '</b> 改为「<b>' + esc(tName(newT)) + '</b>」后，以下时间会冲突：</p>' + conflictListHtml(conf, newT) +
      '<p class="pk-muted">仍可更换，之后在「检查」页或课表中调整。</p>', '仍然更换', apply);
  }

  function planForm() {
    var st = S();
    if (!st.classes.length || !st.subjects.length) return App.toast('请先添加班级和科目', 'warn');
    formModal('新增教学任务', [
      { key: 'classId', label: '班级', type: 'select', value: ui.planClass || sortedClasses()[0].id, options: sortedClasses().map(function (c) { return [c.id, c.name]; }) },
      { key: 'subjectId', label: '科目', type: 'select', value: '', options: st.subjects.map(function (s) { return [s.id, s.name]; }) },
      { key: 'teacherId', label: '老师', type: 'select', value: '', options: [['', '未指定老师']].concat(st.teachers.map(function (t) { return [t.id, t.name]; })) },
      { key: 'hours', label: '每周节数', type: 'number', value: 1 }
    ], '新增', function (v, err) {
      var n = Number(v.hours);
      if (!v.classId || !v.subjectId) return err('请选择班级和科目');
      if (v.hours === '' || !isFinite(n) || n < 0 || n > 40 || Math.floor(n) !== n) return err('每周节数应为 0～40 的整数');
      var tid = v.teacherId || null;
      if (S().plans.some(function (p) { return p.classId === v.classId && p.subjectId === v.subjectId && (p.teacherId || null) === tid; }))
        return err('该班已有这门课、这位老师的教学任务，请直接修改节数');
      Store.add('plans', { id: newId('p'), classId: v.classId, subjectId: v.subjectId, teacherId: tid, hours: n });
      App.toast('已新增：' + nameOf('classes', v.classId) + ' ' + nameOf('subjects', v.subjectId) + ' 每周 ' + n + ' 节', 'ok');
      return true;
    });
  }

  function deletePlan(id) {
    var p = find('plans', id); if (!p) return;
    var pm = placedMap(), placed = pm[id] || 0;
    confirmBox('删除教学任务', '<p>确定删除「<b>' + esc(nameOf('classes', p.classId) + ' ' + nameOf('subjects', p.subjectId) + '（' + tName(p.teacherId) + '）') +
      '</b>」这条教学任务吗？</p>' + (placed ? '<p>课表中已排的 ' + placed + ' 节课不会删除，仍保留在课表里。</p>' : ''), '删除', function () {
      Store.remove('plans', id);
      App.toast('已删除教学任务', 'ok');
    }, true);
  }

  function regenPlans() {
    var st = S();
    var cids = ui.planClass ? [ui.planClass] : st.classes.map(function (c) { return c.id; });
    var inScope = {}; cids.forEach(function (c) { inScope[c] = 1; });
    var groups = {}, order = [];
    st.lessons.forEach(function (l) {
      if (!inScope[l.classId] || !l.subjectId) return;
      var k = l.classId + '|' + l.subjectId + '|' + (l.teacherId || '');
      if (!groups[k]) { groups[k] = { classId: l.classId, subjectId: l.subjectId, teacherId: l.teacherId || null, hours: 0 }; order.push(k); }
      groups[k].hours++;
    });
    var old = st.plans.filter(function (p) { return inScope[p.classId]; }).map(function (p) { return p.id; });
    var scopeName = ui.planClass ? '「' + nameOf('classes', ui.planClass) + '」' : '全部 ' + cids.length + ' 个班';
    confirmBox('按当前课表重新生成教学任务', '<p>将删除' + esc(scopeName) + '现有的 <b>' + old.length + '</b> 条教学任务，按课表中实际已排的课重新生成 <b>' + order.length +
      '</b> 条（每周节数 = 已排节数）。</p><p class="pk-muted">课表中没有排课的教学任务将被删除。适用于手工调好课表后，把教学任务同步为实际情况。可撤销。</p>', '重新生成', function () {
      Store.transaction(function () {
        old.forEach(function (id) { Store.remove('plans', id); });
        order.forEach(function (k) { var g = groups[k]; Store.add('plans', { id: newId('p'), classId: g.classId, subjectId: g.subjectId, teacherId: g.teacherId, hours: g.hours }); });
      });
      App.toast('已重新生成 ' + order.length + ' 条教学任务', 'ok');
    });
  }

  // =====================================================================
  // 学期设置
  // =====================================================================
  function pageSettings(body) {
    var st = S(), set = st.settings, P = set.periods, D = set.days, B = set.breaks || [];
    var dc = countBy(st.lessons, 'day'), pc = countBy(st.lessons, 'period');
    var h = pageHead('学期设置', '修改后课表、导出立即按新设置显示。');
    h += '<div class="pk-card pk-ad-sec"><h3>标题</h3><div class="pk-row"><input class="pk-input pk-ad-wide" data-id="title" value="' + esc(st.meta.title || '') +
      '" placeholder="如：2026年秋季学期"><button class="pk-btn pk-btn-primary" data-act="saveTitle">保存标题</button>' +
      '<span class="pk-muted">导出时课表标题为「标题 + 班级名 + 课表」。</span></div></div>';

    h += '<div class="pk-ad-cols">';
    // 星期
    h += '<div class="pk-card pk-ad-sec"><h3>上课日（星期）</h3><table class="pk-table"><thead><tr><th>#</th><th>名称</th><th>已排</th><th></th></tr></thead><tbody>';
    D.forEach(function (d, i) {
      h += '<tr><td>' + (i + 1) + '</td><td><input class="pk-input" data-chg="dayName" data-id="' + i + '" value="' + esc(d) + '"></td><td>' + (dc[i] || 0) + ' 节</td>' +
        '<td><button class="pk-btn pk-ad-sm pk-btn-danger" data-act="delDay" data-id="' + i + '"' + (D.length <= 1 ? ' disabled' : '') + '>删除</button></td></tr>';
    });
    h += '</tbody></table><div class="pk-row pk-ad-mt">';
    ['星期六', '星期日'].forEach(function (n) { if (D.indexOf(n) < 0) h += '<button class="pk-btn" data-act="addDay" data-id="' + n + '">＋ ' + n + '</button>'; });
    h += '<input class="pk-input" data-id="newDay" placeholder="其他名称"><button class="pk-btn" data-act="addDayCustom">添加</button></div></div>';

    // 节次
    h += '<div class="pk-card pk-ad-sec"><h3>节次</h3><table class="pk-table"><thead><tr><th>#</th><th>名称</th><th>已排</th><th></th></tr></thead><tbody>';
    P.forEach(function (p, i) {
      h += '<tr><td>' + (i + 1) + '</td><td><input class="pk-input" data-chg="periodName" data-id="' + i + '" value="' + esc(p) + '"></td><td>' + (pc[i] || 0) + ' 节</td>' +
        '<td><button class="pk-btn pk-ad-sm pk-btn-danger" data-act="delPeriod" data-id="' + i + '"' + (P.length <= 1 ? ' disabled' : '') + '>删除</button></td></tr>';
    });
    h += '</tbody></table><div class="pk-row pk-ad-mt"><button class="pk-btn" data-act="addPeriod">＋ 增加「' + esc(defaultPeriodName(P.length)) + '」</button></div></div>';

    // 分隔行
    h += '<div class="pk-card pk-ad-sec"><h3>分隔行（课间操、眼保健操等）</h3><table class="pk-table"><thead><tr><th>位置</th><th>名称</th><th></th></tr></thead><tbody>';
    if (!B.length) h += '<tr><td colspan="3" class="pk-muted">无</td></tr>';
    B.forEach(function (b, i) {
      var opts = '';
      for (var k = 1; k < P.length; k++) opts += '<option value="' + k + '"' + (k === b.after ? ' selected' : '') + '>' + esc(P[k - 1]) + ' 之后</option>';
      if (!(b.after >= 1 && b.after < P.length)) opts = '<option value="" selected>（位置无效）</option>' + opts;
      h += '<tr><td><select class="pk-select" data-chg="brAfter" data-id="' + i + '">' + opts + '</select></td>' +
        '<td><input class="pk-input" data-chg="brLabel" data-id="' + i + '" value="' + esc(b.label) + '"></td>' +
        '<td><button class="pk-btn pk-ad-sm pk-btn-danger" data-act="delBreak" data-id="' + i + '">删除</button></td></tr>';
    });
    h += '</tbody></table><div class="pk-row pk-ad-mt"><button class="pk-btn" data-act="addBreak">＋ 增加分隔行</button></div></div>';
    h += '</div>';
    body.innerHTML = h;

    function setArr(kind, arr, msg) { var o = {}; o[kind] = arr; Store.setSettings(o); if (msg) App.toast(msg, 'ok'); }
    function brks() { return (S().settings.breaks || []).map(function (b) { return { after: b.after, label: b.label }; }); }
    bind(body, {
      saveTitle: function () {
        var v = trimName(body.querySelector('[data-id="title"]').value);
        if (!v) return App.toast('标题不能为空', 'err');
        Store.setMeta({ title: v }); App.toast('已保存标题', 'ok');
      },
      dayName: function (i, t) { renameItem('days', Number(i), t.value); },
      periodName: function (i, t) { renameItem('periods', Number(i), t.value); },
      addDay: function (n) { addItem('days', n); },
      addDayCustom: function () { addItem('days', trimName(body.querySelector('[data-id="newDay"]').value)); },
      addPeriod: function () { addItem('periods', defaultPeriodName(S().settings.periods.length)); },
      delDay: function (i) { removeIndex('days', Number(i)); },
      delPeriod: function (i) { removeIndex('periods', Number(i)); },
      addBreak: function () {
        var b = brks(), n = S().settings.periods.length;
        var used = b.map(function (x) { return x.after; }), after = 1;
        for (var k = 1; k < n; k++) if (used.indexOf(k) < 0) { after = k; break; }
        b.push({ after: after, label: '课间' });
        b.sort(function (x, y) { return x.after - y.after; });
        setArr('breaks', b, '已增加分隔行');
      },
      delBreak: function (i) {
        var b = brks(), x = b[Number(i)]; if (!x) return;
        confirmBox('删除分隔行', '<p>确定删除分隔行「' + esc(x.label) + '」吗？（不影响已排课）</p>', '删除', function () {
          b.splice(Number(i), 1); setArr('breaks', b, '已删除分隔行');
        }, true);
      },
      brAfter: function (i, t) {
        var b = brks(); if (!b[Number(i)] || !t.value) return;
        b[Number(i)].after = Number(t.value);
        b.sort(function (x, y) { return x.after - y.after; });
        setArr('breaks', b, '已调整分隔行位置');
      },
      brLabel: function (i, t) {
        var v = trimName(t.value), b = brks();
        if (!v) { App.toast('名称不能为空', 'err'); App.refresh(); return; }
        b[Number(i)].label = v; setArr('breaks', b, '已保存');
      }
    });
  }
  function defaultPeriodName(n) { return '第' + (CN_NUM[n] || (n + 1)) + '节'; }

  function renameItem(kind, i, value) {
    var v = trimName(value), arr = S().settings[kind].slice();
    if (!v) { App.toast('名称不能为空', 'err'); App.refresh(); return; }
    if (arr.some(function (x, k) { return k !== i && x === v; })) { App.toast('已有同名「' + v + '」', 'err'); App.refresh(); return; }
    arr[i] = v;
    var o = {}; o[kind] = arr; Store.setSettings(o);
    App.toast('已改名为「' + v + '」', 'ok');
  }
  function addItem(kind, name) {
    var arr = S().settings[kind].slice();
    if (!name) return App.toast('请输入名称', 'err');
    if (arr.indexOf(name) >= 0) return App.toast('已有「' + name + '」', 'err');
    if (arr.length >= 15) return App.toast('最多 15 项', 'err');
    arr.push(name);
    var o = {}; o[kind] = arr; Store.setSettings(o);
    App.toast('已增加「' + name + '」', 'ok');
  }
  function removeIndex(kind, idx) {
    var st = S(), arr = st.settings[kind].slice(), field = kind === 'days' ? 'day' : 'period';
    if (arr.length <= 1) return App.toast('至少保留一项', 'err');
    var name = arr[idx];
    var del = st.lessons.filter(function (l) { return l[field] === idx; }).map(function (l) { return l.id; });
    var shift = st.lessons.filter(function (l) { return l[field] > idx; })
      .sort(function (a, b) { return a[field] - b[field]; }).map(function (l) { return { id: l.id, v: l[field] - 1 }; });
    var locked = st.lessons.filter(function (l) { return l[field] === idx && l.locked; }).length;
    confirmBox('删除「' + name + '」', '<p>确定删除「<b>' + esc(name) + '</b>」吗？</p><p>将删除课表中该' + (kind === 'days' ? '天' : '节') + '的 <b>' + del.length + '</b> 节课' +
      (locked ? '（含 ' + locked + ' 节已锁定）' : '') + '，' + (shift.length ? '后面的课依次前移。' : '') + '</p><p class="pk-muted">可撤销。</p>', '删除', function () {
      Store.transaction(function () {
        del.forEach(function (id) { Store.remove('lessons', id); });
        shift.forEach(function (s) { var o = {}; o[field] = s.v; Store.update('lessons', s.id, o); });
        arr.splice(idx, 1);
        var patch = {}; patch[kind] = arr;
        if (kind === 'periods') {
          patch.breaks = (st.settings.breaks || []).map(function (b) { return { after: b.after > idx ? b.after - 1 : b.after, label: b.label }; })
            .filter(function (b) { return b.after >= 1 && b.after < arr.length; });
        }
        Store.setSettings(patch);
      });
      App.toast('已删除「' + name + '」' + (del.length ? '及 ' + del.length + ' 节课' : ''), 'ok');
    }, true);
  }

  // =====================================================================
  var PAGES = { classes: pageClasses, subjects: pageSubjects, teachers: pageTeachers, plans: pageplans, settings: pageSettings };

  function render(el) {
    var root = document.createElement('div');
    root.className = 'pk-ad';
    var nav = '<nav class="pk-ad-nav pk-noprint">' + SUBS.map(function (s) {
      return '<button class="pk-ad-navbtn' + (s[0] === ui.sub ? ' active' : '') + '" data-sub="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</nav>';
    root.innerHTML = '<div class="pk-ad-layout">' + nav + '<section class="pk-ad-body"></section></div>';
    el.innerHTML = '';
    el.appendChild(root);
    root.querySelector('.pk-ad-nav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sub]'); if (!b) return;
      ui.sub = b.getAttribute('data-sub');
      render(el);
    });
    (PAGES[ui.sub] || pageClasses)(root.querySelector('.pk-ad-body'));
  }

  App.registerView('admin', { title: '基础数据', render: render });
  window.PaikeAdmin = { doMergeSubject: doMergeSubject, similarSubjects: similarSubjects };
})();
