# 排课系统 — 模块接口约定（所有开发成员必须遵守）

## 总体
- 产品：离线单文件网页应用 `排课系统.html`，双击用浏览器打开（Chrome/Edge/Safari），无服务器、无联网依赖、不引用任何 CDN。
- 构建：`python3 tools/build.py` 把 `src/shell.html` 中的占位符替换为各模块内容，输出 `排课系统.html`。
  - `/*@CSS*/` ← `src/app.css` + `src/admin.css`
  - `/*@JS*/`  ← 依次：`src/store.js`、`src/scheduler.js`、`src/views-timetable.js`、`src/views-admin.js`、`src/io.js`、`src/main.js`
  - `/*@SEED*/` ← `src/seed.json`（赋值给 `window.SEED`）
- 纯原生 ES2017 JS，无框架、无 import/export、无 TypeScript。各文件用 IIFE 包裹，只通过 `window.Store`、`window.Scheduler`、`window.App` 通信。
- 界面全部中文。默认数据来自原 Excel：9 个班、18 科目、23 位老师、262 节课。

## 数据模型（state）
```js
{
  version: 1,
  meta: { title: '2026年秋季学期', school: '' },
  settings: {
    days: ['星期一',...,'星期五'],           // 可增减，day 为下标
    periods: ['第一节',...,'第六节'],          // 可增减，period 为下标
    breaks: [{after:2,label:'课间操'},{after:5,label:'眼保健操'}] // 在第 after 节之后显示一行分隔
  },
  classes:  [{id, name, grade, order, headTeacherId}],   // headTeacherId 可为 null
  subjects: [{id, name, color}],                          // color 为 #rrggbb
  teachers: [{id, name, note}],
  plans:    [{id, classId, subjectId, teacherId, hours}], // 教学任务：某班某科由谁教、每周几节
  lessons:  [{id, classId, day, period, subjectId, teacherId, locked}] // 已排课；teacherId 可为 null
}
```
约束：同一 classId+day+period 最多一条 lesson。id 用 `Store.uid(prefix)` 生成。

## window.Store（store.js）
- `Store.init(seed)`：从 localStorage 键 `paike.state.v1` 读取，没有则深拷贝 seed。
- `Store.get()` → 当前 state（只读，不得直接修改）。
- `Store.subscribe(fn)` → 返回取消函数；每次变更后调用 `fn(state)`。
- `Store.uid(prefix)` → 唯一 id。
- 通用增删改：`Store.add(type, obj)` 返回新对象；`Store.update(type, id, patch)`；`Store.remove(type, id)`。
  type ∈ `'classes'|'subjects'|'teachers'|'plans'|'lessons'`。
  删除级联：删班级 → 删其 plans、lessons；删科目 → 删相关 plans、lessons；删老师 → 相关 plans/lessons 的 teacherId 置 null，班主任置 null。
- `Store.setSettings(patch)`、`Store.setMeta(patch)`。减少 days/periods 时删除超出范围的 lessons。
- 课表操作：
  - `Store.lessonAt(classId, day, period)` → lesson 或 null
  - `Store.setLesson(classId, day, period, {subjectId, teacherId})` 有则覆盖无则新建；返回 lesson
  - `Store.clearLesson(classId, day, period)`
  - `Store.moveLesson(from, to)`：from/to 为 `{classId,day,period}`；目标有课则互换。
  - `Store.toggleLock(lessonId)`
- 查询：
  - `Store.teacherLessons(teacherId)`、`Store.classLessons(classId)`
  - `Store.conflicts()` → `[{type:'teacher', teacherId, day, period, lessonIds:[...]}]` 同一老师同一时段多节
  - `Store.checkPlacement(classId, day, period, teacherId)` → 若放入会冲突的 lesson 数组（排除该格自身）
  - `Store.planStatus()` → `[{plan, placed}]`，placed = 该班该科该老师已排节数
  - `Store.teacherLoad()` → `[{teacher, total, bySubject:{subjectId:n}, byClass:{classId:n}}]`
  - `Store.lookup(type, id)` → 对象或 undefined
- 历史：`Store.undo()`、`Store.redo()`、`Store.canUndo()`、`Store.canRedo()`（至少 50 步）。
- 批量：`Store.transaction(fn)` 内多次修改只产生一步撤销、一次通知。
- 持久化：每次变更自动写 localStorage。`Store.replaceAll(newState)`（导入用，可撤销）、`Store.resetToSeed()`。
- 快照：`Store.snapshots()`、`Store.saveSnapshot(name)`、`Store.restoreSnapshot(id)`、`Store.deleteSnapshot(id)`，存 localStorage 键 `paike.snapshots.v1`，用于保存多个方案。

## window.Scheduler（scheduler.js）
- `Scheduler.run({classIds, keepExisting=true, respectLocked=true, maxPerDayPerSubject=2, avoidConsecutiveSame=true})`
  按 plans 把「未排满的节数」放进空格，硬约束：老师不冲突、班级格子为空、locked 不动；
  软约束：同科每天不超过 maxPerDayPerSubject，语文/数学优先上午（前 3 节），尽量不连堂；
  `keepExisting=false` 时先清空所选班级未锁定的课。
  返回 `{placed: n, unplaced: [{plan, missing}], changes: [...]}`；通过 `Store.transaction` 一次写入（可一键撤销）。
- `Scheduler.suggest(classId, day, period)` → 该格可放的 `[{plan, ok:boolean, reason}]`，按 未排满优先 排序。

## window.App（main.js，由总控编写）
- `App.registerView(key, {title, render(el)})`：注册顶部标签页，render 在切换或数据变更时被调用。
- `App.toast(msg, type)`：type ∈ 'ok'|'warn'|'err'。
- `App.modal({title, body(HTMLElement|string), buttons:[{text, primary, onClick}]})` → 返回 `{close()}`。
- `App.esc(str)` HTML 转义。`App.dayName(i)`、`App.periodName(i)`。

## 视图分工
- views-timetable.js（成员 B）：
  - `timetable` 标签「课表」：顶部切换「按班级 / 按老师 / 总表」。
    - 班级课表：行=节次（含课间操/眼保健操分隔行）、列=星期；格子显示科目色块+老师名；点击格子弹出编辑（选教学任务快捷键/手选科目+老师/清空/锁定），选择时实时提示冲突；拖拽格子移动或互换（目标有冲突时标红提示但允许并 toast 警告）；锁定格显示 🔒。
    - 侧栏：该班教学任务完成度（已排/应排，未满的可拖入格子）。
    - 老师课表：选老师，显示其所有班的课，格内写「班级 科目」。
    - 总表：所有班级一屏，行=星期×节次，列=班级，紧凑显示，冲突格标红。
    - 顶部工具：撤销/重做、自动排课（选当前班或全部）、打印当前视图。
  - `check` 标签「检查」：冲突列表（点击跳到对应格）、教学任务未排满/超排列表、老师课时统计表。
  - CSS 写在 `src/app.css`（全局布局、标签栏、按钮、表格、模态框、toast 样式也由 B 负责，类名前缀 `pk-`）。
- views-admin.js + io.js（成员 C）：
  - `admin` 标签「基础数据」：子页 班级 / 科目 / 老师 / 教学任务 / 学期设置。均支持新增、编辑、删除（删除前确认并说明级联影响）、排序。教学任务页可按班级筛选，显示已排/应排；支持「按当前课表生成教学任务」。学期设置：标题、星期数、节次名称、分隔行。
  - `data` 标签「数据与导出」：导出备份 JSON、导入 JSON、保存/恢复/删除方案快照、恢复为原始课表；
    导出 Excel：生成 Excel 可打开的 `.xls`（HTML 表格 + `application/vnd.ms-excel`），包含每班一张、每位老师一张工作表（用 SpreadsheetML 2003 XML 格式实现多工作表），版式仿原表（标题行「2026年秋季学期X班课表」、节次表头含课间操/眼保健操列、格内「科目\n（老师）」）；导出 CSV（UTF-8 BOM）。
  - CSS 写在 `src/admin.css`，复用 B 的 `pk-` 基础类，自身类名前缀 `pk-ad-`。

## 总控已完成的文件（不要改动，有需要请在报告里提出）
- `src/shell.html`、`src/main.js`（App 实现，另有 `App.confirm(title,msg,onOk)`、`App.show(key)`、`App.refresh()`、`App.current()`）、`src/base.css`、`src/seed.json`、`tools/build.py`。
- base.css 已提供通用类：`pk-card pk-row pk-btn pk-btn-primary pk-btn-danger pk-input pk-select pk-table pk-muted pk-badge pk-badge-ok/warn/err`、模态框、toast、打印时隐藏 `.pk-noprint`。B 的 `app.css` 只写课表/检查页专用样式。
- 视图注册顺序决定标签顺序：课表(timetable) → 检查(check) → 基础数据(admin) → 数据与导出(data)。
- render(el) 每次数据变更都会被重新调用：视图需自行保存子页/选中班级等 UI 状态（模块内变量），重绘后保持不变。
- 验证：`python3 tools/build.py` 后可用 node 做逻辑测试；store.js 必须能在 node 下运行（localStorage 不存在时降级为内存）。
