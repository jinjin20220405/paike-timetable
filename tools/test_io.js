// 测试 io.js 的 Excel/CSV 生成与导入校验：node tools/test_io.js [输出目录]
var fs = require('fs'), path = require('path');
global.window = global;
var root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'src/store.js'), 'utf8'));
var seed = JSON.parse(fs.readFileSync(path.join(root, 'src/seed.json'), 'utf8'));
Store.init(seed);
eval(fs.readFileSync(path.join(root, 'src/io.js'), 'utf8'));
var st = Store.get(), out = process.argv[2] || require('os').tmpdir();
var fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
var xml = PaikeIO.buildXls(st, {});
fs.writeFileSync(path.join(out, 'test_out.xls'), xml);
var n = (xml.match(/<Worksheet /g) || []).length;
ok(n === st.classes.length + st.teachers.length + 1, '工作表数 ' + n + ' = ' + st.classes.length + '+' + st.teachers.length + '+1');
ok(xml.indexOf('2026年秋季学期一年级课表') > 0, '班级标题');
ok(xml.indexOf('2026年秋季学期' + st.teachers[0].name + '老师课表') > 0, '老师标题');
ok(/课间操/.test(xml) && /眼保健操/.test(xml), '分隔列');
ok(xml.indexOf('&#10;（') > 0, '格内换行 科目&#10;（老师）');
var names = (xml.match(/ss:Name="([^"]*)"/g) || []).map(function (s) { return s.slice(9, -1); }).filter(function (s) { return s !== 'Normal'; });
ok(names.every(function (s) { return s.length <= 31 && !/[\[\]:*?\/\\]/.test(s); }), '工作表名合法');
ok(new Set(names).size === names.length, '工作表名不重复');
var x2 = PaikeIO.buildXls(st, { teachers: false, summary: false });
ok((x2.match(/<Worksheet /g) || []).length === st.classes.length, '只导班级');
ok(PaikeIO.buildXls(st, { classes: false, teachers: false, summary: false }) === null, '全不勾返回 null');
ok(PaikeIO.sheetName('a[b]:c*d?e/f\\g' + 'x'.repeat(40), {}).length <= 31, 'sheetName 截断');
var csv = PaikeIO.buildCsv(st);
fs.writeFileSync(path.join(out, 'test_out.csv'), csv);
ok(csv.charCodeAt(0) === 0xfeff, 'CSV BOM');
ok(csv.split('\r\n').filter(Boolean).length === st.lessons.length + 1, 'CSV 行数 ' + st.lessons.length + '+1');
ok(PaikeIO.validateState(JSON.parse(JSON.stringify(st))).ok, '校验：合法备份');
ok(!PaikeIO.validateState({ foo: 1 }).ok, '校验：非法备份');
ok(PaikeIO.validateState({ state: JSON.parse(JSON.stringify(st)) }).ok, '校验：包装格式');
// 特殊字符与加星期六
Store.transaction(function () {
  Store.update('classes', st.classes[0].id, { name: '一年级<&>"' });
  Store.setSettings({ days: st.settings.days.concat(['星期六']) });
});
var x3 = PaikeIO.buildXls(Store.get(), {});
fs.writeFileSync(path.join(out, 'test_out2.xls'), x3);
ok(x3.indexOf('一年级&lt;&amp;&gt;&quot;') > 0, '特殊字符转义');
console.log(fails ? fails + ' 项失败' : '全部通过');
process.exit(fails ? 1 : 0);
