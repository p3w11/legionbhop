/* ============================================================
   LEGION — общая логика форума
   ============================================================ */
(function () {
  'use strict';

  var F = window.L_FORUM;
  var KEY = 'legion.forum.v1';

  /* ---------------- helpers ---------------- */
  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function size(b) {
    if (b == null) return '—';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 2 : 1)) + ' ' + u[i];
  }
  function num(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(n);
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function ftime(ts) {
    var d = new Date(ts), now = new Date();
    var t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return 'сегодня, ' + t;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return 'вчера, ' + t;
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + t;
  }
  function ago(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'только что';
    var m = Math.floor(s / 60);   if (m < 60) return m + ' мин назад';
    var h = Math.floor(m / 60);   if (h < 24) return h + ' ч назад';
    var d = Math.floor(h / 24);   if (d < 30) return d + ' дн назад';
    return ftime(ts);
  }

  /* ---------------- состояние ---------------- */
  var state = load();

  function load() {
    var s = { threads: [], deleted: [], delPosts: [], thanks: {}, dl: {} };
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        s.threads = raw.threads || [];
        s.deleted = raw.deleted || [];
        s.delPosts = raw.delPosts || [];
        s.thanks = raw.thanks || {};
        s.dl = raw.dl || {};
      }
    } catch (e) { /* повреждённое хранилище — начинаем с нуля */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Не удалось сохранить: хранилище переполнено', 'err'); }
  }

  /* ---------------- нормализация сидов ---------------- */
  var SEED_THREADS = F.threads.map(function (t) {
    return {
      id: t.id, board: t.board, title: t.title, author: t.author,
      views: t.views || 0, pinned: !!t.pinned, locked: !!t.locked, hot: !!t.hot,
      created: Date.now() - (t.minsAgo || 0) * 60000,
      lastSeen: Date.now() - (t.minsAgo || 0) * 60000,
      posts: (t.posts || []).map(function (p, i) {
        return {
          id: t.id + '-p' + i, author: p.author, thanks: p.thanks || 0,
          created: Date.now() - (p.minsAgo || 0) * 60000,
          body: p.body
        };
      })
    };
  });

  /* ---------------- сид-файлы ---------------- */
  function seededFile(f) {
    return {
      id: f.id, name: f.name, size: f.size, author: f.author, demo: true,
      added: Date.now() - (f.minsAgo || 0) * 60000,
      downloads: (f.downloads || 0) + (state.dl[f.id] || 0)
    };
  }

  /* ---------------- разделы ---------------- */
  function boards() { return F.boards; }
  function board(id) { return F.boards.filter(function (b) { return b.id === id; })[0]; }
  function boardTitle(id) { var b = board(id); return b ? b.name : '—'; }
  function boardPath(id) {
    var b = board(id), out = [];
    while (b) { out.unshift(b); b = b.parent ? board(b.parent) : null; }
    return out;
  }

  /* ---------------- темы ---------------- */
  function allThreads() {
    return SEED_THREADS
      .filter(function (t) { return state.deleted.indexOf(t.id) === -1; })
      .concat(state.threads)
      .map(function (t) {
        var copy = {};
        for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) copy[k] = t[k];
        copy.posts = t.posts.filter(function (p, i) {
          return state.delPosts.indexOf(t.id + ':' + i) === -1;
        });
        copy.posts = copy.posts.map(function (p) {
          return {
            id: p.id, author: p.author, body: p.body, created: p.created,
            thanks: p.thanks + (state.thanks[p.id] ? 1 : 0)
          };
        });
        var last = copy.posts.length ? copy.posts[copy.posts.length - 1].created : copy.created;
        copy.lastSeen = Math.max(copy.lastSeen || 0, last);
        return copy;
      })
      .sort(function (a, b) {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return b.lastSeen - a.lastSeen;
      });
  }

  function descendants(id) {
    var out = {};
    (function walk(pid) {
      F.boards.forEach(function (b) {
        if (b.parent === pid) { out[b.id] = 1; walk(b.id); }
      });
    })(id);
    return out;
  }

  /* темы самого раздела + его родителя */
  function threadsIn(boardId) {
    var own = board(boardId), ids = {};
    if (own) { ids[boardId] = 1; if (own.parent) ids[own.parent] = 1; }
    return allThreads().filter(function (t) { return ids[t.board]; });
  }

  /* темы раздела вместе со всеми подразделами — для счётчиков */
  function threadsDeep(boardId) {
    if (!board(boardId)) return [];
    var ids = descendants(boardId);
    ids[boardId] = 1;
    return allThreads().filter(function (t) { return ids[t.board]; });
  }
  function thread(id) { return allThreads().filter(function (t) { return t.id === id; })[0]; }
  function latest(n) { return allThreads().slice(0, n || 6); }

  function uid(prefix) {
    return (prefix || 'u') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function createThread(boardId, title, bodyHtml) {
    var now = Date.now();
    var t = {
      id: uid('t-'), board: boardId, title: title, author: F.you,
      views: 1, pinned: false, locked: false, hot: false,
      created: now, lastSeen: now,
      posts: [{ id: uid('p-'), author: F.you, created: now, body: bodyHtml, thanks: 0 }]
    };
    state.threads.push(t);
    save();
    return t;
  }

  function reply(threadId, bodyHtml) {
    var t = thread(threadId);
    if (!t) return null;
    var p = { id: uid('p-'), author: F.you, created: Date.now(), body: bodyHtml, thanks: 0 };
    t.posts.push(p);
    t.lastSeen = p.created;
    if (state.threads.indexOf(t) !== -1) {
      state.threads[state.threads.indexOf(t)] = t;
      save();
    } else {
      // тема из сидов: переносим её в пользовательские, чтобы новый ответ сохранился
      var idx = SEED_THREADS.indexOf(SEED_THREADS.filter(function (s) { return s.id === t.id; })[0]);
      var clone = JSON.parse(JSON.stringify(t));
      state.threads.push(clone);
      if (idx !== -1) state.deleted.push(t.id);
      save();
    }
    return p;
  }

  function indexById(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }

  function delThread(id) {
    if (!confirm('Удалить тему целиком? Это нельзя отменить.')) return false;
    var i = indexById(state.threads, id);
    if (i !== -1) state.threads.splice(i, 1);
    if (state.deleted.indexOf(id) === -1) state.deleted.push(id);
    save();
    return true;
  }

  function delPost(threadId, postId) {
    if (!confirm('Удалить своё сообщение?')) return false;
    var mine = state.threads.filter(function (t) { return t.id === threadId; })[0];
    if (mine) {
      var i = indexById(mine.posts, postId);
      if (i === -1) return false;
      mine.posts.splice(i, 1);
      save();
      return true;
    }
    var seed = SEED_THREADS.filter(function (s) { return s.id === threadId; })[0];
    if (!seed) return false;
    var idx = indexById(seed.posts, postId);
    if (idx === -1) return false;
    state.delPosts.push(threadId + ':' + idx);
    save();
    return true;
  }

  function hasThanks(pid) { return !!state.thanks[pid]; }
  function toggleThanks(pid) {
    if (state.thanks[pid]) delete state.thanks[pid]; else state.thanks[pid] = 1;
    save();
  }

  /* ---------------- поиск ---------------- */
  function search(query) {
    var s = String(query || '').trim().toLowerCase();
    if (!s) return [];
    return allThreads().filter(function (t) {
      return t.title.toLowerCase().indexOf(s) !== -1 ||
             t.posts.some(function (p) { return p.body.toLowerCase().indexOf(s) !== -1; });
    });
  }

  /* ---------------- пагинация ---------------- */
  function paginate(list, perPage, page) {
    var pages = Math.max(1, Math.ceil(list.length / perPage));
    var cur = Math.min(Math.max(1, page || 1), pages);
    return {
      pages: pages, cur: cur, total: list.length,
      slice: list.slice((cur - 1) * perPage, cur * perPage)
    };
  }
  function renderPager(el, p, hrefBase) {
    if (!el) return;
    var html = '';
    if (p.pages > 1) {
      html += p.cur > 1 ? '<a href="' + hrefBase + '&page=' + (p.cur - 1) + '">‹</a>' : '<span>‹</span>';
      for (var i = 1; i <= p.pages; i++) {
        html += i === p.cur
          ? '<span class="is-on">' + i + '</span>'
          : '<a href="' + hrefBase + '&page=' + i + '">' + i + '</a>';
      }
      html += p.cur < p.pages ? '<a href="' + hrefBase + '&page=' + (p.cur + 1) + '">›</a>' : '<span>›</span>';
    }
    html += '<span class="dim">' + p.total + ' тем</span>';
    el.innerHTML = html;
  }

  /* ---------------- chrome (сайдбары) ---------------- */
  function renderChrome() {
    qa('[data-online]').forEach(function (el) {
      el.innerHTML = '<b>' + F.online.filter(function (u) { return u.on; }).length + '</b> пользователей онлайн';
    });

    var stats = q('[data-stats]');
    if (stats) {
      stats.innerHTML = F.stats.map(function (row) {
        return '<li><span>' + esc(row[0]) + '</span><b>' + esc(row[1]) + '</b></li>';
      }).join('');
    }

    var on = q('[data-online-list]');
    if (on) {
      on.innerHTML = F.online.map(function (u) {
        return '<li><span class="dot-ico' + (u.on ? '' : ' off') + '"></span>' +
               '<a href="#">' + esc(u.name) + '</a>' +
               '<span class="muted" style="margin-left:auto;font-size:11.5px">' + esc(u.role) + '</span></li>';
      }).join('');
    }

    var lt = q('[data-latest]');
    if (lt) {
      lt.innerHTML = latest(6).map(function (t) {
        return '<a class="mini-thread" href="thread.html?id=' + esc(t.id) + '">' + esc(t.title) +
               '<span class="m">' + esc(boardTitle(t.board)) + ' · ' + esc(t.author) + ' · ' + esc(ago(t.lastSeen)) + '</span></a>';
      }).join('');
    }

    var yr = q('[data-year]');
    if (yr) yr.textContent = new Date().getFullYear();

    var st = q('[data-storage-note]');
    if (st && window.LegionFiles && window.LegionFiles.mode) {
      st.textContent = 'Файлы: ' + window.LegionFiles.modeLabel();
    }
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = q('#toast');
    if (!el) { return; }
    el.textContent = msg;
    el.classList.toggle('is-err', kind === 'err');
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }

  /* ---------------- поиск в шапке ---------------- */
  function initSearch() {
    var form = q('#headSearch');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = q('#headSearchInput').value.trim();
      location.href = v ? 'index.html?q=' + encodeURIComponent(v) : 'index.html';
    });
  }

  /* ---------------- экспорт ---------------- */
  window.L = {
    forum: F, q: q, qa: qa, esc: esc, size: size, num: num, ftime: ftime, ago: ago,
    boards: boards, board: board, boardTitle: boardTitle, boardPath: boardPath,
    allThreads: allThreads, threadsIn: threadsIn, threadsDeep: threadsDeep, thread: thread, latest: latest,
    createThread: createThread, reply: reply, delThread: delThread, delPost: delPost,
    hasThanks: hasThanks, toggleThanks: toggleThanks,
    search: search, paginate: paginate, renderPager: renderPager,
    seededFile: seededFile,
    renderChrome: renderChrome, toast: toast, uid: uid,
    state: state
  };

  initSearch();
  renderChrome();
})();