(() => {
  const byId = id => document.getElementById(id);
  const chartHandles = new Map();
  const chartRanges = new Map();
  let cloudConfig = null;
  let marketLookupTimer = null;
  let lastLookup = null;

  const sourceNames = {
    auto: '自动组合',
    eastmoney: '东方财富',
    yahoo: 'Yahoo Finance',
    manual: '手动维护'
  };

  function sourceBadge(source) {
    const value = source || 'manual';
    return `<span class="market-source ${esc(value)}">${esc(sourceNames[value] || value)}</span>`;
  }

  function defaultQuoteSymbol(code) {
    const c = String(code || '').slice(0, 6);
    if (/^(4|8|92)/.test(c)) return `${c}.BJ`;
    if (/^(5|6|9)/.test(c)) return `${c}.SS`;
    return `${c}.SZ`;
  }

  async function getCloudConfig() {
    if (cloudConfig) return cloudConfig;
    const response = await fetch('/api/config', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body.supabaseUrl || !body.supabaseAnonKey) {
      throw new Error(body.error || '无法读取云端配置');
    }
    cloudConfig = body;
    return body;
  }

  async function marketRequest(params) {
    const config = await getCloudConfig();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error('登录状态已过期，请重新登录');
    const query = new URLSearchParams(params);
    const response = await fetch(`${config.supabaseUrl}/functions/v1/market-data?${query}`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`
      },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `行情服务返回 ${response.status}`);
    return body;
  }

  function installStockFields() {
    const status = byId('stockLookupStatus');
    if (!status || byId('sInfoSource')) return;
    status.insertAdjacentHTML('beforebegin', `
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
        <div><label>最新价格</label><input id="sLatestPrice" type="number" step="0.001" placeholder="可留空"></div>
      </div>
    `);

    const oldCode = byId('sCode');
    const newCode = oldCode.cloneNode(true);
    oldCode.replaceWith(newCode);
    newCode.addEventListener('input', scheduleMarketLookup);
    newCode.addEventListener('blur', lookupStockFromSelectedSource);
    byId('sInfoSource').addEventListener('change', () => {
      const manual = byId('sInfoSource').value === 'manual';
      if (manual) {
        byId('stockLookupStatus').classList.remove('hidden');
        byId('stockLookupStatus').textContent = '已选择手动维护：名称、行业、市场和行情代码都可以自己修改。';
      } else {
        scheduleMarketLookup();
      }
    });
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
        <div class="market-warning">资料来源只决定“自动填写时从哪里取数”。保存前你仍然可以修改任何字段；手动修改不会被自动覆盖，除非再次点击“重新获取”。</div>
        <div class="actions" style="margin-top:18px"><button id="saveStockEditBtn" class="btn primary" onclick="saveStockEditor()">保存修改</button><button class="btn soft" onclick="closeM('stockEditModal')">取消</button></div>
      </div></div>
    `);
  }

  function resetMarketStockFields() {
    if (!byId('sInfoSource')) return;
    byId('sInfoSource').value = 'auto';
    byId('sQuoteSource').value = 'yahoo';
    byId('sQuoteSymbol').value = '';
    byId('sExchange').value = '';
    byId('sCurrency').value = 'CNY';
    byId('sLatestPrice').value = '';
    lastLookup = null;
  }

  function scheduleMarketLookup() {
    clearTimeout(marketLookupTimer);
    marketLookupTimer = setTimeout(lookupStockFromSelectedSource, 450);
  }

  async function lookupStockFromSelectedSource() {
    const raw = byId('sCode')?.value.trim().toUpperCase() || '';
    const code = raw.replace(/\.(SH|SZ|BJ|SS)$/i, '');
    const box = byId('stockLookupStatus');
    if (!/^\d{6}$/.test(code)) {
      box?.classList.add('hidden');
      return;
    }
    const source = byId('sInfoSource')?.value || 'auto';
    byId('sQuoteSymbol').value ||= defaultQuoteSymbol(code);
    if (source === 'manual') {
      box.classList.remove('hidden');
      box.textContent = '手动模式：请自己填写名称、行业、市场和行情代码。';
      return;
    }
    box.classList.remove('hidden');
    box.textContent = `正在从${sourceNames[source]}获取资料…`;
    try {
      const result = await marketRequest({ action: 'lookup', code, source });
      lastLookup = result;
      byId('sCode').value = code;
      byId('sName').value = result.name || byId('sName').value;
      byId('sIndustry').value = result.industry || byId('sIndustry').value;
      if (result.market) byId('sMarket').value = result.market;
      byId('sQuoteSymbol').value = result.quote_symbol || defaultQuoteSymbol(code);
      byId('sExchange').value = result.exchange || '';
      byId('sCurrency').value = result.currency || 'CNY';
      byId('sLatestPrice').value = result.latest_price ?? '';
      box.innerHTML = `已获取：<strong>${esc(result.name || code)}</strong> · ${esc(result.industry || '行业可手动填写')} · ${esc(sourceNames[result.source] || result.source)}`;
    } catch (error) {
      box.textContent = `自动获取失败：${error.message}。你仍然可以切换来源或手动填写。`;
    }
  }

  async function enhancedSaveManualStock() {
    const code = String(byId('sCode').value || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ|SS)$/i, '');
    const name = byId('sName').value.trim();
    const infoSource = byId('sInfoSource').value;
    const quoteSource = byId('sQuoteSource').value;
    if (!/^\d{6}$/.test(code)) return alert('请输入6位股票代码');
    if (!name) return alert('请填写股票名称');
    if (stocks.some(s => String(s.code) === code)) return alert('股票库中已经有这只股票');

    let firstBuy = null;
    if (byId('firstBuyToggle').checked) {
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
      market: byId('sMarket').value,
      info_source: infoSource,
      quote_source: quoteSource,
      quote_symbol: byId('sQuoteSymbol').value.trim().toUpperCase() || defaultQuoteSymbol(code),
      exchange: byId('sExchange').value.trim(),
      currency: byId('sCurrency').value.trim().toUpperCase() || 'CNY',
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
        <td>${esc(s.name)}<div class="muted" style="margin-top:4px">${esc(s.market || '')} ${esc(s.exchange || '')}</div></td>
        <td>${esc(s.industry || '—')}<div class="muted" style="margin-top:4px">${esc(s.custom_sector || '未设置自定义板块')}</div></td>
        <td>${sourceBadge(s.info_source || 'manual')}</td>
        <td>${esc(s.quote_symbol || defaultQuoteSymbol(s.code))}<div class="muted">${esc(s.quote_source || 'yahoo')}</div></td>
        <td>${Number(s.current_price || 0) ? `${esc(s.currency || 'CNY')} ${Number(s.current_price).toFixed(2)}` : '待更新'}<div class="muted">${esc(s.price_date || '')}</div></td>
        <td><div class="stock-actions"><button class="btn soft" style="padding:8px 12px;font-size:13px" onclick="refreshStockInfo('${s.id}')">更新资料</button><button class="btn soft" style="padding:8px 12px;font-size:13px" onclick="openStockEditor('${s.id}')">修改</button><button class="btn soft" style="padding:8px 12px;font-size:13px" onclick="quickNews('${s.id}','company')">新闻</button></div></td>
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
    byId('seQuoteSymbol').value = stock.quote_symbol || defaultQuoteSymbol(stock.code);
    byId('sePreview').classList.add('hidden');
    openM('stockEditModal');
  }

  async function previewStockSource() {
    const source = byId('seInfoSource').value;
    const preview = byId('sePreview');
    if (source === 'manual') {
      preview.className = 'source-preview';
      preview.textContent = '手动来源不会联网；请直接修改下方字段并保存。';
      return;
    }
    preview.className = 'source-preview';
    preview.textContent = `正在从${sourceNames[source]}获取…`;
    try {
      const result = await marketRequest({ action: 'lookup', code: byId('seCode').value, source });
      byId('seName').value = result.name || byId('seName').value;
      byId('seIndustry').value = result.industry || byId('seIndustry').value;
      if (result.market) byId('seMarket').value = result.market;
      byId('seExchange').value = result.exchange || '';
      byId('seCurrency').value = result.currency || 'CNY';
      byId('seQuoteSymbol').value = result.quote_symbol || defaultQuoteSymbol(byId('seCode').value);
      preview.innerHTML = `已获取 <strong>${esc(result.name || '')}</strong>；你可以继续手动修改再保存。`;
    } catch (error) {
      preview.className = 'source-preview error';
      preview.textContent = error.message;
    }
  }

  async function saveStockEditor() {
    const id = byId('seId').value;
    const payload = {
      name: byId('seName').value.trim(),
      custom_sector: byId('seSector').value.trim(),
      industry: byId('seIndustry').value.trim(),
      market: byId('seMarket').value,
      exchange: byId('seExchange').value.trim(),
      currency: byId('seCurrency').value.trim().toUpperCase() || 'CNY',
      info_source: byId('seInfoSource').value,
      quote_source: byId('seQuoteSource').value,
      quote_symbol: byId('seQuoteSymbol').value.trim().toUpperCase() || defaultQuoteSymbol(byId('seCode').value),
      source_updated_at: byId('seInfoSource').value === 'manual' ? null : new Date().toISOString()
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
      const result = await marketRequest({ action: 'lookup', code: stock.code, source: stock.info_source || 'auto' });
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
    target.innerHTML = open.map(p => {
      const stock = p.s;
      const range = chartRanges.get(stock.id) || '1y';
      const last = Number(stock.close_price || stock.current_price || p.buy.price || 0);
      const floating = (last - Number(p.buy.price || 0)) * p.open;
      return `<section class="market-position" data-stock-id="${stock.id}">
        <div class="title">
          <div>
            <div class="market-price-line"><strong style="font-size:20px">${esc(stock.name)} ${esc(stock.code)}</strong>${sourceBadge(stock.info_source || 'manual')}</div>
            <div class="muted" style="margin-top:6px">${esc(stock.custom_sector || stock.industry || '未分类')} · K线：${esc(stock.quote_symbol || defaultQuoteSymbol(stock.code))}</div>
          </div>
          <div class="actions"><button class="btn soft" onclick="openStockEditor('${stock.id}')">资料与来源</button><button class="btn soft" onclick="openPositionEditor('${p.id}')">修正持仓</button><button class="btn primary" onclick="openSell('${p.id}')">卖出</button></div>
        </div>
        <div class="market-subgrid">
          <div><span>持仓数量</span><strong>${p.open} 股</strong></div>
          <div><span>买入成本</span><strong>${Number(p.buy.price || 0).toFixed(2)}</strong></div>
          <div><span>最新收盘</span><strong id="market-close-${stock.id}">${last ? last.toFixed(2) : '待更新'}</strong></div>
          <div><span>浮动盈亏</span><strong id="market-profit-${stock.id}" style="color:${floating >= 0 ? 'var(--red)' : 'var(--green)'}">${money(floating)}</strong></div>
          <div><span>行情日期</span><strong id="market-date-${stock.id}">${stock.price_date || '尚未同步'}</strong></div>
        </div>
        <div class="market-toolbar">
          <div class="market-range">${[['1mo','1月'],['3mo','3月'],['1y','1年'],['5y','5年']].map(([key,label]) => `<button class="${range === key ? 'active' : ''}" onclick="changeChartRange('${stock.id}','${key}')">${label}</button>`).join('')}</div>
          <button id="refresh-chart-${stock.id}" class="btn soft" onclick="refreshPositionChart('${stock.id}')">↻ 刷新K线</button>
        </div>
        <div id="chart-state-${stock.id}" class="market-chart-state">打开持仓页后读取缓存行情；点击刷新会向 Yahoo Finance 获取最新K线。</div>
        <div id="chart-${stock.id}" class="market-chart"></div>
      </section>`;
    }).join('');
  }

  function waitForCharts() {
    if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.LightweightCharts) {
          clearInterval(timer);
          resolve(window.LightweightCharts);
        } else if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('K线组件加载失败，请刷新页面重试'));
        }
      }, 80);
    });
  }

  function destroyChart(stockId) {
    const handle = chartHandles.get(stockId);
    if (!handle) return;
    try { handle.observer?.disconnect(); } catch {}
    try { handle.chart?.remove(); } catch {}
    chartHandles.delete(stockId);
  }

  async function loadPositionChart(stockId, refresh = false) {
    const stock = stocks.find(x => x.id === stockId);
    const position = posData().find(x => x.stock_id === stockId && x.open > 0);
    const container = byId(`chart-${stockId}`);
    const state = byId(`chart-state-${stockId}`);
    if (!stock || !position || !container) return;
    if ((stock.quote_source || 'yahoo') === 'manual') {
      state.textContent = '这只股票选择了“暂不联网”，可在“资料与来源”中切回 Yahoo Finance。';
      container.innerHTML = '<div class="empty">K线联网已关闭</div>';
      return;
    }
    state.textContent = refresh ? '正在从 Yahoo Finance 刷新并去重保存…' : '正在读取K线缓存…';
    try {
      const range = chartRanges.get(stockId) || '1y';
      const data = await marketRequest({
        action: 'chart',
        symbol: stock.quote_symbol || defaultQuoteSymbol(stock.code),
        stock_id: stock.id,
        range,
        interval: '1d',
        refresh: refresh ? '1' : '0'
      });
      if (!Array.isArray(data.bars) || !data.bars.length) throw new Error('没有可用K线');
      await waitForCharts();
      destroyChart(stockId);
      container.innerHTML = '';
      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#ffffff' }, textColor: '#6e6e73', fontFamily: '-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif' },
        grid: { vertLines: { color: 'rgba(29,29,31,.055)' }, horzLines: { color: 'rgba(29,29,31,.055)' } },
        rightPriceScale: { borderColor: 'rgba(29,29,31,.1)', scaleMargins: { top: .08, bottom: .23 } },
        timeScale: { borderColor: 'rgba(29,29,31,.1)', timeVisible: false, rightOffset: 4 },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
      });
      const candles = chart.addCandlestickSeries({
        upColor: '#d70015', downColor: '#168443', borderUpColor: '#d70015', borderDownColor: '#168443', wickUpColor: '#d70015', wickDownColor: '#168443'
      });
      candles.setData(data.bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
      volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
      volume.setData(data.bars.map(b => ({ time: b.time, value: Number(b.volume || 0), color: b.close >= b.open ? 'rgba(215,0,21,.45)' : 'rgba(22,132,67,.45)' })));
      const buyPrice = Number(position.buy.price || 0);
      if (buyPrice > 0) candles.createPriceLine({ price: buyPrice, color: '#0071e3', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '买入成本' });
      const markers = trades.filter(t => t.position_id === position.id).map(t => ({
        time: t.trade_date,
        position: t.trade_type === 'buy' ? 'belowBar' : 'aboveBar',
        color: t.trade_type === 'buy' ? '#d70015' : '#168443',
        shape: t.trade_type === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${t.trade_type === 'buy' ? '买' : '卖'} ${Number(t.price).toFixed(2)}`
      })).filter(m => data.bars.some(b => b.time === m.time));
      if (markers.length) candles.setMarkers(markers);
      chart.timeScale().fitContent();
      const observer = new ResizeObserver(entries => {
        const rect = entries[0]?.contentRect;
        if (rect?.width) chart.applyOptions({ width: rect.width });
      });
      observer.observe(container);
      chartHandles.set(stockId, { chart, observer });

      const latest = data.bars[data.bars.length - 1];
      stock.current_price = latest.close;
      stock.close_price = latest.close;
      stock.open_price = latest.open;
      stock.price_date = latest.time;
      const floating = (Number(latest.close) - buyPrice) * Number(position.open);
      const closeNode = byId(`market-close-${stockId}`);
      const dateNode = byId(`market-date-${stockId}`);
      const profitNode = byId(`market-profit-${stockId}`);
      if (closeNode) closeNode.textContent = Number(latest.close).toFixed(2);
      if (dateNode) dateNode.textContent = latest.time;
      if (profitNode) {
        profitNode.textContent = money(floating);
        profitNode.style.color = floating >= 0 ? 'var(--red)' : 'var(--green)';
      }
      state.textContent = `${data.bars.length} 根日K · ${data.source === 'yahoo' ? 'Yahoo Finance' : data.source} · ${refresh ? '刚刚刷新并保存' : '读取本地缓存'}`;
    } catch (error) {
      state.textContent = `K线加载失败：${error.message}`;
      container.innerHTML = '<div class="empty">暂时无法显示K线，稍后可再次刷新</div>';
    }
  }

  async function loadAllPositionCharts() {
    const openStockIds = [...new Set(posData().filter(x => x.open > 0).map(x => x.stock_id))];
    for (const id of openStockIds) await loadPositionChart(id, false);
  }

  async function refreshPositionChart(stockId) {
    const button = byId(`refresh-chart-${stockId}`);
    if (button) { button.disabled = true; button.textContent = '刷新中…'; }
    try {
      await loadPositionChart(stockId, true);
      toast('K线已刷新并去重保存');
    } finally {
      if (button) { button.disabled = false; button.textContent = '↻ 刷新K线'; }
    }
  }

  async function changeChartRange(stockId, range) {
    chartRanges.set(stockId, range);
    renderEnhancedPositions();
    await loadAllPositionCharts();
  }

  function installEnhancements() {
    installStockFields();
    installEditModal();

    const baseResetStockForm = resetStockForm;
    resetStockForm = function () {
      baseResetStockForm();
      resetMarketStockFields();
    };
    lookupStockByCode = lookupStockFromSelectedSource;
    saveManualStock = enhancedSaveManualStock;

    const baseRender = render;
    render = function () {
      baseRender();
      renderEnhancedStocks();
      renderEnhancedPositions();
      if (byId('positions')?.classList.contains('active')) setTimeout(loadAllPositionCharts, 0);
    };

    const baseShowPage = showPage;
    showPage = function (id) {
      baseShowPage(id);
      if (id === 'positions') setTimeout(loadAllPositionCharts, 0);
    };

    window.openStockEditor = openStockEditor;
    window.previewStockSource = previewStockSource;
    window.saveStockEditor = saveStockEditor;
    window.refreshStockInfo = refreshStockInfo;
    window.refreshPositionChart = refreshPositionChart;
    window.changeChartRange = changeChartRange;

    if (Array.isArray(stocks) && stocks.length) render();
  }

  installEnhancements();
})();
