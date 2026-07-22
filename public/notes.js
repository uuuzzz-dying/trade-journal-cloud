(() => {
  if (window.__tradeJournalNotesV1) return;
  window.__tradeJournalNotesV1 = true;

  const byId = id => document.getElementById(id);
  let currentReaderNoteId = '';

  function installNoteStyles() {
    if (byId('noteFeatureStyles')) return;
    const style = document.createElement('style');
    style.id = 'noteFeatureStyles';
    style.textContent = `
      body.note-layer-open{overflow:hidden}
      .note-editor-box{width:min(1080px,100%)}
      .note-editor-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 10px;flex-wrap:wrap}
      .note-editor-toolbar-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .note-tool-btn{border:1px solid rgba(29,29,31,.1);border-radius:999px;padding:9px 13px;background:#fff;color:#1d1d1f;font-size:13px;font-weight:750;cursor:pointer}
      .note-tool-btn:hover{background:#f5f5f7;transform:translateY(-1px)}
      .note-tool-hint{color:#6e6e73;font-size:12px;line-height:1.5}
      #nContent{min-height:210px;font-family:inherit}
      .note-editor-modal.editor-fullscreen{padding:0;background:#f5f5f7;backdrop-filter:none}
      .note-editor-modal.editor-fullscreen .note-editor-box{width:100%;height:100%;max-height:none;border-radius:0;border:0;padding:28px clamp(20px,6vw,96px);box-shadow:none;display:flex;flex-direction:column;overflow:auto}
      .note-editor-modal.editor-fullscreen .modal-head{position:sticky;top:-28px;z-index:3;margin:-28px 0 10px;padding:24px 0 14px;background:rgba(245,245,247,.96);backdrop-filter:blur(18px)}
      .note-editor-modal.editor-fullscreen #nContent{min-height:46vh;flex:1;resize:none;background:#fff;font-size:17px;line-height:1.8;padding:22px}
      .note-editor-modal.editor-fullscreen .voice-note-tools{background:#fff}
      .note-editor-save{align-self:flex-start;margin-top:6px}
      .note-item-shell{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}
      .note-preview-open{width:100%;border:0;background:transparent;padding:0;text-align:left;color:inherit;cursor:pointer;border-radius:16px}
      .note-preview-open:focus-visible{outline:3px solid rgba(0,113,227,.28);outline-offset:8px}
      .note-preview-title{display:block;font-size:18px;margin-top:10px}
      .note-preview-content{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;line-height:1.75;margin-top:14px;color:#6e6e73;white-space:pre-line}
      .note-open-cue{display:inline-flex;align-items:center;gap:6px;margin-top:12px;color:#0071e3;font-size:12px;font-weight:800}
      .note-reader-modal{padding:0;background:#f5f5f7;backdrop-filter:none;align-items:stretch}
      .note-reader-shell{width:100%;height:100%;max-height:none;overflow:auto;border-radius:0;border:0;box-shadow:none;background:#f5f5f7;padding:0}
      .note-reader-header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px clamp(20px,5vw,72px);background:rgba(245,245,247,.9);backdrop-filter:blur(22px);border-bottom:1px solid rgba(29,29,31,.07)}
      .note-reader-header-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
      .note-reader-close{border:0;background:#e9e9ec;border-radius:50%;width:44px;height:44px;font-size:21px;cursor:pointer}
      .note-reader-article{width:min(1080px,calc(100% - 40px));margin:34px auto 80px;background:#fff;border:1px solid rgba(255,255,255,.9);border-radius:30px;padding:clamp(26px,5vw,70px);box-shadow:0 18px 48px rgba(0,0,0,.07)}
      .note-reader-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:18px}
      .note-reader-title{font-size:clamp(32px,5vw,58px);line-height:1.12;letter-spacing:-1.8px;margin:0 0 28px}
      .note-reader-content{font-size:17px;line-height:1.9;color:#2c2c2e}
      .note-reader-content p{margin:0 0 1.15em;white-space:pre-wrap}
      .note-reader-content h2,.note-reader-content h3{margin:1.5em 0 .65em;letter-spacing:-.5px}
      .note-reader-content ul{padding-left:1.4em;line-height:1.9}
      .note-reader-content li{margin:.35em 0}
      .note-table-wrap{overflow:auto;margin:24px 0;border:1px solid rgba(29,29,31,.1);border-radius:18px}
      .note-content-table{width:100%;min-width:520px;border-collapse:collapse;background:#fff;font-size:15px}
      .note-content-table th{background:#f5f5f7;color:#3a3a3c;font-size:13px;text-transform:none;letter-spacing:0}
      .note-content-table th,.note-content-table td{padding:14px 16px;border-right:1px solid rgba(29,29,31,.08);border-bottom:1px solid rgba(29,29,31,.08);vertical-align:top}
      .note-content-table th:last-child,.note-content-table td:last-child{border-right:0}
      .note-content-table tr:last-child td{border-bottom:0}
      .note-reader-voice-status{min-height:20px;color:#6e6e73;font-size:12px;margin-top:12px}
      @media(max-width:720px){
        .note-item-shell{grid-template-columns:1fr}.note-item-shell>.actions{width:100%}
        .note-item-shell>.actions .btn{width:auto;flex:1}
        .note-editor-toolbar{align-items:flex-start}.note-editor-toolbar-group{width:100%}
        .note-tool-btn{flex:1}.note-tool-hint{width:100%}
        .note-reader-header{align-items:flex-start;padding:14px}.note-reader-header .btn{width:auto;padding:10px 14px}
        .note-reader-header-actions{justify-content:flex-end}.note-reader-article{width:calc(100% - 20px);margin:10px auto 40px;border-radius:22px;padding:24px 20px}
        .note-reader-title{font-size:34px;letter-spacing:-1px}.note-reader-content{font-size:16px}
        .note-editor-modal.editor-fullscreen .note-editor-box{padding:20px 14px}
        .note-editor-modal.editor-fullscreen .modal-head{top:-20px;margin:-20px 0 8px;padding:18px 0 12px}
      }
    `;
    document.head.appendChild(style);
  }

  function installEditorToolbar() {
    const modal = byId('noteModal');
    const content = byId('nContent');
    if (!modal || !content || byId('noteEditorToolbar')) return;
    modal.classList.add('note-editor-modal');
    modal.querySelector('.modal-box')?.classList.add('note-editor-box');
    content.placeholder = '写下你的判断、证据、风险和下一步行动……';

    const toolbar = document.createElement('div');
    toolbar.id = 'noteEditorToolbar';
    toolbar.className = 'note-editor-toolbar';
    toolbar.innerHTML = `
      <div class="note-editor-toolbar-group">
        <button type="button" class="note-tool-btn" id="noteFullscreenBtn" onclick="toggleNoteEditorFullscreen()">⛶ 全屏写作</button>
        <button type="button" class="note-tool-btn" onclick="insertNoteTable(2,2)">插入 2×2 表格</button>
        <button type="button" class="note-tool-btn" onclick="insertNoteTable(3,3)">插入 3×3 表格</button>
        <button type="button" class="note-tool-btn" onclick="insertNoteTable(4,4)">插入 4×4 表格</button>
      </div>
      <span class="note-tool-hint">表格会以可编辑文本保存，阅读时自动显示为正式表格。</span>
    `;
    content.insertAdjacentElement('beforebegin', toolbar);
    const saveButton = modal.querySelector('button[onclick="saveNote()"]');
    saveButton?.classList.add('note-editor-save');
  }

  function installReader() {
    if (byId('noteReaderModal')) return;
    const modal = document.createElement('div');
    modal.className = 'modal note-reader-modal';
    modal.id = 'noteReaderModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'noteReaderTitle');
    modal.innerHTML = `
      <div class="modal-box note-reader-shell">
        <div class="note-reader-header">
          <div>
            <div class="eyebrow">FULL NOTE</div>
            <strong>笔记全文</strong>
          </div>
          <div class="note-reader-header-actions">
            <button type="button" class="btn soft" onclick="readOpenNote()">🔊 朗读</button>
            <button type="button" class="btn soft" onclick="stopVoiceReading()">停止朗读</button>
            <button type="button" class="btn primary" onclick="editOpenNote()">修改</button>
            <button type="button" class="note-reader-close" aria-label="关闭笔记全文" onclick="closeM('noteReaderModal')">×</button>
          </div>
        </div>
        <article class="note-reader-article">
          <div class="note-reader-meta" id="noteReaderMeta"></div>
          <h1 class="note-reader-title" id="noteReaderTitle"></h1>
          <div class="note-reader-content" id="noteReaderContent"></div>
          <div class="note-reader-voice-status" id="noteReaderVoiceStatus"></div>
        </article>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function splitTableRow(line) {
    return String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function renderNoteContent(value) {
    const lines = String(value || '').replace(/\r/g, '').split('\n');
    const output = [];
    let paragraph = [];
    let list = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map(line => esc(line)).join('<br>')}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list.length) return;
      output.push(`<ul>${list.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`);
      list = [];
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1] || '';
      if (line.includes('|') && isTableSeparator(next)) {
        flushParagraph();
        flushList();
        const headers = splitTableRow(line);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        i -= 1;
        output.push(`<div class="note-table-wrap"><table class="note-content-table"><thead><tr>${headers.map(cell => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, index) => `<td>${esc(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length === 1 ? 'h2' : 'h3';
        output.push(`<${level}>${esc(heading[2])}</${level}>`);
        continue;
      }
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        list.push(bullet[1]);
        continue;
      }
      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    return output.join('') || '<p class="muted">这条笔记暂时没有内容。</p>';
  }

  function notePreviewText(value) {
    return String(value || '')
      .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
      .replace(/\|/g, ' · ')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function toggleNoteEditorFullscreen(force) {
    const modal = byId('noteModal');
    if (!modal) return;
    const next = typeof force === 'boolean' ? force : !modal.classList.contains('editor-fullscreen');
    modal.classList.toggle('editor-fullscreen', next);
    const button = byId('noteFullscreenBtn');
    if (button) {
      button.textContent = next ? '↙ 退出全屏' : '⛶ 全屏写作';
      button.setAttribute('aria-pressed', String(next));
    }
    document.body.classList.toggle('note-layer-open', next || Boolean(document.querySelector('.modal.open')));
    if (next) window.setTimeout(() => byId('nContent')?.focus(), 0);
  }

  function insertNoteTable(columns = 3, rows = 3) {
    const content = byId('nContent');
    if (!content) return;
    const columnCount = Math.min(6, Math.max(2, Number(columns) || 3));
    const rowCount = Math.min(10, Math.max(1, Number(rows) || 3));
    const header = `| ${Array.from({ length: columnCount }, (_, index) => `列${index + 1}`).join(' | ')} |`;
    const separator = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rowCount }, () => `| ${Array.from({ length: columnCount }, () => '填写内容').join(' | ')} |`).join('\n');
    const table = `${header}\n${separator}\n${body}`;
    const start = Number.isFinite(content.selectionStart) ? content.selectionStart : content.value.length;
    const end = Number.isFinite(content.selectionEnd) ? content.selectionEnd : start;
    const before = content.value.slice(0, start);
    const after = content.value.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
    content.value = `${before}${prefix}${table}${suffix}${after}`;
    const cursor = before.length + prefix.length + 2;
    content.focus();
    content.setSelectionRange(cursor, cursor + 2);
    content.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openNoteReader(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    const stock = stocks.find(item => item.id === note.stock_id) || {};
    currentReaderNoteId = id;
    byId('noteReaderTitle').textContent = note.title || note.note_type || '未命名笔记';
    byId('noteReaderMeta').innerHTML = `<span class="badge">${esc(note.note_type || '笔记')}</span>${stock.name ? `<span class="badge">${esc(stock.name)}</span>` : ''}<span class="muted">${esc(note.note_date || '')}</span>`;
    byId('noteReaderContent').innerHTML = renderNoteContent(note.content);
    byId('noteReaderVoiceStatus').textContent = '';
    openM('noteReaderModal');
    document.body.classList.add('note-layer-open');
  }

  function editOpenNote() {
    const id = currentReaderNoteId;
    closeM('noteReaderModal');
    if (id) editNote(id);
  }

  function readOpenNote() {
    const note = notes.find(item => item.id === currentReaderNoteId);
    if (!note) return;
    if (typeof window.readNoteText !== 'function') {
      byId('noteReaderVoiceStatus').textContent = '朗读功能仍在加载，请稍后再试。';
      return;
    }
    window.readNoteText(note.title || '', notePreviewText(note.content), 'noteReaderVoiceStatus');
  }

  function enhancedRenderNotes() {
    const q = (byId('noteSearch')?.value || '').toLowerCase().trim();
    const filtered = notes.filter(note => {
      const stock = stocks.find(item => item.id === note.stock_id) || {};
      const matchesText = !q || [note.title, note.content, stock.name, stock.code, note.note_type].join(' ').toLowerCase().includes(q);
      const matchesCategory = noteCategory === 'all' || noteGroup(note) === noteCategory;
      const matchesDate = !selectedNoteDate || note.note_date === selectedNoteDate;
      return matchesText && matchesCategory && matchesDate;
    });
    const categoryName = { all: '全部心得', learning: '学习心得', trade: '买卖复盘', general: '其他笔记' }[noteCategory];
    if (byId('noteFilterSummary')) byId('noteFilterSummary').textContent = selectedNoteDate ? `${categoryName} · ${selectedNoteDate}` : `显示${categoryName}`;
    if (byId('noteResultCount')) byId('noteResultCount').textContent = `${filtered.length}条`;
    byId('notesList').innerHTML = filtered.map(note => {
      const stock = stocks.find(item => item.id === note.stock_id) || {};
      return `<div class="note-item"><div class="note-item-shell"><button type="button" class="note-preview-open" onclick="openNoteReader('${note.id}')" aria-label="阅读笔记：${esc(note.title)}"><div class="note-meta"><span class="badge">${esc(note.note_type)}</span>${stock.name ? `<span class="badge">${esc(stock.name)}</span>` : ''}<span class="muted">${esc(note.note_date)}</span></div><strong class="note-preview-title">${esc(note.title)}</strong><span class="note-preview-content">${esc(notePreviewText(note.content))}</span><span class="note-open-cue">查看全文 <span aria-hidden="true">→</span></span></button><div class="actions"><button class="btn soft" onclick="editNote('${note.id}')">修改</button><button class="btn danger" onclick="deleteNote('${note.id}')">删除</button></div></div></div>`;
    }).join('') || '<div class="empty">这个筛选条件下暂无心得</div>';
    renderNoteCalendar();
  }

  function installNoteFeature() {
    installNoteStyles();
    installEditorToolbar();
    installReader();

    const baseOpenNote = openNote;
    openNote = function (...args) {
      toggleNoteEditorFullscreen(false);
      return baseOpenNote(...args);
    };

    const baseEditNote = editNote;
    editNote = function (...args) {
      toggleNoteEditorFullscreen(false);
      return baseEditNote(...args);
    };

    const baseCloseM = closeM;
    closeM = function (id) {
      if (id === 'noteModal') toggleNoteEditorFullscreen(false);
      if (id === 'noteReaderModal') {
        currentReaderNoteId = '';
        if (typeof window.stopVoiceReading === 'function') window.stopVoiceReading(true);
      }
      const result = baseCloseM(id);
      window.setTimeout(() => document.body.classList.toggle('note-layer-open', Boolean(document.querySelector('.modal.open'))), 0);
      return result;
    };

    renderNotes = enhancedRenderNotes;

    const baseRender = render;
    render = function (...args) {
      const result = baseRender(...args);
      if (byId('recentNotes')) {
        byId('recentNotes').innerHTML = notes.slice(0, 4).map(note => `<button type="button" class="note-preview-open" style="padding:12px 0;border-bottom:1px solid var(--line);border-radius:0" onclick="openNoteReader('${note.id}')"><strong>${esc(note.title)}</strong><span class="muted" style="display:block;margin-top:5px">${esc(note.note_date)} · ${esc(notePreviewText(note.content)).slice(0, 76)}</span></button>`).join('') || '<div class="empty">今天写一条心得吧</div>';
      }
      return result;
    };

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (byId('noteReaderModal')?.classList.contains('open')) closeM('noteReaderModal');
      else if (byId('noteModal')?.classList.contains('editor-fullscreen')) toggleNoteEditorFullscreen(false);
    });

    window.toggleNoteEditorFullscreen = toggleNoteEditorFullscreen;
    window.insertNoteTable = insertNoteTable;
    window.openNoteReader = openNoteReader;
    window.editOpenNote = editOpenNote;
    window.readOpenNote = readOpenNote;
    window.renderNoteContent = renderNoteContent;
  }

  installNoteFeature();
})();
