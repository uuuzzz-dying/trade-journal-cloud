(() => {
  if (window.__tradeJournalVoiceV1) return;
  window.__tradeJournalVoiceV1 = true;
  const byId = id => document.getElementById(id);
  let voiceRecognition = null;
  let voiceIsListening = false;
  let voiceStartedAt = 0;
  let voiceTimer = null;
  let voiceStopTimer = null;
  let voiceBaseText = '';
  let voiceFinalText = '';
  let voiceSummaryText = '';

  function installVoiceStyles() {
    if (byId('voiceFeatureStyles')) return;
    const style = document.createElement('style');
    style.id = 'voiceFeatureStyles';
    style.textContent = `
      .voice-note-tools{margin:14px 0 4px;padding:15px;border:1px solid rgba(29,29,31,.08);border-radius:18px;background:#f7f7f9}
      .voice-note-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
      .voice-note-actions{display:flex;gap:8px;flex-wrap:wrap}
      .voice-btn{border:1px solid rgba(29,29,31,.1);border-radius:999px;padding:10px 14px;background:#fff;font-weight:750;color:#1d1d1f;cursor:pointer}
      .voice-btn:hover{background:#fff;transform:translateY(-1px)}
      .voice-btn.recording{background:#fff0f1;color:#d70015;border-color:rgba(215,0,21,.18);box-shadow:0 0 0 4px rgba(215,0,21,.06)}
      .voice-btn.primary-action{background:#111113;color:#fff;border-color:#111113}
      .voice-status{font-size:12px;color:#6e6e73;line-height:1.55;margin-top:9px}
      .voice-summary-preview{margin-top:12px;padding:14px;border-radius:15px;background:#fff;border:1px solid rgba(29,29,31,.08)}
      .voice-summary-preview textarea{min-height:180px;margin-top:8px;background:#fbfbfd}
      .voice-summary-title{font-size:13px;font-weight:800;color:#3a3a3c}
      .voice-summary-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .voice-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#d70015;margin-right:6px;animation:voicePulse 1.2s infinite}
      @keyframes voicePulse{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1.15)}}
      @media(max-width:650px){.voice-note-head{align-items:flex-start}.voice-note-actions{width:100%}.voice-btn{flex:1;min-width:120px}}
    `;
    document.head.appendChild(style);
  }

  function voiceFormatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function setVoiceStatus(message, recording = false) {
    const status = byId('voiceNoteStatus');
    if (!status) return;
    status.innerHTML = recording ? `<span class="voice-dot"></span>${message}` : message;
  }

  function resetVoicePanel() {
    stopVoiceRecognition(true);
    stopVoiceReading();
    voiceSummaryText = '';
    const preview = byId('voiceSummaryPreview');
    if (preview) preview.classList.add('hidden');
    const summary = byId('voiceSummaryText');
    if (summary) summary.value = '';
    setVoiceStatus('点击“开始语音”后直接说话，识别结果会写入内容。最长3分钟。');
  }

  function installVoiceNoteTools() {
    installVoiceStyles();
    const content = byId('nContent');
    if (!content || byId('voiceNoteTools')) return;

    const tools = document.createElement('div');
    tools.id = 'voiceNoteTools';
    tools.className = 'voice-note-tools';
    tools.innerHTML = `
      <div class="voice-note-head">
        <div>
          <strong>语音读写</strong>
          <div class="voice-status" id="voiceNoteStatus">点击“开始语音”后直接说话，识别结果会写入内容。最长3分钟。</div>
        </div>
        <div class="voice-note-actions">
          <button type="button" class="voice-btn" id="voiceRecordBtn" onclick="toggleVoiceRecognition()">🎙 开始语音</button>
          <button type="button" class="voice-btn" onclick="createVoiceSummary()">整理总结</button>
          <button type="button" class="voice-btn" onclick="readCurrentNote()">🔊 朗读</button>
          <button type="button" class="voice-btn" onclick="stopVoiceReading()">停止朗读</button>
        </div>
      </div>
      <div id="voiceSummaryPreview" class="voice-summary-preview hidden">
        <div class="voice-summary-title">归纳预览（保存前可以修改）</div>
        <textarea id="voiceSummaryText"></textarea>
        <div class="voice-summary-actions">
          <button type="button" class="voice-btn primary-action" onclick="applyVoiceSummary('replace')">使用归纳版</button>
          <button type="button" class="voice-btn" onclick="applyVoiceSummary('append')">原文与归纳版都保留</button>
          <button type="button" class="voice-btn" onclick="discardVoiceSummary()">关闭预览</button>
        </div>
      </div>
    `;
    content.insertAdjacentElement('afterend', tools);
  }

  function speechRecognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function toggleVoiceRecognition() {
    if (voiceIsListening) stopVoiceRecognition();
    else startVoiceRecognition();
  }

  function startVoiceRecognition() {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setVoiceStatus('当前浏览器不支持语音识别。建议使用最新版 Chrome 或 Edge。');
      return;
    }

    stopVoiceReading();
    const content = byId('nContent');
    if (!content) return;

    voiceRecognition = new Recognition();
    voiceRecognition.lang = 'zh-CN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;
    voiceIsListening = true;
    voiceStartedAt = Date.now();
    voiceBaseText = content.value.trim();
    voiceFinalText = '';

    const button = byId('voiceRecordBtn');
    if (button) {
      button.classList.add('recording');
      button.textContent = '■ 停止语音';
    }

    voiceRecognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) voiceFinalText += text;
        else interim += text;
      }
      const pieces = [voiceBaseText, voiceFinalText.trim(), interim.trim()].filter(Boolean);
      content.value = pieces.join(voiceBaseText ? '\n' : '');
      content.dispatchEvent(new Event('input', { bubbles: true }));
    };

    voiceRecognition.onerror = event => {
      const messages = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许麦克风。',
        'no-speech': '没有检测到说话声音，请靠近麦克风再试。',
        'audio-capture': '没有找到可用的麦克风。',
        'network': '语音识别网络暂时不可用，请稍后重试。'
      };
      setVoiceStatus(messages[event.error] || `语音识别失败：${event.error || '未知错误'}`);
    };

    voiceRecognition.onend = () => {
      if (voiceIsListening) {
        try { voiceRecognition.start(); } catch (_) { stopVoiceRecognition(); }
      }
    };

    try {
      voiceRecognition.start();
      voiceTimer = window.setInterval(() => {
        const elapsed = (Date.now() - voiceStartedAt) / 1000;
        setVoiceStatus(`正在识别 ${voiceFormatTime(elapsed)} / 03:00，点击“停止语音”结束。`, true);
      }, 500);
      voiceStopTimer = window.setTimeout(() => stopVoiceRecognition(), 180000);
    } catch (error) {
      stopVoiceRecognition(true);
      setVoiceStatus(`无法启动语音识别：${error.message}`);
    }
  }

  function stopVoiceRecognition(silent = false) {
    voiceIsListening = false;
    if (voiceTimer) window.clearInterval(voiceTimer);
    if (voiceStopTimer) window.clearTimeout(voiceStopTimer);
    voiceTimer = null;
    voiceStopTimer = null;

    if (voiceRecognition) {
      try { voiceRecognition.stop(); } catch (_) {}
      voiceRecognition = null;
    }

    const button = byId('voiceRecordBtn');
    if (button) {
      button.classList.remove('recording');
      button.textContent = '🎙 开始语音';
    }

    if (!silent && byId('voiceNoteStatus')) {
      const elapsed = voiceStartedAt ? (Date.now() - voiceStartedAt) / 1000 : 0;
      setVoiceStatus(`语音记录已停止，本次约 ${voiceFormatTime(elapsed)}。你可以继续修改文字或点击“整理总结”。`);
    }
  }

  function splitVoiceSentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/(?<=[。！？!?；;])|\n+/)
      .map(value => value.trim())
      .filter(value => value.length >= 2);
  }

  function uniqueVoiceSentences(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = item.replace(/[\s，。！？；、,.!?;:：]/g, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function createStructuredVoiceSummary(text) {
    const sentences = uniqueVoiceSentences(splitVoiceSentences(text));
    if (!sentences.length) return '';

    const includesAny = (sentence, words) => words.some(word => sentence.includes(word));
    const riskWords = ['风险', '担心', '可能跌', '不确定', '问题', '失效', '止损', '下跌', '回落', '亏损', '谨慎'];
    const actionWords = ['观察', '关注', '等待', '计划', '下一步', '明天', '之后', '准备', '再看', '不追', '加仓', '减仓', '卖出', '买入'];
    const reasonWords = ['因为', '原因', '由于', '依据', '说明', '所以', '成交量', '业绩', '估值', '政策', '资金', '趋势'];

    const risks = sentences.filter(sentence => includesAny(sentence, riskWords));
    const actions = sentences.filter(sentence => includesAny(sentence, actionWords));
    const reasons = sentences.filter(sentence => includesAny(sentence, reasonWords));
    const core = sentences.filter(sentence => !risks.includes(sentence) && !actions.includes(sentence)).slice(0, 3);

    const section = (title, items, fallback) => {
      const values = uniqueVoiceSentences(items).slice(0, 5);
      return `${title}\n${values.length ? values.map(item => `- ${item}`).join('\n') : `- ${fallback}`}`;
    };

    return [
      section('核心观点', core.length ? core : sentences.slice(0, 2), '原文没有明确表达核心结论，建议补充。'),
      section('判断依据', reasons.filter(item => !core.includes(item)), '原文没有明确说明依据，建议补充数据、新闻或市场表现。'),
      section('风险与疑问', risks, '原文没有明确提到风险，建议补充判断失效的条件。'),
      section('后续行动', actions, '原文没有明确后续行动，建议写下需要继续观察的内容。')
    ].join('\n\n');
  }

  function createVoiceSummary() {
    stopVoiceRecognition(true);
    const content = byId('nContent')?.value.trim() || '';
    if (!content) {
      setVoiceStatus('还没有可以整理的内容。请先输入文字或开始语音记录。');
      return;
    }

    voiceSummaryText = createStructuredVoiceSummary(content);
    const preview = byId('voiceSummaryPreview');
    const summary = byId('voiceSummaryText');
    if (summary) summary.value = voiceSummaryText;
    preview?.classList.remove('hidden');

    if (!byId('nTitle')?.value.trim()) {
      const first = splitVoiceSentences(content)[0] || '';
      if (first) byId('nTitle').value = first.replace(/[。！？!?；;]+$/g, '').slice(0, 28);
    }
    setVoiceStatus('已生成归纳预览。系统只整理你的原话，不会添加外部事实。');
  }

  function applyVoiceSummary(mode = 'replace') {
    const content = byId('nContent');
    const summary = byId('voiceSummaryText')?.value.trim() || voiceSummaryText;
    if (!content || !summary) return;
    const original = content.value.trim();
    content.value = mode === 'append'
      ? `【原始记录】\n${original}\n\n【归纳总结】\n${summary}`
      : summary;
    content.dispatchEvent(new Event('input', { bubbles: true }));
    discardVoiceSummary();
    setVoiceStatus(mode === 'append' ? '已保留原文并加入归纳总结。' : '已使用归纳版，你仍可继续修改。');
  }

  function discardVoiceSummary() {
    byId('voiceSummaryPreview')?.classList.add('hidden');
  }

  function readCurrentNote() {
    stopVoiceRecognition(true);
    if (!('speechSynthesis' in window)) {
      setVoiceStatus('当前浏览器不支持文字朗读。');
      return;
    }
    const title = byId('nTitle')?.value.trim() || '';
    const content = byId('nContent')?.value.trim() || '';
    const text = [title, content].filter(Boolean).join('。');
    if (!text) {
      setVoiceStatus('没有可以朗读的内容。');
      return;
    }

    stopVoiceReading();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => setVoiceStatus('正在朗读当前笔记…');
    utterance.onend = () => setVoiceStatus('朗读完成。');
    utterance.onerror = () => setVoiceStatus('朗读失败，请稍后重试。');
    window.speechSynthesis.speak(utterance);
  }

  function stopVoiceReading() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function installVoiceFeature() {
    installVoiceNoteTools();

    const baseOpenNote = openNote;
    openNote = function (...args) {
      baseOpenNote(...args);
      window.setTimeout(resetVoicePanel, 0);
    };

    const baseEditNote = editNote;
    editNote = function (...args) {
      baseEditNote(...args);
      window.setTimeout(resetVoicePanel, 0);
    };

    const baseCloseM = closeM;
    closeM = function (id) {
      if (id === 'noteModal') {
        stopVoiceRecognition(true);
        stopVoiceReading();
      }
      return baseCloseM(id);
    };

    window.toggleVoiceRecognition = toggleVoiceRecognition;
    window.createVoiceSummary = createVoiceSummary;
    window.applyVoiceSummary = applyVoiceSummary;
    window.discardVoiceSummary = discardVoiceSummary;
    window.readCurrentNote = readCurrentNote;
    window.stopVoiceReading = stopVoiceReading;
  }

  installVoiceFeature();
})();
