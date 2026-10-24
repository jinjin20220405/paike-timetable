# 合并 src/ 下各模块为单文件 排课系统.html
import os, json, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = lambda f: open(os.path.join(root, 'src', f), encoding='utf-8').read()
css = '\n'.join(src(f) for f in ['base.css', 'app.css', 'admin.css'])
init = "\nStore.init(window.SEED);\n"
js = '\n;\n'.join([src('store.js'), src('scheduler.js'), init, src('main.js'),
                   src('views-timetable.js'), src('views-admin.js'), src('io.js')])
seed = json.dumps(json.load(open(os.path.join(root, 'src', sys.argv[1] if len(sys.argv) > 1 else 'seed.json'), encoding='utf-8')), ensure_ascii=False)
# 第三个参数为浏览器存储键前缀，使不同版本的数据互不读取
if len(sys.argv) > 3:
    for q in ("'", '"'):
        js = js.replace(q + 'paike.', q + sys.argv[3] + '.')
html = src('shell.html').replace('/*@CSS*/', css).replace('/*@SEED*/', seed).replace('/*@JS*/', js.replace('</script', '<\\/script'))
out = os.path.join(root, sys.argv[2] if len(sys.argv) > 2 else '排课系统.html')
open(out, 'w', encoding='utf-8').write(html)
print('built', out, len(html))
