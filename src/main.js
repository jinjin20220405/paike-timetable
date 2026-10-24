(function () {
  var views = [], current = null;
  var App = window.App = {};

  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  App.dayName = function (i) { return Store.get().settings.days[i] || ''; };
  App.periodName = function (i) { return Store.get().settings.periods[i] || ''; };

  App.toast = function (msg, type) {
    var box = document.getElementById('pk-toast');
    var t = document.createElement('div');
    t.className = 'pk-toast' + (type ? ' pk-toast-' + type : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, type === 'err' ? 5000 : 2600);
  };

  App.modal = function (opt) {
    var mask = document.createElement('div');
    mask.className = 'pk-modal-mask';
    mask.innerHTML = '<div class="pk-modal"><div class="pk-modal-h"></div><div class="pk-modal-b"></div><div class="pk-modal-f"></div></div>';
    mask.querySelector('.pk-modal-h').textContent = opt.title || '';
    var body = mask.querySelector('.pk-modal-b');
    if (typeof opt.body === 'string') body.innerHTML = opt.body; else if (opt.body) body.appendChild(opt.body);
    var api = { close: function () { mask.remove(); document.removeEventListener('keydown', onKey); } };
    var foot = mask.querySelector('.pk-modal-f');
    (opt.buttons || [{ text: '关闭' }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'pk-btn' + (b.primary ? ' pk-btn-primary' : '') + (b.danger ? ' pk-btn-danger' : '');
      btn.textContent = b.text;
      btn.onclick = function () { if (!b.onClick || b.onClick(api) !== false) api.close(); };
      foot.appendChild(btn);
    });
    function onKey(e) { if (e.key === 'Escape') api.close(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) api.close(); });
    document.body.appendChild(mask);
    return api;
  };

  App.confirm = function (title, msg, onOk) {
    App.modal({ title: title, body: '<p>' + App.esc(msg) + '</p>', buttons: [
      { text: '取消' }, { text: '确定', primary: true, onClick: onOk }] });
  };

  App.registerView = function (key, def) { views.push(Object.assign({ key: key }, def)); };

  App.show = function (key) {
    current = key;
    try { localStorage.setItem('paike.tab', key); } catch (e) {}
    renderTabs(); renderView();
  };
  App.current = function () { return current; };

  function renderTabs() {
    var nav = document.getElementById('pk-tabs');
    nav.innerHTML = '';
    views.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'pk-tab' + (v.key === current ? ' active' : '');
      b.textContent = v.title;
      b.onclick = function () { App.show(v.key); };
      nav.appendChild(b);
    });
  }

  function renderView() {
    var v = views.filter(function (x) { return x.key === current; })[0];
    var el = document.getElementById('pk-main');
    document.getElementById('pk-title').textContent = Store.get().meta.title || '';
    if (!v) return;
    try { v.render(el); } catch (e) {
      console.error(e);
      el.innerHTML = '<div class="pk-card">页面出错：' + App.esc(e.message) + '</div>';
    }
  }
  App.refresh = renderView;

  document.addEventListener('DOMContentLoaded', function () {
    var saved = null;
    try { saved = localStorage.getItem('paike.tab'); } catch (e) {}
    current = views.some(function (v) { return v.key === saved; }) ? saved : (views[0] && views[0].key);
    Store.subscribe(function () { renderView(); });
    renderTabs(); renderView();
  });
})();
