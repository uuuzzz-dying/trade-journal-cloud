(() => {
  if (window.__tradeJournalQuantV1) return;
  window.__tradeJournalQuantV1 = true;

  const byId = id => document.getElementById(id);
  const state = {
    scanning: false,
    results: [],
    lastRunAt: '',
    selectedFilter: 'all',
    loadedUserId: ''
  };

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  const formatNumber = (value, digits = 2) => Number.isFinite(Number(value))
    ? Number(value).toFixed(digits)
    : '—';

  const average = values => {
    const clean = values.map(Number).filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
  };

  const standardDeviation = values => {
    const clean = values.map(Number).filter(Number.isFinite);
    if (clean.length < 2) return 0;
    const mean = average(clean);
    return Math.sqrt(average(clean.map(value => (value - mean) ** 2)));
  };

  function storageKey() {
    const userId = typeof user !== 'undefined' && user?.id ? user.id : 'anonymous';
    return `quant-signal-v1:${userId}`;
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        results: state.results,
        lastRunAt: state.lastRunAt
      }));
    } catch {}
  }

  function loadState() {
    state.results = [];
    state.lastRunAt = '';
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || '{}');
      if (Array.isArray(saved.results)) state.results = saved.results;
      if (saved.lastRunAt) state.lastRunAt = saved.lastRunAt;
    } catch {}
  }

  function syncUserState() {
    const currentUserId = typeof user !== 'undefined' && user?.id ? user.id : 'anonymous';
    if (state.loadedUserId === currentUserId) return;
    state.loadedUserId = currentUserId;
    loadState();
    renderQuantResults();
  }

  async function getCloudConfig() {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.supabaseUrl || !body.supabaseAnonKey) {
      throw new Error(body.error || '无法读取云端配置');
    }
    return body;
  }

  async function quantMarketRequest(params) {
    if (typeof sb === 'undefined' || !sb) throw new Error('请先登录');
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

  function inferQuoteSymbol(stock) {
    if (stock.quote_symbol) return String(stock.quote_symbol).toUpperCase();
    const code = String(stock.code || '').trim().toUpperCase();
    const market = String(stock.market || '');
    if (market.includes('港')) return `${code.padStart(4, '0')}.HK`;
    if (market.includes('美') || /^[A-Z]/.test(code)) return code;
    if (/^(4|8|92)/.test(code)) return `${code}.BJ`;
    if (/^(5|6|9)/.test(code)) return `${code}.SS`;
    return `${code}.SZ`;
  }

  function calculateRsi(closes, period = 14) {
    if (closes.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let index = closes.length - period; index < closes.length; index += 1) {
      const change = closes[index] - closes[index - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }
    const averageGain = gains / period;
    const averageLoss = losses / period;
    if (averageLoss === 0) return 100;
    const relativeStrength = averageGain / averageLoss;
    return 100 - (100 / (1 + relativeStrength));
  }

  function percentageChange(current, previous) {
    const base = Number(previous);
    return base ? ((Number(current) / base) - 1) * 100 : 0;
  }

  function analyzeBars(stock, rawBars) {
    const bars = rawBars
      .map(bar => ({
        time: bar.time,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume || 0)
      }))
      .filter(bar => bar.time && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    if (bars.length < 35) throw new Error('历史K线少于35个交易日，暂时无法稳定计算');

    const closes = bars.map(bar => bar.close);
    const volumes = bars.map(bar => bar.volume);
    const latest = bars.at(-1);
    const previous = bars.at(-2);
    const ma5 = average(closes.slice(-5));
    const ma10 = average(closes.slice(-10));
    const ma20 = average(closes.slice(-20));
    const ma60 = closes.length >= 60 ? average(closes.slice(-60)) : null;
    const rsi14 = calculateRsi(closes, 14);
    const return5 = percentageChange(latest.close, closes.at(-6));
    const return20 = percentageChange(latest.close, closes.at(-21));
    const dayChange = percentageChange(latest.close, previous.close);
    const high20 = Math.max(...bars.slice(-20).map(bar => bar.high));
    const distanceFromHigh20 = percentageChange(latest.close, high20);
    const averageVolume20 = average(volumes.slice(-21, -1));
    const volumeRatio = latest.volume > 0 && averageVolume20 > 0 ? latest.volume / averageVolume20 : null;
    const trailingCloses = closes.slice(-21);
    const dailyReturns = trailingCloses.slice(1).map((close, index) => percentageChange(close, trailingCloses[index]));
    const volatility20 = standardDeviation(dailyReturns) * Math.sqrt(252);

    let score = 50;
    const reasons = [];
    const risks = [];

    if (latest.close > ma20) {
      score += 12;
      reasons.push('收盘价站在20日均线上方，中期趋势偏强');
    } else {
      score -= 12;
      risks.push('收盘价位于20日均线下方，中期趋势尚弱');
    }

    if (ma5 > ma10 && ma10 > ma20) {
      score += 12;
      reasons.push('MA5、MA10、MA20呈多头排列');
    } else if (ma5 < ma10 && ma10 < ma20) {
      score -= 12;
      risks.push('短中期均线呈空头排列');
    }

    if (ma60 !== null) {
      if (latest.close > ma60) score += 6;
      else score -= 6;
    }

    if (return20 >= 3 && return20 <= 20) {
      score += 8;
      reasons.push(`近20日上涨${formatNumber(return20)}%，动量为正但未极端`);
    } else if (return20 > 20) {
      score += 2;
      risks.push(`近20日已上涨${formatNumber(return20)}%，短期追高风险增加`);
    } else if (return20 <= -8) {
      score -= 8;
      risks.push(`近20日下跌${formatNumber(Math.abs(return20))}%，趋势仍需修复`);
    }

    if (rsi14 !== null) {
      if (rsi14 >= 45 && rsi14 <= 68) {
        score += 7;
        reasons.push(`RSI14为${formatNumber(rsi14, 1)}，处于相对健康区间`);
      } else if (rsi14 > 75) {
        score -= 7;
        risks.push(`RSI14为${formatNumber(rsi14, 1)}，短期可能过热`);
      } else if (rsi14 < 35) {
        score -= 5;
        risks.push(`RSI14为${formatNumber(rsi14, 1)}，弱势超卖不等于马上反弹`);
      }
    }

    if (volumeRatio !== null) {
      if (volumeRatio >= 1.15 && dayChange > 0) {
        score += 7;
        reasons.push(`当日量比${formatNumber(volumeRatio)}，上涨得到成交量确认`);
      } else if (volumeRatio >= 1.5 && dayChange < 0) {
        score -= 8;
        risks.push('放量下跌，卖盘压力需要警惕');
      } else if (volumeRatio < 0.65) {
        score -= 2;
        risks.push('成交量明显低于20日均量，信号确认度较低');
      }
    }

    if (distanceFromHigh20 >= -3) {
      score += 5;
      reasons.push('股价接近20日高点，市场相对强势');
    }

    if (volatility20 > 55) {
      score -= 8;
      risks.push(`年化波动率约${formatNumber(volatility20)}%，价格波动较大`);
    } else if (volatility20 < 30) {
      score += 3;
      reasons.push('近20日波动相对可控');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    let label = '中性观察';
    let level = 'neutral';
    if (score >= 70) {
      label = '强势观察';
      level = 'positive';
    } else if (score < 40) {
      label = '风险观察';
      level = 'risk';
    }

    return {
      stockId: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      industry: stock.custom_sector || stock.industry || '未分类',
      quoteSymbol: inferQuoteSymbol(stock),
      date: latest.time,
      close: latest.close,
      dayChange,
      ma5,
      ma10,
      ma20,
      ma60,
      rsi14,
      return5,
      return20,
      volumeRatio,
      volatility20,
      distanceFromHigh20,
      score,
      label,
      level,
      reasons: reasons.slice(0, 4),
      risks: risks.slice(0, 4),
      generatedAt: new Date().toISOString()
    };
  }

  function installQuantPage() {
    if (byId('quant')) return;
    const navPanel = document.querySelector('.nav-panel');
    const notesNav = document.querySelector('[data-page="notes"]');
    const button = document.createElement('button');
    button.className = 'nav';
    button.dataset.page = 'quant';
    button.textContent = '量化信号';
    button.onclick = () => showQuantPage();
    if (notesNav) navPanel?.insertBefore(button, notesNav);
    else navPanel?.appendChild(button);

    const page = document.createElement('section');
    page.id = 'quant';
    page.className = 'page';
    page.innerHTML = `
      <div class="quant-hero">
        <div>
          <div class="eyebrow">Quant Research · Phase 1</div>
          <h1>量化信号中心</h1>
          <p>使用趋势、动量、成交量和波动率生成可解释的观察信号。第一阶段只做研究与提醒，不连接券商、不自动下单。</p>
        </div>
        <button id="quantRunBtn" class="btn primary" onclick="runQuantScan()">扫描股票库</button>
      </div>

      <div class="quant-disclaimer">信号是统计筛选结果，不是买卖建议。评分只反映当前技术状态，不包含完整基本面、估值和突发新闻。</div>

      <div class="grid g4 quant-metrics">
        <div class="card metric-card"><span class="metric-label">扫描股票</span><div id="quantCount" class="metric">0</div></div>
        <div class="card metric-card"><span class="metric-label">强势观察</span><div id="quantPositiveCount" class="metric">0</div></div>
        <div class="card metric-card"><span class="metric-label">风险观察</span><div id="quantRiskCount" class="metric">0</div></div>
        <div class="card metric-card"><span class="metric-label">最后运行</span><div id="quantLastRun" class="quant-time">尚未运行</div></div>
      </div>

      <div class="card">
        <div class="title">
          <div><h3>信号列表</h3><p class="muted quant-subtitle">点击股票可查看模型打分依据。</p></div>
          <div class="quant-filters">
            <button class="quant-filter active" data-quant-filter="all" onclick="setQuantFilter('all')">全部</button>
            <button class="quant-filter" data-quant-filter="positive" onclick="setQuantFilter('positive')">强势</button>
            <button class="quant-filter" data-quant-filter="neutral" onclick="setQuantFilter('neutral')">中性</button>
            <button class="quant-filter" data-quant-filter="risk" onclick="setQuantFilter('risk')">风险</button>
          </div>
        </div>
        <div id="quantProgress" class="quant-progress hidden"><div id="quantProgressBar"></div></div>
        <div id="quantStatus" class="muted quant-status">点击“扫描股票库”开始分析。</div>
        <div id="quantResults"></div>
      </div>

      <div class="card quant-method-card">
        <div class="title"><h3>模型如何打分</h3><span class="badge">透明规则 V1</span></div>
        <div class="quant-method-grid">
          <div><b>趋势</b><span>收盘价与MA20、MA60，均线多头或空头排列。</span></div>
          <div><b>动量</b><span>近5日、20日涨跌幅，以及RSI14是否过热或过弱。</span></div>
          <div><b>成交量</b><span>最新成交量相对过去20日均量，判断上涨或下跌是否被确认。</span></div>
          <div><b>风险</b><span>近20日波动率、短期涨幅过大和高位放量下跌。</span></div>
        </div>
      </div>
    `;
    document.querySelector('main')?.appendChild(page);
  }

  function showQuantPage() {
    document.querySelectorAll('.page').forEach(node => node.classList.remove('active'));
    document.querySelectorAll('.nav').forEach(node => node.classList.remove('active'));
    byId('quant')?.classList.add('active');
    document.querySelector('[data-page="quant"]')?.classList.add('active');
    renderQuantResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setQuantFilter(filter) {
    state.selectedFilter = ['all', 'positive', 'neutral', 'risk'].includes(filter) ? filter : 'all';
    document.querySelectorAll('[data-quant-filter]').forEach(button => {
      button.classList.toggle('active', button.dataset.quantFilter === state.selectedFilter);
    });
    renderQuantResults();
  }

  function renderQuantSummary() {
    if (!byId('quantCount')) return;
    byId('quantCount').textContent = state.results.length;
    byId('quantPositiveCount').textContent = state.results.filter(item => item.level === 'positive').length;
    byId('quantRiskCount').textContent = state.results.filter(item => item.level === 'risk').length;
    byId('quantLastRun').textContent = state.lastRunAt
      ? new Date(state.lastRunAt).toLocaleString('zh-CN', { hour12: false })
      : '尚未运行';
  }

  function renderQuantResults() {
    renderQuantSummary();
    const target = byId('quantResults');
    if (!target) return;
    const filtered = state.results
      .filter(item => state.selectedFilter === 'all' || item.level === state.selectedFilter)
      .sort((a, b) => b.score - a.score);

    if (!filtered.length) {
      target.innerHTML = `<div class="empty">${state.results.length ? '这个筛选条件下没有股票' : '尚无量化结果，请先扫描股票库'}</div>`;
      return;
    }

    target.innerHTML = filtered.map(item => `
      <details class="quant-result ${item.level}">
        <summary>
          <div class="quant-stock-main">
            <div class="quant-score">${item.score}</div>
            <div>
              <strong>${escHtml(item.name)} ${escHtml(item.code)}</strong>
              <span>${escHtml(item.industry)} · ${escHtml(item.date)}</span>
            </div>
          </div>
          <div class="quant-result-right">
            <span class="quant-signal ${item.level}">${item.label}</span>
            <b>${formatNumber(item.close, 4)}</b>
            <span class="${item.dayChange >= 0 ? 'quant-up' : 'quant-down'}">${item.dayChange >= 0 ? '+' : ''}${formatNumber(item.dayChange)}%</span>
          </div>
        </summary>
        <div class="quant-detail">
          <div class="quant-indicators">
            <div><span>MA5</span><b>${formatNumber(item.ma5, 4)}</b></div>
            <div><span>MA10</span><b>${formatNumber(item.ma10, 4)}</b></div>
            <div><span>MA20</span><b>${formatNumber(item.ma20, 4)}</b></div>
            <div><span>RSI14</span><b>${formatNumber(item.rsi14, 1)}</b></div>
            <div><span>20日涨跌</span><b>${item.return20 >= 0 ? '+' : ''}${formatNumber(item.return20)}%</b></div>
            <div><span>量比</span><b>${item.volumeRatio == null ? '无成交量数据' : formatNumber(item.volumeRatio)}</b></div>
            <div><span>年化波动</span><b>${formatNumber(item.volatility20)}%</b></div>
            <div><span>距20日高点</span><b>${formatNumber(item.distanceFromHigh20)}%</b></div>
          </div>
          <div class="quant-reason-grid">
            <div><h4>模型看到的优势</h4>${item.reasons.length ? `<ul>${item.reasons.map(reason => `<li>${escHtml(reason)}</li>`).join('')}</ul>` : '<p class="muted">暂无明显优势。</p>'}</div>
            <div><h4>需要警惕的风险</h4>${item.risks.length ? `<ul>${item.risks.map(risk => `<li>${escHtml(risk)}</li>`).join('')}</ul>` : '<p class="muted">暂无明显技术风险。</p>'}</div>
          </div>
          <div class="quant-manager-view"><b>基金经理视角：</b>该结果只能作为候选池入口。下一步仍需检查行业、公司主营、基本面、估值、资金面、新闻催化和交易风险，不能只因分数高就买入。</div>
        </div>
      </details>
    `).join('');
  }

  async function runQuantScan() {
    if (state.scanning) return;
    if (typeof stocks === 'undefined' || !Array.isArray(stocks) || !stocks.length) {
      alert('股票库为空，请先添加至少一只股票');
      return;
    }

    state.scanning = true;
    const button = byId('quantRunBtn');
    const status = byId('quantStatus');
    const progress = byId('quantProgress');
    const progressBar = byId('quantProgressBar');
    if (button) {
      button.disabled = true;
      button.textContent = '扫描中…';
    }
    progress?.classList.remove('hidden');
    state.results = [];
    renderQuantResults();

    const failures = [];
    const eligibleStocks = stocks.filter(stock => (stock.quote_source || 'yahoo') !== 'manual');

    for (let index = 0; index < eligibleStocks.length; index += 1) {
      const stock = eligibleStocks[index];
      const progressPercent = Math.round((index / eligibleStocks.length) * 100);
      if (progressBar) progressBar.style.width = `${progressPercent}%`;
      if (status) status.textContent = `正在分析 ${stock.name} ${stock.code}（${index + 1}/${eligibleStocks.length}）`;

      try {
        const data = await quantMarketRequest({
          action: 'chart',
          symbol: inferQuoteSymbol(stock),
          stock_id: stock.id,
          range: '6mo',
          interval: '1d',
          refresh: '0'
        });
        if (!Array.isArray(data.bars) || !data.bars.length) throw new Error('没有可用K线');
        state.results.push(analyzeBars(stock, data.bars));
      } catch (error) {
        failures.push(`${stock.name}: ${error.message}`);
      }

      renderQuantResults();
      await new Promise(resolve => setTimeout(resolve, 160));
    }

    state.lastRunAt = new Date().toISOString();
    saveState();
    renderQuantResults();
    if (progressBar) progressBar.style.width = '100%';
    if (status) {
      status.textContent = failures.length
        ? `扫描完成：成功${state.results.length}只，失败${failures.length}只。失败原因可稍后重试。`
        : `扫描完成：已分析${state.results.length}只股票。`;
    }
    if (typeof toast === 'function') toast('量化扫描完成');

    state.scanning = false;
    if (button) {
      button.disabled = false;
      button.textContent = '重新扫描';
    }
  }

  function installStyles() {
    if (document.querySelector('link[data-quant-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/quant.css?v=1';
    link.dataset.quantStyles = 'true';
    document.head.appendChild(link);
  }

  function initialize() {
    installStyles();
    installQuantPage();
    syncUserState();

    const baseRender = typeof render === 'function' ? render : null;
    if (baseRender && !window.__quantWrappedRender) {
      window.__quantWrappedRender = true;
      render = function () {
        const result = baseRender();
        syncUserState();
        return result;
      };
    }

    const baseShowPage = typeof showPage === 'function' ? showPage : null;
    if (baseShowPage && !window.__quantWrappedShowPage) {
      window.__quantWrappedShowPage = true;
      showPage = function (id) {
        if (id === 'quant') return showQuantPage();
        return baseShowPage(id);
      };
    }
  }

  window.showQuantPage = showQuantPage;
  window.runQuantScan = runQuantScan;
  window.setQuantFilter = setQuantFilter;

  initialize();
})();
