(() => {
  if (window.__tradeJournalMarketV4) return;
  window.__tradeJournalMarketV4 = true;

  const byId = id => document.getElementById(id);
  const chartHandles = new Map();
  const chartRanges = new Map();
  const chartCache = new Map();
  let chartLibraryPromise = null;
  let marketLookupTimer = null;

  const sourceNames = {
    auto: '自动组合',
    eastmoney: '东方财富',
    yahoo: 'Yahoo Finance',
    manual: '手动维护'
  };

  function formatPrice(value, fallback = '—') {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(4) : fallback;
  }

  function formatMoneyByCurrency(value, currency = 'CNY') {
    const code = String(currency || 'CNY').toUpperCase();
    const symbol = code === 'USD' ? '$' : code === 'HKD' ? 'HK$' : code === 'CNY' ? '¥' : `${code} `;
    return `${symbol}${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function ensureMarketStyles() {
    if (document.querySelector('link[data-market-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/market.css?v=4.4';
    link.dataset.marketStyles = 'true';
    document.head.appendChild(link);
  }

  function sourceBadge(source) {
    const value = source || 'manual';
    return `<span class="market-source ${esc(value)}">${esc(sourceNames[value] || value)}</span>`;
  }

  const marketTypeNames = {
    a: 'A股',
    hk: '港股',
    us: '美股'
  };

  function inferMarketType(code, market = '', currency = '', quoteSymbol = '') {
    const rawCode = String(code || '').trim().toUpperCase();
    const marketText = String(market || '').trim();
    const currencyCode = String(currency || '').trim().toUpperCase();
    const symbol = String(quoteSymbol || '').trim().toUpperCase();

    if (marketText.includes('港') || currencyCode === 'HKD' || symbol.endsWith('.HK')) return 'hk';
    if (
      marketText.includes('美') ||
      currencyCode === 'USD' ||
      /^[A-Z]/.test(rawCode) ||
      (symbol && !/\.(SS|SZ|BJ|HK)$/i.test(symbol))
    ) return 'us';
    return 'a';
  }

  function selectedMarketType() {
    return document.querySelector('input[name="sMarketType"]:checked')?.value || 'a';
  }

  function normalizeStockCode(value, marketType = 'a', strict = true) {
    const raw = String(value || '').trim().toUpperCase();

    const fail = message => {
      if (strict) throw new Error(message);
      return '';
    };

    if (marketType === 'a') {
      const code = raw.replace(/\.(SH|SZ|SS|BJ)$/i, '');
      return /^\d{6}$/.test(code) ? code : fail('A股请输入6位数字代码，例如 600422');
    }

    if (marketType === 'hk') {
      const code = raw.replace(/\.HK$/i, '');
      if (!/^\d{1,5}$/.test(code)) return fail('港股请输入1至5位数字代码，例如 700 或 9988');
      return code.length <= 4 ? code.padStart(4, '0') : code;
    }

    const code = raw.replace(/\s+/g, '');
    return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(code)
      ? code
      : fail('美股请输入代码，例如 AAPL、TSLA 或 BRK-B');
  }

  function defaultQuoteSymbol(code, marketType = '') {
    const value = String(code || '').trim().toUpperCase();
    if (!value) return '';
    if (/\.(SS|SZ|BJ|HK)$/i.test(value)) return value;

    const type = marketType || inferMarketType(value);
    const normalized = normalizeStockCode(value, type, false) || value;

    if (type === 'hk') return `${normalized}.HK`;
    if (type === 'us') return normalized;
    if (/^(4|8|92)/.test(normalized)) return `${normalized}.BJ`;
    if (/^(5|6|9)/.test(normalized)) return `${normalized}.SS`;
    return `${normalized}.SZ`;
  }

  function marketDefaults(marketType) {
    if (marketType === 'hk') {
      return {
        placeholder: '输入港股代码，例如 700 或 9988',
        quotePlaceholder: '例如 0700.HK',
        currency: 'HKD',
        market: '港股',
        source: 'yahoo',
        inputMode: 'numeric',
        maxLength: 8
      };
    }

    if (marketType === 'us') {
      return {
        placeholder: '输入美股代码，例如 AAPL 或 BRK-B',
        quotePlaceholder: '例如 AAPL',
        currency: 'USD',
        market: '美股',
        source: 'yahoo',
        inputMode: 'text',
        maxLength: 16
      };
    }

    return {
      placeholder: '输入6位代码，例如 600422',
      quotePlaceholder: '例如 600422.SS',
      currency: 'CNY',
      market: '上海主板',
      source: 'auto',
      inputMode: 'numeric',
      maxLength: 9
    };
  }

  function applyStockMarketType(marketType = 'a', clearValues = true) {
    const type = ['a', 'hk', 'us'].includes(marketType) ? marketType : 'a';
    const defaults = marketDefaults(type);
    const radio = document.querySelector(`input[name="sMarketType"][value="${type}"]`);
    if (radio) radio.checked = true;

    const codeInput = byId('sCode');
    if (codeInput) {
      codeInput.placeholder = defaults.placeholder;
      codeInput.inputMode = defaults.inputMode;
      codeInput.maxLength = defaults.maxLength;
      codeInput.autocapitalize = type === 'us' ? 'characters' : 'off';
    }

    const sourceSelect = byId('sInfoSource');
    if (sourceSelect) {
      const autoOption = sourceSelect.querySelector('option[value="auto"]');
      const eastmoneyOption = sourceSelect.querySelector('option[value="eastmoney"]');
      if (autoOption) autoOption.disabled = type !== 'a';
      if (eastmoneyOption) eastmoneyOption.disabled = type !== 'a';

      if (type !== 'a' && sourceSelect.value !== 'manual') sourceSelect.value = 'yahoo';
      if (type === 'a' && ['auto', 'eastmoney'].every(value => sourceSelect.value !== value)) {
        sourceSelect.value = 'auto';
      }
    }

    if (byId('sCurrency')) byId('sCurrency').value = defaults.currency;
    if (byId('sMarket')) byId('sMarket').value = defaults.market;
    if (byId('sQuoteSymbol')) byId('sQuoteSymbol').placeholder = defaults.quotePlaceholder;

    if (clearValues) {
      ['sCode', 'sName', 'sIndustry', 'sExchange', 'sLatestPrice', 'sQuoteSymbol'].forEach(id => {
        if (byId(id)) byId(id).value = '';
      });
      byId('stockLookupStatus')?.classList.add('hidden');
    }

    const hint = byId('stockMarketHint');
    if (hint) {
      hint.textContent = type === 'a'
        ? 'A股使用6位数字代码，可选择东方财富或 Yahoo Finance。'
        : type === 'hk'
          ? '港股可输入700、0700或9988，系统会自动转换为 Yahoo 的 .HK 行情代码。'
          : '美股可输入 AAPL、TSLA、BRK-B 等代码，资料和K线来自 Yahoo Finance。';
    }
  }

  async function marketRequest(params) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error('登录状态已过期，请重新登录');
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/market-data?${query}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `行情服务返回 ${response.status}`);
    return body;
  }

  function ensureChartLibrary() {
    if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
    if (chartLibraryPromise) return chartLibraryPromise;

    chartLibraryPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lightweight-charts]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.LightweightCharts), { once: true });
        existing.addEventListener('error', () => reject(new Error('K线组件加载失败')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
      script.async = true;
      script.dataset.lightweightCharts = 'true';
      script.onload = () => resolve(window.LightweightCharts);
      script.onerror = () => reject(new Error('K线组件加载失败，请检查网络后重试'));
      document.head.appendChild(script);
    });

    return chartLibraryPromise;
  }

  function installConsolidatedLayout() {
    const homeNav = document.querySelector('[data-page="home"]');
    const positionNav = document.querySelector('[data-page="positions"]');
    const flowNav = document.querySelector('[data-page="flows"]');
    const stockNav = document.querySelector('[data-page="stocks"]');
    const notesNav = document.querySelector('[data-page="notes"]');
    const learningNav = document.querySelector('[data-page="learning"]');

    if (homeNav) homeNav.textContent = '首页';
    if (positionNav) positionNav.textContent = '持仓';
    flowNav?.remove();
    stockNav?.remove();
    if (notesNav) notesNav.textContent = '学习';
    learningNav?.remove();

    const positionsSection = byId('positions');
    const flowsSection = byId('flows');
    const stocksSection = byId('stocks');

    if (positionsSection && !byId('holdingPanelPositions')) {
      const title = positionsSection.querySelector(':scope > .title');
      const positionCard = positionsSection.querySelector(':scope > .card');

      if (title) {
        title.innerHTML = `
          <h3>持仓</h3>
          <div class="actions holding-top-actions">
            <button class="btn soft holding-tab active" data-holding-panel="positions" onclick="showHoldingPanel('positions')">持仓明细</button>
            <button class="btn soft holding-tab" data-holding-panel="flows" onclick="showHoldingPanel('flows')">交易流程</button>
            <button class="btn soft holding-tab" data-holding-panel="stocks" onclick="showHoldingPanel('stocks')">股票库</button>
            <button class="btn primary" onclick="openBuy()">记录买入</button>
          </div>
        `;
      }

      const mainPanel = document.createElement('div');
      mainPanel.id = 'holdingPanelPositions';
      mainPanel.className = 'holding-panel active';
      if (positionCard) mainPanel.appendChild(positionCard);
      positionsSection.appendChild(mainPanel);

      const newsCard = byId('newsStock')?.closest('.card');
      if (newsCard) {
        newsCard.id = 'holdingNewsCard';
        newsCard.classList.add('holding-news-card');
        positionsSection.insertBefore(newsCard, mainPanel);
      }

      if (flowsSection) {
        flowsSection.classList.remove('page', 'active');
        flowsSection.classList.add('holding-panel');
        flowsSection.dataset.holdingPanel = 'flows';
        positionsSection.appendChild(flowsSection);
      }

      if (stocksSection) {
        stocksSection.classList.remove('page', 'active');
        stocksSection.classList.add('holding-panel');
        stocksSection.dataset.holdingPanel = 'stocks';
        positionsSection.appendChild(stocksSection);
      }
    }

    const notesSection = byId('notes');
    const notesTitle = notesSection?.querySelector(':scope > .title');
    const notesHeading = notesTitle?.querySelector('h3');
    if (notesHeading) notesHeading.textContent = '学习';
    const learningSection = byId('learning');
    const noteWorkspace = notesSection?.querySelector('.note-workspace');
    const noteList = notesSection?.querySelector('.note-list-card');

    if (notesSection && notesTitle && !byId('learningToggleBtn')) {
      const writeButton = Array.from(notesTitle.querySelectorAll('button'))
        .find(button => button.getAttribute('onclick')?.includes('openNote'));

      let actions = notesTitle.querySelector(':scope > .actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'actions learning-top-actions';
        notesTitle.appendChild(actions);
      }

      const lessonButton = document.createElement('button');
      lessonButton.id = 'learningToggleBtn';
      lessonButton.className = 'btn soft';
      lessonButton.textContent = '每日学习';
      lessonButton.onclick = () => toggleLearningPanel();
      actions.appendChild(lessonButton);

      if (writeButton) {
        writeButton.classList.add('primary');
        actions.appendChild(writeButton);
      }
    }

    if (notesSection && noteWorkspace && !byId('learningPanelHost')) {
      if (learningSection) {
        learningSection.classList.remove('page', 'active');
        const host = document.createElement('div');
        host.id = 'learningPanelHost';
        host.className = 'learning-panel-host hidden';
        host.appendChild(learningSection);
        noteWorkspace.appendChild(host);
      }

      if (noteList) noteList.dataset.notesPanel = 'true';
    }

    installBuyStockNotice();
  }

  function installBuyStockNotice() {
    const box = byId('buyModal')?.querySelector('.modal-box');
    if (!box || byId('buyStockLibraryNotice')) return;
    const head = box.querySelector('.modal-head');
    const notice = document.createElement('div');
    notice.id = 'buyStockLibraryNotice';
    notice.className = 'buy-stock-notice';
    notice.innerHTML = `需先将新股票 <button type="button" onclick="goToStockLibrary()">加入股票库</button>，再回来记录买入。`;
    head?.insertAdjacentElement('afterend', notice);
  }

  function showHoldingPanel(name = 'positions') {
    if (!['positions', 'flows', 'stocks'].includes(name)) name = 'positions';
    const positionsSection = byId('positions');
    if (!positionsSection) return;

    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
    positionsSection.classList.add('active');
    document.querySelector('[data-page="positions"]')?.classList.add('active');

    byId('holdingPanelPositions')?.classList.toggle('active', name === 'positions');
    const flows = byId('flows');
    const stocksPage = byId('stocks');
    flows?.classList.toggle('active', name === 'flows');
    stocksPage?.classList.toggle('active', name === 'stocks');

    document.querySelectorAll('.holding-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.holdingPanel === name);
    });

    if (name === 'positions') renderEnhancedPositions();
    if (name === 'stocks') renderEnhancedStocks();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showLearningPanel(mode = 'notes') {
    const notesSection = byId('notes');
    if (!notesSection) return;

    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
    notesSection.classList.add('active');
    document.querySelector('[data-page="notes"]')?.classList.add('active');

    const sidebar = notesSection.querySelector('.note-sidebar');
    const list = notesSection.querySelector('[data-notes-panel]');
    const learningHost = byId('learningPanelHost');
    const isLesson = mode === 'lesson';

    const workspace = notesSection.querySelector('.note-workspace');
    sidebar?.classList.toggle('hidden', isLesson);
    workspace?.classList.toggle('lesson-mode', isLesson);
    list?.classList.toggle('hidden', isLesson);
    learningHost?.classList.toggle('hidden', !isLesson);

    const toggleButton = byId('learningToggleBtn');
    if (toggleButton) {
      toggleButton.textContent = isLesson ? '个人笔记' : '每日学习';
      toggleButton.classList.toggle('primary', isLesson);
      toggleButton.classList.toggle('soft', !isLesson);
    }

    if (isLesson) renderLesson();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleLearningPanel() {
    const learningHost = byId('learningPanelHost');
    const isLessonOpen = learningHost && !learningHost.classList.contains('hidden');
    showLearningPanel(isLessonOpen ? 'notes' : 'lesson');
  }

  function goToStockLibrary() {
    closeM('buyModal');
    setTimeout(() => openStock(), 80);
  }

  function installStockFields() {
    const status = byId('stockLookupStatus');
    if (!status || byId('sInfoSource')) return;

    status.insertAdjacentHTML('beforebegin', `
      <div id="sMarketTypePicker" class="stock-market-selector">
        <div class="stock-market-selector-title">所属股市</div>
        <div class="stock-market-options" role="radiogroup" aria-label="所属股市">
          <label>
            <input type="radio" name="sMarketType" value="a" checked>
            <span><b>✓</b>A股</span>
          </label>
          <label>
            <input type="radio" name="sMarketType" value="hk">
            <span><b>✓</b>港股</span>
          </label>
          <label>
            <input type="radio" name="sMarketType" value="us">
            <span><b>✓</b>美股</span>
          </label>
        </div>
        <div id="stockMarketHint" class="stock-market-hint">A股使用6位数字代码，可选择东方财富或 Yahoo Finance。</div>
      </div>

      <div class="stock-source-grid">
        <div>
          <label>公司资料来源</label>
          <select id="sInfoSource">
            <option value="auto">自动组合（推荐）</option>
            <option value="eastmoney">东方财富</option>
            <option value="yahoo">Yahoo Finance</option>
            <option value="manual">完全手动</option>
          </select>
        </div>
        <div>
          <label>K线来源</label>
          <select id="sQuoteSource">
            <option value="yahoo">Yahoo Finance</option>
            <option value="manual">暂不联网</option>
          </select>
        </div>
        <div>
          <label>Yahoo 行情代码</label>
          <input id="sQuoteSymbol" placeholder="例如 600422.SS">
        </div>
      </div>
      <div class="stock-source-grid">
        <div><label>交易所</label><input id="sExchange" placeholder="自动获取或手动填写"></div>
        <div><label>币种</label><input id="sCurrency" value="CNY" maxlength="8"></div>
        <div><label>最新价格</label><input id="sLatestPrice" type="number" step="0.0001" placeholder="可留空"></div>
      </div>
    `);

    const oldCode = byId('sCode');
    if (oldCode) {
      const newCode = oldCode.cloneNode(true);
      oldCode.replaceWith(newCode);
      newCode.addEventListener('input', scheduleMarketLookup);
      newCode.addEventListener('blur', lookupStockFromSelectedSource);
    }

    document.querySelectorAll('input[name="sMarketType"]').forEach(input => {
      input.addEventListener('change', () => {
        applyStockMarketType(input.value, true);
      });
    });

    byId('sInfoSource')?.addEventListener('change', () => {
      const manual = byId('sInfoSource').value === 'manual';
      if (manual) {
        status.classList.remove('hidden');
        status.textContent = '已选择手动维护：名称、行业、市场和行情代码都可以自己修改。';
      } else {
        scheduleMarketLookup();
      }
    });

    applyStockMarketType('a', false);
  }

  function installEditModal() {
    if (byId('stockEditModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal" id="stockEditModal"><div class="modal-box">
        <div class="modal-head"><div><div class="eyebrow">Stock Sources</div><h3>修改股票资料与来源</h3></div><button onclick="closeM('stockEditModal')">×</button></div>
        <input id="seId" type="hidden">
        <div class="stock-source-grid">
          <div><label>股票代码</label><input id="seCode" disabled></div>
          <div><label>公司资料来源</label><select id="seInfoSource"><option value="auto">自动组合</option><option value="eastmoney">东方财富</option><option value="yahoo">Yahoo Finance</option><option value="manual">手动维护</option></select></div>
          <div><label>K线来源</label><select id="seQuoteSource"><option value="yahoo">Yahoo Finance</option><option value="manual">暂不联网</option></select></div>
        </div>
        <div class="actions" style="margin:4px 0 14px"><button class="btn soft" onclick="previewStockSource()">从所选来源重新获取</button></div>
        <div id="sePreview" class="source-preview hidden"></div>
        <div class="stock-source-grid">
          <div class="wide"><label>股票名称</label><input id="seName"></div>
          <div><label>自定义板块</label><input id="seSector"></div>
          <div><label>官方行业</label><input id="seIndustry"></div>
          <div><label>市场</label><select id="seMarket"><option>上海主板</option><option>深圳主板</option><option>创业板</option><option>科创板</option><option>北交所</option><option>港股</option><option>美股</option></select></div>
          <div><label>交易所</label><input id="seExchange"></div>
          <div><label>币种</label><input id="seCurrency" maxlength="8"></div>
          <div class="wide"><label>行情代码</label><input id="seQuoteSymbol" placeholder="例如 600422.SS"></div>
        </div>
        <div class="market-warning">资料来源只决定自动填写时从哪里取数。保存前仍可修改任何字段；除非再次点击重新获取，否则手动内容不会被覆盖。</div>
        <div class="actions" style="margin-top:18px"><button id="saveStockEditBtn" class="btn primary" onclick="saveStockEditor()">保存修改</button><button class="btn soft" onclick="closeM('stockEditModal')">取消</button></div>
      </div></div>
    `);
  }

  function resetMarketStockFields() {
    if (!byId('sInfoSource')) return;
    byId('sInfoSource').value = 'auto';
    byId('sQuoteSource').value = 'yahoo';
    applyStockMarketType('a', true);
  }

  function scheduleMarketLookup() {
    clearTimeout(marketLookupTimer);
    marketLookupTimer = setTimeout(lookupStockFromSelectedSource, 450);
  }

  async function lookupStockFromSelectedSource() {
    const marketType = selectedMarketType();
    const raw = byId('sCode')?.value.trim().toUpperCase() || '';
    const code = normalizeStockCode(raw, marketType, false);
    const box = byId('stockLookupStatus');

    if (!code) {
      box?.classList.add('hidden');
      return;
    }

    let source = byId('sInfoSource')?.value || 'auto';
    if (marketType !== 'a' && source !== 'manual') {
      source = 'yahoo';
      if (byId('sInfoSource')) byId('sInfoSource').value = 'yahoo';
    }

    if (byId('sQuoteSymbol')) {
      byId('sQuoteSymbol').value ||= defaultQuoteSymbol(code, marketType);
    }

    if (source === 'manual') {
      box?.classList.remove('hidden');
      if (box) box.textContent = `手动模式：请自己填写${marketTypeNames[marketType]}名称、行业、市场和行情代码。`;
      return;
    }

    box?.classList.remove('hidden');
    if (box) box.textContent = `正在从${sourceNames[source]}获取${marketTypeNames[marketType]}资料…`;

    try {
      const result = await marketRequest({
        action: 'lookup',
        code,
        source,
        market: marketType
      });

      const canonicalCode = result.code || code;
      byId('sCode').value = canonicalCode;
      byId('sName').value = result.name || byId('sName').value;
      byId('sIndustry').value = result.industry || byId('sIndustry').value;

      if (result.market && [...byId('sMarket').options].some(option => option.value === result.market)) {
        byId('sMarket').value = result.market;
      } else if (marketType === 'hk') {
        byId('sMarket').value = '港股';
      } else if (marketType === 'us') {
        byId('sMarket').value = '美股';
      }

      byId('sQuoteSymbol').value = result.quote_symbol || defaultQuoteSymbol(canonicalCode, marketType);
      byId('sExchange').value = result.exchange || '';
      byId('sCurrency').value = result.currency || marketDefaults(marketType).currency;
      byId('sLatestPrice').value = result.latest_price == null ? '' : formatPrice(result.latest_price, '');

      if (box) {
        box.innerHTML = `已获取：<strong>${esc(result.name || canonicalCode)}</strong> · ` +
          `${esc(result.industry || '行业可手动填写')} · ` +
          `${esc(result.exchange || marketTypeNames[marketType])} · ` +
          `${esc(sourceNames[result.source] || result.source)}`;
      }
    } catch (error) {
      if (box) box.textContent = `自动获取失败：${error.message}。你仍然可以切换为手动填写。`;
    }
  }

  async function enhancedSaveManualStock() {
    const marketType = selectedMarketType();
    let code;

    try {
      code = normalizeStockCode(byId('sCode')?.value, marketType, true);
    } catch (error) {
      return alert(error.message);
    }

    const name = byId('sName')?.value.trim() || '';
    let infoSource = byId('sInfoSource')?.value || 'manual';
    const quoteSource = byId('sQuoteSource')?.value || 'yahoo';

    if (marketType !== 'a' && infoSource !== 'manual') infoSource = 'yahoo';
    if (!name) return alert('请填写股票名称');

    const quoteSymbol = (
      byId('sQuoteSymbol')?.value.trim().toUpperCase() ||
      defaultQuoteSymbol(code, marketType)
    );

    if (stocks.some(stock => {
      const existingType = inferMarketType(stock.code, stock.market, stock.currency, stock.quote_symbol);
      const existingSymbol = stock.quote_symbol || defaultQuoteSymbol(stock.code, existingType);
      return String(existingSymbol).toUpperCase() === quoteSymbol.toUpperCase();
    })) {
      return alert('股票库中已经有这只股票');
    }

    let firstBuy = null;
    if (byId('firstBuyToggle')?.checked) {
      firstBuy = {
        price: Number(byId('sBuyPrice').value),
        quantity: Number(byId('sBuyQty').value),
        fee: Number(byId('sBuyFee').value || 0),
        reason: byId('sBuyReason').value.trim(),
        date: byId('sBuyDate').value,
        time: byId('sBuyTime').value
      };
      if (firstBuy.price <= 0 || firstBuy.quantity <= 0 || !firstBuy.reason || !firstBuy.date || !firstBuy.time) {
        return alert('首次买入信息不完整');
      }
    }

    const payload = {
      user_id: user.id,
      code,
      name,
      custom_sector: byId('sSector').value.trim(),
      industry: byId('sIndustry').value.trim(),
      market: marketType === 'hk' ? '港股' : marketType === 'us' ? '美股' : byId('sMarket').value,
      info_source: infoSource,
      quote_source: quoteSource,
      quote_symbol: quoteSymbol,
      exchange: byId('sExchange').value.trim(),
      currency: byId('sCurrency').value.trim().toUpperCase() || marketDefaults(marketType).currency,
      current_price: Number(byId('sLatestPrice').value || 0),
      source_updated_at: infoSource === 'manual' ? null : new Date().toISOString()
    };

    const { data: stock, error } = await sb.from('stocks').insert(payload).select().single();
    if (error) return alert(error.message);

    if (firstBuy) {
      const request = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const { data: position, error: positionError } = await sb.from('positions').insert({
        user_id: user.id,
        stock_id: stock.id,
        open_quantity: firstBuy.quantity,
        status: 'open',
        client_request_id: request
      }).select().single();
      if (positionError) return alert(positionError.message);

      const { error: tradeError } = await sb.from('trades').insert({
        user_id: user.id,
        position_id: position.id,
        stock_id: stock.id,
        trade_type: 'buy',
        trade_date: firstBuy.date,
        trade_time: firstBuy.time,
        price: firstBuy.price,
        quantity: firstBuy.quantity,
        fee: firstBuy.fee,
        reason: firstBuy.reason,
        client_request_id: request
      });
      if (tradeError) return alert(tradeError.message);
    }

    closeM('stockModal');
    await loadAll();
    showHoldingPanel('stocks');
    toast('股票和数据来源已保存');
  }

  function renderEnhancedStocks() {
    const target = byId('stocksList');
    if (!target) return;

    if (!stocks.length) {
      target.innerHTML = '<div class="empty">暂无股票</div>';
      return;
    }

    target.innerHTML = `<div class="scroll"><table><thead><tr><th>代码</th><th>名称</th><th>行业 / 自定义板块</th><th>资料来源</th><th>K线代码</th><th>最新价</th><th>操作</th></tr></thead><tbody>${stocks.map(s => `
      <tr>
        <td><strong>${esc(s.code)}</strong></td>
        <td>${esc(s.name)}<div class="muted table-sub"><span class="market-type-mini">${esc(marketTypeNames[inferMarketType(s.code, s.market, s.currency, s.quote_symbol)])}</span> ${esc(s.market || '')} ${esc(s.exchange || '')}</div></td>
        <td>${esc(s.industry || '—')}<div class="muted table-sub">${esc(s.custom_sector || '未设置自定义板块')}</div></td>
        <td>${sourceBadge(s.info_source || 'manual')}</td>
        <td>${esc(s.quote_symbol || defaultQuoteSymbol(s.code))}<div class="muted table-sub">${esc(s.quote_source || 'yahoo')}</div></td>
        <td>${Number(s.current_price || 0) ? `${esc(s.currency || 'CNY')} ${formatPrice(s.current_price)}` : '待更新'}<div class="muted table-sub">${esc(s.price_date || '')}</div></td>
        <td><div class="stock-actions">
          <button class="btn soft compact-btn" onclick="refreshStockInfo('${s.id}')">更新资料</button>
          <button class="btn soft compact-btn" onclick="openStockEditor('${s.id}')">修改</button>
          <button class="btn soft compact-btn" onclick="quickNews('${s.id}','company')">新闻</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function openStockEditor(id) {
    const stock = stocks.find(x => x.id === id);
    if (!stock) return;
    byId('seId').value = stock.id;
    byId('seCode').value = stock.code;
    byId('seInfoSource').value = stock.info_source || 'manual';
    byId('seQuoteSource').value = stock.quote_source || 'yahoo';
    byId('seName').value = stock.name || '';
    byId('seSector').value = stock.custom_sector || '';
    byId('seIndustry').value = stock.industry || '';
    byId('seMarket').value = stock.market || (/^6/.test(stock.code) ? '上海主板' : '深圳主板');
    byId('seExchange').value = stock.exchange || '';
    byId('seCurrency').value = stock.currency || 'CNY';
    byId('seQuoteSymbol').value = stock.quote_symbol || defaultQuoteSymbol(stock.code, inferMarketType(stock.code, stock.market, stock.currency, stock.quote_symbol));
    byId('sePreview').classList.add('hidden');
    openM('stockEditModal');
  }

  async function previewStockSource() {
    const source = byId('seInfoSource').value;
    const preview = byId('sePreview');
    preview.classList.remove('hidden', 'error');

    if (source === 'manual') {
      preview.textContent = '手动来源不会联网；请直接修改下方字段并保存。';
      return;
    }

    preview.textContent = `正在从${sourceNames[source]}获取…`;
    try {
      const editorMarketType = inferMarketType(
        byId('seCode').value,
        byId('seMarket').value,
        byId('seCurrency').value,
        byId('seQuoteSymbol').value
      );
      const requestSource = editorMarketType === 'a' ? source : 'yahoo';
      const result = await marketRequest({
        action: 'lookup',
        code: byId('seCode').value,
        source: requestSource,
        market: editorMarketType
      });
      byId('seName').value = result.name || byId('seName').value;
      byId('seIndustry').value = result.industry || byId('seIndustry').value;
      if (result.market && [...byId('seMarket').options].some(o => o.value === result.market)) {
        byId('seMarket').value = result.market;
      }
      byId('seExchange').value = result.exchange || '';
      byId('seCurrency').value = result.currency || 'CNY';
      byId('seQuoteSymbol').value = result.quote_symbol || defaultQuoteSymbol(byId('seCode').value, editorMarketType);
      preview.innerHTML = `已获取 <strong>${esc(result.name || '')}</strong>；你可以继续手动修改再保存。`;
    } catch (error) {
      preview.classList.add('error');
      preview.textContent = error.message;
    }
  }

  async function saveStockEditor() {
    const id = byId('seId').value;
    const editorMarketType = inferMarketType(
      byId('seCode').value,
      byId('seMarket').value,
      byId('seCurrency').value,
      byId('seQuoteSymbol').value
    );
    let editorInfoSource = byId('seInfoSource').value;
    if (editorMarketType !== 'a' && editorInfoSource !== 'manual') editorInfoSource = 'yahoo';

    const payload = {
      name: byId('seName').value.trim(),
      custom_sector: byId('seSector').value.trim(),
      industry: byId('seIndustry').value.trim(),
      market: byId('seMarket').value,
      exchange: byId('seExchange').value.trim(),
      currency: byId('seCurrency').value.trim().toUpperCase() || (editorMarketType === 'hk' ? 'HKD' : editorMarketType === 'us' ? 'USD' : 'CNY'),
      info_source: editorInfoSource,
      quote_source: byId('seQuoteSource').value,
      quote_symbol: byId('seQuoteSymbol').value.trim().toUpperCase() || defaultQuoteSymbol(byId('seCode').value),
      source_updated_at: editorInfoSource === 'manual' ? null : new Date().toISOString()
    };

    if (!payload.name) return alert('股票名称不能为空');
    setBusy('saveStockEditBtn', true, '正在保存…');

    try {
      const { error } = await sb.from('stocks').update(payload).eq('id', id);
      if (error) throw error;
      closeM('stockEditModal');
      await loadAll();
      toast('股票资料与来源已更新');
    } catch (error) {
      alert(error.message || '保存失败');
    } finally {
      setBusy('saveStockEditBtn', false);
    }
  }

  async function refreshStockInfo(id) {
    const stock = stocks.find(x => x.id === id);
    if (!stock) return;

    if ((stock.info_source || 'manual') === 'manual') {
      openStockEditor(id);
      return toast('当前为手动来源，请在修改窗口中选择资料源');
    }

    toast(`正在更新 ${stock.name}…`);
    try {
      const stockMarketType = inferMarketType(stock.code, stock.market, stock.currency, stock.quote_symbol);
      const refreshSource = stockMarketType === 'a'
        ? (stock.info_source || 'auto')
        : ((stock.info_source || 'yahoo') === 'manual' ? 'manual' : 'yahoo');
      const result = await marketRequest({
        action: 'lookup',
        code: stock.code,
        source: refreshSource,
        market: stockMarketType
      });
      const payload = {
        name: result.name || stock.name,
        industry: result.industry || stock.industry,
        market: result.market || stock.market,
        exchange: result.exchange || stock.exchange,
        currency: result.currency || stock.currency || 'CNY',
        quote_symbol: result.quote_symbol || stock.quote_symbol || defaultQuoteSymbol(stock.code),
        current_price: result.latest_price ?? stock.current_price,
        source_updated_at: new Date().toISOString()
      };
      const { error } = await sb.from('stocks').update(payload).eq('id', stock.id);
      if (error) throw error;
      await loadAll();
      toast('公司资料已刷新');
    } catch (error) {
      alert(error.message || '资料更新失败');
    }
  }

  function renderEnhancedPositions() {
    const target = byId('positionsList');
    if (!target) return;
    const open = posData().filter(x => x.open > 0);

    if (!open.length) {
      target.innerHTML = '<div class="empty">暂无持仓</div>';
      return;
    }

    target.innerHTML = open.map(position => {
      const stock = position.s;
      const last = Number(stock.close_price || stock.current_price || position.buy.price || 0);
      const floating = (last - Number(position.buy.price || 0)) * position.open;
      return `
        <section class="market-position" data-position-id="${position.id}">
          <div class="market-position-head">
            <div>
              <div class="market-price-line">
                <strong>${esc(stock.name)} ${esc(stock.code)}</strong>
                ${sourceBadge(stock.info_source || 'manual')}
              </div>
              <div class="muted market-position-meta">${esc(stock.custom_sector || stock.industry || '未分类')} · ${esc(stock.quote_symbol || defaultQuoteSymbol(stock.code))}</div>
            </div>
            <div class="actions market-position-actions">
              <button class="btn soft" onclick="openStockEditor('${stock.id}')">资料与来源</button>
              <button class="btn soft" onclick="openPositionEditor('${position.id}')">修正持仓</button>
              <button class="btn primary" onclick="openSell('${position.id}')">卖出</button>
            </div>
          </div>

          <div class="market-subgrid">
            <div><span>持仓 / 成本</span><strong>${position.open}股 / ${formatPrice(position.buy.price, '0.0000')}</strong></div>
            <div><span>今日开盘</span><strong>${stock.open_price == null ? '待更新' : formatPrice(stock.open_price)}</strong></div>
            <div><span>今日收盘</span><strong id="market-close-${position.id}">${last ? formatPrice(last) : '待更新'}</strong></div>
            <div><span>浮动盈亏</span><strong id="market-profit-${position.id}" class="${floating >= 0 ? 'profit-up' : 'profit-down'}">${formatMoneyByCurrency(floating, stock.currency || 'CNY')}</strong></div>
            <div><span>行情日期</span><strong id="market-date-${position.id}">${stock.price_date || '尚未同步'}</strong></div>
          </div>

          <div class="kline-entry">
            <button id="toggle-chart-${position.id}" class="kline-toggle" onclick="togglePositionChart('${position.id}')">
              <span>查看K线</span><span class="kline-chevron">⌄</span>
            </button>
          </div>

          <div id="kline-panel-${position.id}" class="kline-panel hidden">
            <div class="kline-panel-head">
              <div class="market-range">
                ${[['1mo','1月'],['3mo','3月'],['6mo','6月'],['1y','1年'],['5y','5年']].map(([key, label]) =>
                  `<button data-range="${key}" class="${key === (chartRanges.get(position.id) || '6mo') ? 'active' : ''}" onclick="changeChartRange('${position.id}','${key}')">${label}</button>`
                ).join('')}
              </div>
              <button id="refresh-chart-${position.id}" class="btn soft compact-btn" onclick="refreshPositionChart('${position.id}')">↻ 刷新</button>
            </div>
            <div class="ma-legend">
              <span class="ma5">MA5</span><span class="ma10">MA10</span><span class="ma20">MA20</span><span class="ma30">MA30</span>
              <span class="muted">蓝线：买入成本</span>
            </div>
            <div id="chart-state-${position.id}" class="market-chart-state">只有展开后才会下载K线数据。</div>
            <div id="chart-${position.id}" class="market-chart"></div>
          </div>
        </section>
      `;
    }).join('');
  }

  function renderMultiCurrencySummary() {
    const positionsData = posData();
    const open = positionsData.filter(item => item.open > 0);
    const valueByCurrency = new Map();
    const profitByCurrency = new Map();

    open.forEach(item => {
      const currency = String(item.s.currency || 'CNY').toUpperCase();
      valueByCurrency.set(currency, (valueByCurrency.get(currency) || 0) + Number(item.value || 0));
    });

    positionsData.forEach(item => {
      const currency = String(item.s.currency || 'CNY').toUpperCase();
      profitByCurrency.set(currency, (profitByCurrency.get(currency) || 0) + Number(item.realized || 0));
    });

    const renderGroups = groups => {
      if (!groups.size) return formatMoneyByCurrency(0, 'CNY');
      return [...groups.entries()]
        .map(([currency, value]) => `<span class="currency-metric-line">${formatMoneyByCurrency(value, currency)}</span>`)
        .join('');
    };

    const valueNode = byId('mValue');
    const profitNode = byId('mProfit');
    if (valueNode) valueNode.innerHTML = renderGroups(valueByCurrency);
    if (profitNode) profitNode.innerHTML = renderGroups(profitByCurrency);
  }

  function renderFourDecimalTradeViews() {
    const positionRows = posData();

    const flowsTarget = byId('flowsList');
    if (flowsTarget) {
      flowsTarget.innerHTML = positionRows.length
        ? positionRows.map(position => `
          <div style="padding:18px 0;border-bottom:1px solid var(--line)">
            <strong style="font-size:18px">${esc(position.s.name)} ${esc(position.s.code)}</strong>
            <p style="line-height:1.9">
              <span class="badge buy">买入</span>
              ${position.buy.trade_date || ''} ${position.buy.trade_time || ''} ·
              ${formatPrice(position.buy.price, '')} ${esc(position.s.currency || 'CNY')} × ${position.buy.quantity || ''}股
              <br><span class="muted">原因：${esc(position.buy.reason || '')}</span>
              ${position.sells.map(trade => `
                <br><span class="badge sell">卖出</span>
                ${trade.trade_date} ${trade.trade_time} ·
                ${formatPrice(trade.price, '')} ${esc(position.s.currency || 'CNY')} × ${trade.quantity}股
                <br><span class="muted">原因：${esc(trade.reason)}</span>
              `).join('')}
            </p>
          </div>
        `).join('')
        : '<div class="empty">暂无交易流程</div>';
    }

    const recentTarget = byId('recentTrades');
    if (recentTarget) {
      const recent = trades.slice(0, 6);
      recentTarget.innerHTML = recent.length
        ? recent.map(trade => {
            const stock = stocks.find(item => item.id === trade.stock_id) || {};
            return `
              <div style="padding:12px 0;border-bottom:1px solid var(--line)">
                <span class="badge ${trade.trade_type === 'buy' ? 'buy' : 'sell'}">
                  ${trade.trade_type === 'buy' ? '买入' : '卖出'}
                </span>
                <strong>${esc(stock.name || '')}</strong>
                <span class="muted">
                  · ${trade.trade_date} ${trade.trade_time} ·
                  ${formatPrice(trade.price, '')} ${esc(stock.currency || 'CNY')} × ${trade.quantity}股
                </span>
              </div>
            `;
          }).join('')
        : '<div class="empty">暂无交易</div>';
    }
  }

  function installFourDecimalPriceInputs() {
    ['sLatestPrice', 'sBuyPrice', 'bPrice', 'xPrice', 'tePrice'].forEach(id => {
      const input = byId(id);
      if (input) input.step = '0.0001';
    });
  }

  function movingAverage(bars, period) {
    const result = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i += 1) {
      sum += Number(bars[i].close);
      if (i >= period) sum -= Number(bars[i - period].close);
      if (i >= period - 1) {
        result.push({ time: bars[i].time, value: Number((sum / period).toFixed(4)) });
      }
    }
    return result;
  }

  function destroyChart(positionId) {
    const handle = chartHandles.get(positionId);
    if (!handle) return;
    try { handle.observer?.disconnect(); } catch {}
    try { handle.chart?.remove(); } catch {}
    chartHandles.delete(positionId);
  }

  async function drawChart(positionId, data) {
    const L = await ensureChartLibrary();
    const position = posData().find(x => x.id === positionId && x.open > 0);
    const container = byId(`chart-${positionId}`);
    if (!position || !container) return;

    destroyChart(positionId);
    container.innerHTML = '';

    const chart = L.createChart(container, {
      width: Math.max(container.clientWidth, 320),
      height: container.clientHeight || 380,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#77777d',
        fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        fontSize: 12
      },
      grid: {
        vertLines: { color: 'rgba(29,29,31,.045)' },
        horzLines: { color: 'rgba(29,29,31,.07)' }
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.1 }
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        rightOffset: 3,
        barSpacing: 8,
        minBarSpacing: 3
      },
      crosshair: { mode: L.CrosshairMode.Normal },
      localization: {
        priceFormatter: value => formatPrice(value, '0.0000')
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#16a34a',
      borderUpColor: '#ef4444',
      borderDownColor: '#16a34a',
      wickUpColor: '#ef4444',
      wickDownColor: '#16a34a',
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      priceLineVisible: false,
      lastValueVisible: true
    });
    candles.setData(data.bars.map(bar => ({
      time: bar.time,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close)
    })));

    const maSettings = [
      [5, '#1473e6'],
      [10, '#ff7a1a'],
      [20, '#e244c4'],
      [30, '#66686d']
    ];

    maSettings.forEach(([period, color]) => {
      const series = chart.addLineSeries({
        color,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(movingAverage(data.bars, period));
    });

    const buyPrice = Number(position.buy.price || 0);
    if (buyPrice > 0) {
      candles.createPriceLine({
        price: buyPrice,
        color: '#0071e3',
        lineWidth: 1,
        lineStyle: L.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '成本'
      });
    }

    const markers = trades
      .filter(t => t.position_id === position.id)
      .map(t => ({
        time: t.trade_date,
        position: t.trade_type === 'buy' ? 'belowBar' : 'aboveBar',
        color: t.trade_type === 'buy' ? '#ef4444' : '#16a34a',
        shape: t.trade_type === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${t.trade_type === 'buy' ? '买' : '卖'} ${formatPrice(t.price, '0.0000')}`
      }))
      .filter(marker => data.bars.some(bar => bar.time === marker.time));

    if (markers.length) candles.setMarkers(markers);
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) chart.applyOptions({ width: rect.width });
    });
    observer.observe(container);
    chartHandles.set(positionId, { chart, observer });

    const latest = data.bars.at(-1);
    if (latest) {
      const stock = position.s;
      stock.current_price = latest.close;
      stock.close_price = latest.close;
      stock.open_price = latest.open;
      stock.price_date = latest.time;

      const floating = (Number(latest.close) - buyPrice) * Number(position.open);
      const closeNode = byId(`market-close-${positionId}`);
      const dateNode = byId(`market-date-${positionId}`);
      const profitNode = byId(`market-profit-${positionId}`);

      if (closeNode) closeNode.textContent = formatPrice(latest.close, '0.0000');
      if (dateNode) dateNode.textContent = latest.time;
      if (profitNode) {
        profitNode.textContent = formatMoneyByCurrency(floating, stock.currency || 'CNY');
        profitNode.className = floating >= 0 ? 'profit-up' : 'profit-down';
      }

      const pricePayload = {
        current_price: latest.close,
        close_price: latest.close,
        open_price: latest.open,
        price_date: latest.time,
        source_updated_at: new Date().toISOString()
      };
      const { error } = await sb.from('stocks').update(pricePayload).eq('id', stock.id);
      if (error) console.warn('最新行情未能写回股票库：', error.message);
    }
  }

  async function loadPositionChart(positionId, refresh = false) {
    const position = posData().find(x => x.id === positionId && x.open > 0);
    const state = byId(`chart-state-${positionId}`);
    const container = byId(`chart-${positionId}`);
    if (!position || !state || !container) return;

    const stock = position.s;
    if ((stock.quote_source || 'yahoo') === 'manual') {
      state.textContent = '这只股票选择了“暂不联网”，可在“资料与来源”中切回 Yahoo Finance。';
      container.innerHTML = '<div class="empty">K线联网已关闭</div>';
      return;
    }

    const range = chartRanges.get(positionId) || '6mo';
    const symbol = stock.quote_symbol || defaultQuoteSymbol(stock.code);
    const cacheKey = `${symbol}|${range}|1d`;
    state.textContent = refresh ? '正在刷新市场数据…' : '正在读取K线…';

    try {
      let data = !refresh ? chartCache.get(cacheKey) : null;
      if (!data) {
        data = await marketRequest({
          action: 'chart',
          symbol,
          stock_id: stock.id,
          range,
          interval: '1d',
          refresh: refresh ? '1' : '0'
        });
        if (!Array.isArray(data.bars) || !data.bars.length) throw new Error('没有可用K线');
        chartCache.set(cacheKey, data);
      }

      await drawChart(positionId, data);
      state.textContent = `${data.bars.length} 根日K · MA5 / MA10 / MA20 / MA30 · ${sourceNames[data.source] || data.source || '市场数据'} · ${refresh ? '刚刚刷新' : '已加载'}`;
    } catch (error) {
      state.textContent = `K线加载失败：${error.message}`;
      container.innerHTML = '<div class="empty">暂时无法显示K线，稍后可以再次打开或刷新</div>';
    }
  }

  async function togglePositionChart(positionId) {
    const panel = byId(`kline-panel-${positionId}`);
    const button = byId(`toggle-chart-${positionId}`);
    if (!panel || !button) return;

    const opening = panel.classList.contains('hidden');
    if (!opening) {
      destroyChart(positionId);
      panel.classList.add('hidden');
      button.classList.remove('active');
      button.querySelector('span:first-child').textContent = '查看K线';
      button.querySelector('.kline-chevron').textContent = '⌄';
      return;
    }

    panel.classList.remove('hidden');
    button.classList.add('active');
    button.querySelector('span:first-child').textContent = '收起K线';
    button.querySelector('.kline-chevron').textContent = '⌃';
    await loadPositionChart(positionId, false);
  }

  async function refreshPositionChart(positionId) {
    const button = byId(`refresh-chart-${positionId}`);
    if (button) {
      button.disabled = true;
      button.textContent = '刷新中…';
    }
    try {
      const position = posData().find(x => x.id === positionId);
      if (position) {
        const range = chartRanges.get(positionId) || '6mo';
        chartCache.delete(`${position.s.quote_symbol || defaultQuoteSymbol(position.s.code)}|${range}|1d`);
      }
      await loadPositionChart(positionId, true);
      toast('K线已刷新并保存');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '↻ 刷新';
      }
    }
  }

  async function changeChartRange(positionId, range) {
    chartRanges.set(positionId, range);
    const panel = byId(`kline-panel-${positionId}`);
    panel?.querySelectorAll('[data-range]').forEach(button => {
      button.classList.toggle('active', button.dataset.range === range);
    });
    await loadPositionChart(positionId, false);
  }

  function installEnhancements() {
    ensureMarketStyles();
    installConsolidatedLayout();
    installStockFields();
    installEditModal();
    installFourDecimalPriceInputs();

    const baseResetStockForm = resetStockForm;
    resetStockForm = function () {
      baseResetStockForm();
      resetMarketStockFields();
    };

    const baseOpenBuy = openBuy;
    openBuy = function () {
      if (!stocks.length) {
        showHoldingPanel('stocks');
        toast('请先将新股票加入股票库');
        return;
      }
      baseOpenBuy();
    };

    const baseOpenSell = openSell;
    openSell = function (id) {
      baseOpenSell(id);
      const priceInput = byId('xPrice');
      if (priceInput?.value !== '') priceInput.value = formatPrice(priceInput.value, '');
    };

    const baseOpenTradeEditor = openTradeEditor;
    openTradeEditor = function (id) {
      baseOpenTradeEditor(id);
      const priceInput = byId('tePrice');
      if (priceInput?.value !== '') priceInput.value = formatPrice(priceInput.value, '');
    };

    lookupStockByCode = lookupStockFromSelectedSource;
    saveManualStock = enhancedSaveManualStock;

    const baseRender = render;
    render = function () {
      baseRender();
      renderEnhancedStocks();
      renderEnhancedPositions();
      renderFourDecimalTradeViews();
      renderMultiCurrencySummary();
    };

    const baseShowPage = showPage;
    showPage = function (id) {
      if (id === 'flows' || id === 'stocks') return showHoldingPanel(id);
      if (id === 'learning') return showLearningPanel('lesson');
      if (id === 'positions') return showHoldingPanel('positions');
      if (id === 'notes') return showLearningPanel('notes');
      return baseShowPage(id);
    };

    window.showHoldingPanel = showHoldingPanel;
    window.showLearningPanel = showLearningPanel;
    window.toggleLearningPanel = toggleLearningPanel;
    window.goToStockLibrary = goToStockLibrary;
    window.openStockEditor = openStockEditor;
    window.previewStockSource = previewStockSource;
    window.saveStockEditor = saveStockEditor;
    window.refreshStockInfo = refreshStockInfo;
    window.togglePositionChart = togglePositionChart;
    window.refreshPositionChart = refreshPositionChart;
    window.changeChartRange = changeChartRange;

    if (Array.isArray(stocks) && stocks.length) render();
  }

  installEnhancements();
})();
