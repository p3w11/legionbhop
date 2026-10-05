/* ============================================================
   LEGION — мини-разметка сообщений (bbcode-подобная)
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function format(raw) {
    var s = esc(String(raw || '').replace(/\r\n/g, '\n').trim());
    if (!s) return '';

    s = s.replace(/\[quote=&quot;([^\n]*?)&quot;\]([\s\S]*?)\[\/quote\]/g, function (m, who, body) {
      return '<blockquote><b>' + who + ' писал:</b><br>' + body.replace(/\n/g, '<br>') + '</blockquote>';
    });
    s = s.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/g, '<span class="spoiler">$1</span>');
    s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<b>$1</b>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    return s.split(/\n{2,}/).map(function (block) {
      return block.trim() ? '<p>' + block.replace(/\n/g, '<br>') + '</p>' : '';
    }).join('');
  }

  window.LegionFormat = format;
})();