/* io.js — 成员 C：「数据与导出」视图 + Excel(SpreadsheetML 2003)/CSV/JSON 导入导出 */
(function () {
  'use strict';

  var ui = { xlsClasses: true, xlsTeachers: true, xlsSummary: true, snapName: '' };

  // ---------- 纯函数：生成文件内容（可在 node 下测试） ----------
  function mapById(arr) { var m = {}; (arr || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function sortClasses(cls) {
    return (cls || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'zh'); });
  }
  function xesc(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/\r\n|\r|\n/g, '&#10;');
  }
  function xcell(idx, text, style, extra) {
    var has = !(text === '' || text == null);
    return '<Cell ss:Index="' + idx + '" ss:StyleID="' + style + '"' + (extra || '') + (has ? '><Data ss:Type="String">' + xesc(text) + '</Data></Cell>' : '/>');
  }
  function sheetName(name, used) {
    var n = String(name || 'Sheet').replace(/[\[\]:*?\/\\]/g, '').replace(/^'+|'+$/g, '').trim() || 'Sheet';
    n = n.slice(0, 31);
    var base = n, k = 2;
    while (used[n.toLowerCase()]) { var suf = '(' + (k++) + ')'; n = base.slice(0, 31 - suf.length) + suf; }
    used[n.toLowerCase()] = 1;
    return n;
  }
  var BORDERS = '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>' +
    '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>';
  var FONT = function (size, bold) { return '<Font ss:FontName="宋体" x:CharSet="134" ss:Size="' + size + '"' + (bold ? ' ss:Bold="1"' : '') + '/>'; };
  var STYLES = '<Styles>' +
    '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/>' + FONT(11) + '</Style>' +
    '<Style ss:ID="title"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>' + FONT(16, true) + '</Style>' +
    '<Style ss:ID="head"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>' + BORDERS + FONT(11, true) + '</Style>' +
    '<Style ss:ID="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>' + BORDERS + FONT(11) + '</Style>' +
    '<Style ss:ID="brk"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:VerticalText="1"/>' + BORDERS + FONT(11) + '</Style>' +
    '<Style ss:ID="brkrow"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>' + BORDERS + FONT(10) + '<Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>' +
    '</Styles>';
  var WSOPT = '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/>' +
    '<PageMargins x:Bottom="0.5" x:Left="0.4" x:Right="0.4" x:Top="0.5"/></PageSetup><FitToPage/>' +
    '<Print><FitHeight>1</FitHeight><FitWidth>1</FitWidth><ValidPrinterInfo/><PaperSizeIndex>9</PaperSizeIndex></Print></WorksheetOptions>';

  function worksheet(name, colsXml, rowsXml) {
    return '<Worksheet ss:Name="' + xesc(name) + '"><Table>' + colsXml + rowsXml + '</Table>' + WSOPT + '</Worksheet>';
  }

  /** 仿原表的网格：首行标题，表头「节次」+各节（插入分隔列），行=星期 */
  function gridSheet(name, title, st, cellText) {
    var P = st.settings.periods || [], D = st.settings.days || [], B = st.settings.breaks || [];
    var cols = [];
    P.forEach(function (pn, i) {
      cols.push({ t: 'p', p: i });
      B.forEach(function (b) { if (b.after === i + 1) cols.push({ t: 'b', label: b.label }); });
    });
    var ncol = 1 + cols.length;
    var colsXml = '<Column ss:Width="62"/>' + cols.map(function (c) { return '<Column ss:Width="' + (c.t === 'p' ? 86 : 26) + '"/>'; }).join('');
    var rows = '<Row ss:Height="34">' + xcell(1, title, 'title', ncol > 1 ? ' ss:MergeAcross="' + (ncol - 1) + '"' : '') + '</Row>';
    rows += '<Row ss:Height="28">' + xcell(1, '节次', 'head') + cols.map(function (c, j) {
      return c.t === 'p' ? xcell(j + 2, P[c.p], 'head') : xcell(j + 2, c.label, 'brk', D.length ? ' ss:MergeDown="' + D.length + '"' : '');
    }).join('') + '</Row>';
    D.forEach(function (dn, d) {
      rows += '<Row ss:Height="46">' + xcell(1, dn, 'head') + cols.map(function (c, j) {
        return c.t === 'p' ? xcell(j + 2, cellText(d, c.p), 'cell') : '';
      }).join('') + '</Row>';
    });
    return worksheet(name, colsXml, rows);
  }

  function buildXls(st, opts) {
    opts = opts || {};
    var wantC = opts.classes !== false, wantT = opts.teachers !== false, wantS = opts.summary !== false;
    var title = (st.meta && st.meta.title) || '';
    var cls = sortClasses(st.classes), sub = mapById(st.subjects), tch = mapById(st.teachers), cm = mapById(st.classes);
    var byCell = {}, byTeacher = {};
    (st.lessons || []).forEach(function (l) {
      byCell[l.classId + '|' + l.day + '|' + l.period] = l;
      if (l.teacherId) { var k = l.teacherId + '|' + l.day + '|' + l.period; (byTeacher[k] = byTeacher[k] || []).push(l); }
    });
    function sName(id) { return sub[id] ? sub[id].name : ''; }
    function classCell(cid, d, p) {
      var l = byCell[cid + '|' + d + '|' + p];
      if (!l) return '';
      var t = l.teacherId && tch[l.teacherId] ? tch[l.teacherId].name : '';
      return sName(l.subjectId) + (t ? '\n（' + t + '）' : '');
    }
    var used = {}, sheets = [];
    if (wantC) cls.forEach(function (c) {
      sheets.push(gridSheet(sheetName(c.name, used), title + c.name + '课表', st, function (d, p) { return classCell(c.id, d, p); }));
    });
    if (wantT) (st.teachers || []).forEach(function (t) {
      sheets.push(gridSheet(sheetName(t.name + '老师', used), title + t.name + '老师课表', st, function (d, p) {
        var ls = byTeacher[t.id + '|' + d + '|' + p] || [];
        return ls.map(function (l) { return (cm[l.classId] ? cm[l.classId].name : '') + '\n' + sName(l.subjectId); }).join('\n');
      }));
    });
    if (wantS) sheets.push(summarySheet(sheetName('总表', used), title + '总课表', st, cls, classCell));
    if (!sheets.length) return null;
    return '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
      '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>' + xesc(title + '课表') + '</Title></DocumentProperties>' +
      STYLES + sheets.join('\n') + '</Workbook>';
  }

  /** 总表：行=星期×节次（含分隔行），列=班级 */
  function summarySheet(name, title, st, cls, classCell) {
    var P = st.settings.periods || [], D = st.settings.days || [], B = st.settings.breaks || [];
    var ncol = 2 + cls.length;
    var colsXml = '<Column ss:Width="52"/><Column ss:Width="52"/>' + cls.map(function () { return '<Column ss:Width="78"/>'; }).join('');
    var rows = '<Row ss:Height="34">' + xcell(1, title, 'title', ' ss:MergeAcross="' + (ncol - 1) + '"') + '</Row>';
    rows += '<Row ss:Height="26">' + xcell(1, '星期', 'head') + xcell(2, '节次', 'head') + cls.map(function (c, j) { return xcell(j + 3, c.name, 'head'); }).join('') + '</Row>';
    D.forEach(function (dn, d) {
      var block = [];
      P.forEach(function (pn, p) {
        block.push({ t: 'p', p: p });
        B.forEach(function (b) { if (b.after === p + 1 && p < P.length - 1) block.push({ t: 'b', label: b.label }); });
      });
      block.forEach(function (r, i) {
        var first = i === 0 ? xcell(1, dn, 'head', block.length > 1 ? ' ss:MergeDown="' + (block.length - 1) + '"' : '') : '';
        if (r.t === 'p') {
          rows += '<Row ss:Height="34">' + first + xcell(2, P[r.p], 'head') + cls.map(function (c, j) { return xcell(j + 3, classCell(c.id, d, r.p), 'cell'); }).join('') + '</Row>';
        } else {
          rows += '<Row ss:Height="16">' + first + xcell(2, r.label, 'brkrow', cls.length ? ' ss:MergeAcross="' + cls.length + '"' : '') + '</Row>';
        }
      });
    });
    return worksheet(name, colsXml, rows);
  }

  function csvField(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(st) {
    var cr = {}; sortClasses(st.classes).forEach(function (c, i) { cr[c.id] = i; });
    var cm = mapById(st.classes), sm = mapById(st.subjects), tm = mapById(st.teachers);
    var days = st.settings.days || [], periods = st.settings.periods || [];
    var ls = (st.lessons || []).slice().sort(function (a, b) {
      return (cr[a.classId] || 0) - (cr[b.classId] || 0) || a.day - b.day || a.period - b.period;
    });
    var lines = [['班级', '星期', '节次', '科目', '老师'].join(',')];
    ls.forEach(function (l) {
      lines.push([cm[l.classId] ? cm[l.classId].name : '', days[l.day] || '', periods[l.period] || '',
        sm[l.subjectId] ? sm[l.subjectId].name : '', l.teacherId && tm[l.teacherId] ? tm[l.teacherId].name : ''].map(csvField).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 校验导入的备份结构，返回 {ok, errors, warnings, state} */
  function validateState(obj) {
    var errors = [], warnings = [];
    if (obj && obj.state && !obj.classes) obj = obj.state;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['文件内容不是排课备份'], warnings: [] };
    var s = obj.settings;
    if (!s || !Array.isArray(s.days) || !Array.isArray(s.periods)) errors.push('缺少「学期设置」（星期/节次）');
    ['classes', 'subjects', 'teachers', 'plans', 'lessons'].forEach(function (k) {
      if (!Array.isArray(obj[k])) errors.push('缺少数据：' + { classes: '班级', subjects: '科目', teachers: '老师', plans: '教学任务', lessons: '课表' }[k]);
    });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };
    ['classes', 'subjects', 'teachers'].forEach(function (k) {
      obj[k].forEach(function (x, i) { if (!x || !x.id || typeof x.name !== 'string') errors.push(k + ' 第 ' + (i + 1) + ' 项缺少 id 或名称'); });
    });
    var C = mapById(obj.classes), Sb = mapById(obj.subjects), T = mapById(obj.teachers), cells = {};
    var badRef = 0, badSlot = 0, dupCell = 0;
    obj.lessons.forEach(function (l) {
      if (!l || !l.id || !C[l.classId] || !Sb[l.subjectId] || (l.teacherId && !T[l.teacherId])) { badRef++; return; }
      if (!(l.day >= 0 && l.day < s.days.length && l.period >= 0 && l.period < s.periods.length && l.day % 1 === 0 && l.period % 1 === 0)) { badSlot++; return; }
      var k = l.classId + '|' + l.day + '|' + l.period;
      if (cells[k]) dupCell++; cells[k] = 1;
    });
    var badPlan = obj.plans.filter(function (p) { return !p || !C[p.classId] || !Sb[p.subjectId] || (p.teacherId && !T[p.teacherId]); }).length;
    if (errors.length > 5) errors = errors.slice(0, 5).concat(['……']);
    if (badRef) warnings.push(badRef + ' 节课引用了不存在的班级/科目/老师');
    if (badSlot) warnings.push(badSlot + ' 节课的星期/节次超出范围');
    if (dupCell) warnings.push(dupCell + ' 个格子有重复的课');
    if (badPlan) warnings.push(badPlan + ' 条教学任务引用了不存在的数据');
    var state = Object.assign({}, obj, {
      version: obj.version || 1,
      meta: Object.assign({ title: '', school: '' }, obj.meta || {}),
      settings: Object.assign({ breaks: [] }, s)
    });
    return { ok: !errors.length, errors: errors, warnings: warnings, state: state };
  }

  function stamp(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function safeFile(s) { return String(s || '').replace(/[\\\/:*?"<>|\s]+/g, '') || '排课'; }

  window.PaikeIO = { buildXls: buildXls, buildCsv: buildCsv, validateState: validateState, sheetName: sheetName };

  if (!window.App || !window.App.registerView) return; // node 测试环境

  // ---------- 浏览器端 ----------
  function esc(s) { return App.esc(s); }
  function download(content, filename, mime) {
    try {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
      App.toast('已导出：' + filename, 'ok');
      return true;
    } catch (e) {
      console.error(e);
      App.toast('导出失败：' + (e && e.message || e), 'err');
      return false;
    }
  }
  function confirmBox(title, html, okText, onOk, danger) {
    return App.modal({ title: title, body: '<div class="pk-ad-confirm">' + html + '</div>',
      buttons: [{ text: '取消' }, { text: okText || '确定', primary: !danger, danger: !!danger, onClick: onOk }] });
  }
  function fmtTime(v) {
    if (!v) return '';
    var d = new Date(v); if (isNaN(d)) return String(v);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function summary(st) {
    return (st.classes || []).length + ' 个班、' + (st.subjects || []).length + ' 个科目、' + (st.teachers || []).length + ' 位老师、' +
      (st.plans || []).length + ' 条教学任务、' + (st.lessons || []).length + ' 节课';
  }
  function getSnaps() { try { return Store.snapshots() || []; } catch (e) { return []; } }

  function exportJson() {
    var st = Store.get();
    download(JSON.stringify(st, null, 2), '排课备份_' + safeFile(st.meta && st.meta.title) + '_' + stamp() + '.json', 'application/json;charset=utf-8');
  }
  function importJson(file) {
    if (!file) return;
    var r = new FileReader();
    r.onerror = function () { App.toast('读取文件失败', 'err'); };
    r.onload = function () {
      var obj;
      try { obj = JSON.parse(String(r.result).replace(/^﻿/, '')); } catch (e) { return App.toast('文件不是有效的备份（JSON 格式错误）', 'err'); }
      var v = validateState(obj);
      if (!v.ok) {
        return App.modal({ title: '无法导入', body: '<p>「' + esc(file.name) + '」不是有效的排课备份：</p><ul>' + v.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' });
      }
      confirmBox('导入备份', '<p>文件：<b>' + esc(file.name) + '</b></p><p>内容：' + esc((v.state.meta.title || '') + ' ' + summary(v.state)) + '</p>' +
        (v.warnings.length ? '<p class="pk-ad-warn">⚠ ' + v.warnings.map(esc).join('；') + '</p>' : '') +
        '<p>导入将<b>替换当前全部数据</b>（可在「课表」页撤销）。建议先「导出备份」或「保存为方案」。</p>', '导入并替换', function () {
        try { Store.replaceAll(v.state); App.toast('已导入备份：' + summary(v.state), 'ok'); }
        catch (e) { App.toast('导入失败：' + e.message, 'err'); }
      }, true);
    };
    r.readAsText(file, 'utf-8');
  }

  function render(el) {
    var st = Store.get(), snaps = getSnaps();
    var h = '<div class="pk-ad pk-ad-data">';
    h += '<div class="pk-card pk-ad-sec"><h3>导出课表</h3><div class="pk-muted pk-ad-desc">Excel 文件（.xls）可直接用 Excel 或 WPS 打开、打印，版式与原课表一致。</div>' +
      '<div class="pk-row pk-ad-mt">' +
      '<label class="pk-ad-check"><input type="checkbox" data-opt="xlsClasses"' + (ui.xlsClasses ? ' checked' : '') + '> 每班一张（' + st.classes.length + ' 张）</label>' +
      '<label class="pk-ad-check"><input type="checkbox" data-opt="xlsTeachers"' + (ui.xlsTeachers ? ' checked' : '') + '> 每位老师一张（' + st.teachers.length + ' 张）</label>' +
      '<label class="pk-ad-check"><input type="checkbox" data-opt="xlsSummary"' + (ui.xlsSummary ? ' checked' : '') + '> 总表一张</label></div>' +
      '<div class="pk-row pk-ad-mt"><button class="pk-btn pk-btn-primary" data-act="xls">导出 Excel</button>' +
      '<button class="pk-btn" data-act="csv">导出 CSV（明细）</button></div></div>';

    h += '<div class="pk-card pk-ad-sec"><h3>方案快照</h3><div class="pk-muted pk-ad-desc">把当前课表存为一个「方案」，可以放心尝试调整，不满意再恢复。方案保存在本浏览器中。</div>' +
      '<div class="pk-row pk-ad-mt"><input class="pk-input pk-ad-wide" data-id="snapName" placeholder="方案名称，如：初稿、调整体育后" value="' + esc(ui.snapName) + '">' +
      '<button class="pk-btn pk-btn-primary" data-act="snapSave">保存当前为方案</button></div>';
    h += '<table class="pk-table pk-ad-table pk-ad-mt"><thead><tr><th>方案名称</th><th>保存时间</th><th class="pk-ad-w-ops1">操作</th></tr></thead><tbody>';
    if (!snaps.length) h += '<tr><td colspan="3" class="pk-muted pk-ad-empty">还没有保存方案。</td></tr>';
    snaps.forEach(function (s) {
      var t = s.time || s.savedAt || s.createdAt || s.at || s.date;
      h += '<tr><td><b>' + esc(s.name || '未命名') + '</b></td><td>' + esc(fmtTime(t)) + '</td><td class="pk-ad-nowrap">' +
        '<button class="pk-btn pk-ad-sm" data-act="snapRestore" data-id="' + esc(s.id) + '">恢复</button> ' +
        '<button class="pk-btn pk-ad-sm pk-btn-danger" data-act="snapDel" data-id="' + esc(s.id) + '">删除</button></td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<div class="pk-card pk-ad-sec"><h3>备份与恢复</h3><div class="pk-muted pk-ad-desc">数据只保存在本电脑的浏览器里。换电脑、清理浏览器前，请先导出备份文件妥善保存。</div>' +
      '<div class="pk-row pk-ad-mt"><button class="pk-btn pk-btn-primary" data-act="json">导出备份文件</button>' +
      '<button class="pk-btn" data-act="import">导入备份文件…</button><input type="file" accept=".json,application/json" data-id="file" style="display:none"></div>' +
      '<div class="pk-muted pk-ad-mt">当前数据：' + esc(summary(st)) + '</div></div>';

    h += '<div class="pk-card pk-ad-sec pk-ad-danger"><h3>恢复为原始课表</h3><div class="pk-muted pk-ad-desc">丢弃所有修改，回到最初从 Excel 导入的课表（9 个班）。已保存的方案不受影响。</div>' +
      '<div class="pk-row pk-ad-mt"><button class="pk-btn pk-btn-danger" data-act="reset">恢复为原始课表…</button></div></div>';
    h += '</div>';

    var root = document.createElement('div');
    root.innerHTML = h;
    el.innerHTML = '';
    el.appendChild(root);
    var nameInput = root.querySelector('[data-id="snapName"]');
    nameInput.addEventListener('input', function () { ui.snapName = nameInput.value; });
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') acts.snapSave(); });
    var fileInput = root.querySelector('[data-id="file"]');
    fileInput.addEventListener('change', function () { var f = fileInput.files && fileInput.files[0]; fileInput.value = ''; importJson(f); });
    root.addEventListener('change', function (e) {
      var o = e.target.getAttribute && e.target.getAttribute('data-opt');
      if (o) ui[o] = e.target.checked;
    });

    var acts = {
      xls: function () {
        if (!ui.xlsClasses && !ui.xlsTeachers && !ui.xlsSummary) return App.toast('请至少勾选一种工作表', 'warn');
        var xml;
        try { xml = buildXls(Store.get(), { classes: ui.xlsClasses, teachers: ui.xlsTeachers, summary: ui.xlsSummary }); }
        catch (e) { console.error(e); return App.toast('生成 Excel 失败：' + e.message, 'err'); }
        if (!xml) return App.toast('没有可导出的内容', 'warn');
        var s = Store.get();
        download(xml, safeFile(s.meta && s.meta.title) + '课表_' + stamp() + '.xls', 'application/vnd.ms-excel;charset=utf-8');
      },
      csv: function () {
        var s = Store.get();
        try { download(buildCsv(s), safeFile(s.meta && s.meta.title) + '课表明细_' + stamp() + '.csv', 'text/csv;charset=utf-8'); }
        catch (e) { App.toast('导出失败：' + e.message, 'err'); }
      },
      json: exportJson,
      import: function () { fileInput.click(); },
      snapSave: function () {
        var name = String(ui.snapName || '').trim();
        if (!name) { App.toast('请先输入方案名称', 'err'); nameInput.focus(); return; }
        if (getSnaps().some(function (s) { return s.name === name; })) { App.toast('已有同名方案「' + name + '」，请换个名称', 'err'); return; }
        try {
          var r = Store.saveSnapshot(name); ui.snapName = '';
          if (r && r.persisted === false) App.toast('方案「' + name + '」已保存，但未能写入浏览器存储（空间可能已满），关闭页面后会丢失。请删除旧方案或导出备份文件。', 'err');
          else App.toast('已保存方案「' + name + '」', 'ok');
        }
        catch (e) { App.toast('保存失败：' + (e.message || e) + '（浏览器存储空间可能已满，可删除旧方案）', 'err'); }
        App.refresh();
      },
      snapRestore: function (id) {
        var s = getSnaps().filter(function (x) { return x.id === id; })[0]; if (!s) return;
        confirmBox('恢复方案', '<p>确定恢复为方案「<b>' + esc(s.name) + '</b>」吗？</p><p>当前课表将被替换（可在「课表」页撤销）。如需保留当前课表，请先保存为方案。</p>', '恢复', function () {
          try { Store.restoreSnapshot(id); App.toast('已恢复方案「' + s.name + '」', 'ok'); }
          catch (e) { App.toast('恢复失败：' + e.message, 'err'); }
          App.refresh();
        });
      },
      snapDel: function (id) {
        var s = getSnaps().filter(function (x) { return x.id === id; })[0]; if (!s) return;
        confirmBox('删除方案', '<p>确定删除方案「<b>' + esc(s.name) + '</b>」吗？删除后无法恢复。</p>', '删除', function () {
          try { Store.deleteSnapshot(id); App.toast('已删除方案「' + s.name + '」', 'ok'); }
          catch (e) { App.toast('删除失败：' + e.message, 'err'); }
          App.refresh();
        }, true);
      },
      reset: function () {
        confirmBox('恢复为原始课表', '<p>将<b>丢弃全部修改</b>（班级、老师、教学任务、课表、学期设置），回到最初的原始课表。</p><p>建议先「保存当前为方案」或「导出备份文件」。</p>', '继续', function () {
          setTimeout(function () {
            confirmBox('再次确认', '<p class="pk-ad-warn">真的要恢复为原始课表吗？</p>', '确定恢复', function () {
              try { Store.resetToSeed(); App.toast('已恢复为原始课表', 'ok'); }
              catch (e) { App.toast('恢复失败：' + e.message, 'err'); }
            }, true);
          }, 0);
        }, true);
      }
    };
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      var f = acts[t.getAttribute('data-act')]; if (f) { e.preventDefault(); f(t.getAttribute('data-id')); }
    });
  }

  App.registerView('data', { title: '数据与导出', render: render });
})();
