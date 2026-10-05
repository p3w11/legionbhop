/* ============================================================
   LEGION — раздел файлов: хранилище (IndexedDB / localStorage)
   и реальное скачивание загруженного файла
   ============================================================ */
(function () {
  'use strict';

  var L = window.L;
  var DB_NAME = 'legion_files', DB_STORE = 'blobs';
  var LS_KEY = 'legion.files.v1';
  var LS_MAX = 3 * 1024 * 1024;

  var db = null, mode = 'idb', mem = [];

  /* ---------------- открытие хранилища ---------------- */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req, timer;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      timer = setTimeout(function () { reject(new Error('timeout')); }, 2500);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { clearTimeout(timer); resolve(req.result); };
      req.onerror = function () { clearTimeout(timer); reject(req.error); };
    });
  }

  function lsOK() {
    try { localStorage.setItem('legion.probe', '1'); localStorage.removeItem('legion.probe'); return true; }
    catch (e) { return false; }
  }

  function init() {
    return openIDB()
      .then(function (d) { db = d; mode = 'idb'; })
      .catch(function () { mode = lsOK() ? 'ls' : 'memory'; })
      .then(load)
      .then(function () {
        var n = L.q('[data-storage-note]');
        if (n) n.textContent = 'Хранилище: ' + modeLabel();
      });
  }

  function modeLabel() {
    if (mode === 'idb') return 'IndexedDB — файлы переживают перезагрузку';
    if (mode === 'ls') return 'localStorage — лимит ' + L.size(LS_MAX) + ' на всё';
    return 'память — файлы пропадут после перезагрузки';
  }

  /* ---------------- чтение/запись ---------------- */
  function idbAll() {
    return new Promise(function (res, rej) {
      var rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbPut(rec) {
    return new Promise(function (res, rej) {
      var rq = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).add(rec);
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbDel(id) {
    return new Promise(function (res, rej) {
      var rq = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(id);
      rq.onsuccess = function () { res(); };
      rq.onerror = function () { rej(rq.error); };
    });
  }

  function toDataURL(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function fromDataURL(url) {
    var m = /^data:([^;]+);base64,(.*)$/.exec(url);
    if (!m) return new Blob([url], { type: 'text/plain' });
    var bin = atob(m[2]), len = bin.length, arr = new Uint8Array(len), i;
    for (i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function lsWrite() {
    localStorage.setItem(LS_KEY, JSON.stringify(mem.map(function (r) {
      return { id: r.id, name: r.name, size: r.size, author: r.author, added: r.added, downloads: r.downloads, data: r.data };
    })));
  }
  function lsUsed() {
    return mem.reduce(function (a, r) { return a + Math.ceil(r.data.length * 0.75); }, 0);
  }

  function load() {
    if (mode === 'idb') {
      return idbAll().then(function (list) {
        mem = list.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
      });
    }
    if (mode === 'ls') {
      mem = lsRead().map(function (r) {
        return {
          id: r.id, name: r.name, size: r.size, author: r.author,
          added: r.added, downloads: r.downloads || 0, data: r.data,
          blob: fromDataURL(r.data)
        };
      });
    }
    return Promise.resolve(mem);
  }

  /* ---------------- публичный список ---------------- */
  function seeds() { return L.forum.files.map(function (f) { return L.seededFile(f); }); }
  function list() {
    return seeds().concat(mem).sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
  }
  function find(id) {
    return list().filter(function (f) { return String(f.id) === String(id); })[0];
  }

  /* ---------------- действия ---------------- */
  function add(fileList) {
    var arr = Array.prototype.slice.call(fileList);
    if (!arr.length) return;

    if (mode === 'ls') {
      var tooBig = arr.filter(function (f) { return f.size > LS_MAX; });
      if (tooBig.length) {
        L.toast(tooBig.length + ' файл(ов) больше ' + L.size(LS_MAX) + ' — пропущены. Запусти сайт через serve.ps1', 'err');
      }
      arr = arr.filter(function (f) { return f.size <= LS_MAX; });
      if (lsUsed() > LS_MAX * 0.75) return L.toast('Хранилище почти заполнено — удали лишние файлы', 'err');
    }

    var jobs = arr.map(function (f) {
      var rec = {
        name: f.name, size: f.size, author: L.forum.you,
        added: Date.now(), downloads: 0, demo: false
      };
      if (mode === 'idb') { rec.blob = f; return idbPut(rec); }
      return toDataURL(f).then(function (url) {
        rec.data = url;
        rec.id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
        mem.push(rec);
      });
    });

    return Promise.all(jobs)
      .then(function () { if (mode === 'ls') lsWrite(); return load(); })
      .then(function () {
        render();
        L.toast('Загружено файлов: ' + arr.length, 'ok');
      })
      .catch(function (e) { L.toast('Ошибка загрузки: ' + (e && e.message ? e.message : e), 'err'); });
  }

  function remove(id) {
    var f = find(id);
    if (!f || f.demo) return L.toast('Сид-файлы удалить нельзя', 'err');
    if (!confirm('Удалить "' + f.name + '"?')) return;
    var p = mode === 'idb' ? idbDel(id) : Promise.resolve();
    return p.then(function () {
      mem = mem.filter(function (r) { return String(r.id) !== String(id); });
      if (mode === 'ls') lsWrite();
      render();
      L.toast('Файл удалён');
    }).catch(function (e) { L.toast('Не удалось удалить: ' + e.message, 'err'); });
  }

  function save(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function download(f) {
    if (f.demo) {
      var txt = [
        'LEGION forum — демо-заглушка',
        '===========================',
        '',
        'Файл:   ' + f.name,
        'Размер: ' + L.size(f.size),
        'Автор: ' + f.author,
        '',
        'Это демо-запись форума: реального архива в проекте нет, поэтому вместо него',
        'создаётся этот текстовый файл. Загрузи свой файл через форму выше — и кнопка',
        '«Скачать» отдаст его байт в байт.'
      ].join('\n');
      save(new Blob([txt], { type: 'text/plain' }), f.name + '.demo.txt');
      bump(f.id);
      L.toast('Демо-запись — вместо архива скачана заглушка', 'err');
      return;
    }
    if (!f.blob) return L.toast('Файл потерялся, загрузи заново', 'err');
    save(f.blob, f.name);
    bump(f.id);
    L.toast('Скачивание: ' + f.name, 'ok');
  }

  function bump(id) {
    var m = mem.filter(function (r) { return String(r.id) === String(id); })[0];
    if (m) {
      m.downloads = (m.downloads || 0) + 1;
      if (mode === 'ls') lsWrite();
    } else {
      L.state.dl[id] = (L.state.dl[id] || 0) + 1;
      try { localStorage.setItem('legion.forum.v1', JSON.stringify(L.state)); } catch (e) {}
    }
    render();
  }

  /* ---------------- рендер списка ---------------- */
  function render() {
    var host = L.q('#fileList');
    if (!host) return;
    var items = list();

    L.q('#fileCount').textContent = items.length;
    L.q('#fileTotal').textContent = L.size(items.reduce(function (a, f) { return a + f.size; }, 0));

    host.innerHTML = '<div class="filerow head">' +
        '<div>Файл</div><div class="center">Размер</div><div class="fnum hide-s">Скачиваний</div><div class="fdl">Действия</div>' +
      '</div>' +
      (items.length ? items.map(function (f) {
        return '<div class="filerow">' +
          '<div>' +
            '<div class="fname">' + L.esc(f.name) +
              (f.demo ? ' <span class="badge badge-demo">демо</span>' : ' <span class="badge badge-new">мой</span>') +
            '</div>' +
            '<div class="fmeta">загрузил: ' + L.esc(f.author) + ' · ' + L.esc(L.ago(f.added)) + ' · ' +
              L.esc(L.ftime(f.added)) + '</div>' +
          '</div>' +
          '<div class="fnum"><b>' + L.size(f.size) + '</b></div>' +
          '<div class="fnum hide-s"><b>' + f.downloads + '</b>раз</div>' +
          '<div class="fdl">' +
            '<button class="btn btn-sm btn-primary" data-dl="' + L.esc(f.id) + '">↓ Скачать</button>' +
            (f.demo ? '' : '<button class="btn btn-sm btn-danger" data-rm="' + L.esc(f.id) + '">Удалить</button>') +
          '</div>' +
        '</div>';
      }).join('') : '<div class="empty"><div class="big">&#128193;</div><p>Файлов пока нет — загрузи первый выше.</p></div>');

    L.qa('[data-dl]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = find(b.getAttribute('data-dl'));
        if (f) download(f);
      });
    });
    L.qa('[data-rm]', host).forEach(function (b) {
      b.addEventListener('click', function () { remove(b.getAttribute('data-rm')); });
    });
  }

  /* ---------------- drag & drop + выбор файла ---------------- */
  function initDrop() {
    var zone = L.q('#dropzone'), input = L.q('#fileInput');
    if (!zone) return;

    input.addEventListener('change', function () { add(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      zone.addEventListener(ev, function () { zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('is-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) add(e.dataTransfer.files);
    });
    ['dragover', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) { if (!zone.contains(e.target)) e.preventDefault(); });
    });
  }

  window.LegionFiles = {
    init: function () { initDrop(); return init().then(render); },
    list: list, find: find, add: add, remove: remove, download: download,
    mode: function () { return mode; }, modeLabel: modeLabel
  };
})();