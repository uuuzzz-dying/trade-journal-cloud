const REQUEST_TIMEOUT_MS = 10000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 90;
const rateLimits = new Map();

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
  const current = rateLimits.get(key);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= RATE_LIMIT_MAX;
}

function requireSession(req) {
  const authorization = String(req.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ") || authorization.length < 32) {
    throw Object.assign(new Error("登录状态已过期，请重新登录"), { statusCode: 401 });
  }
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 TradeJournal/2.2",
        Referer: url.includes("eastmoney.com")
          ? "https://quote.eastmoney.com/"
          : "https://finance.yahoo.com/"
      },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`${label}返回 ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label}连接超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMarket(value) {
  return ["a", "hk", "us"].includes(value) ? value : "a";
}

function normalizeCode(value, market) {
  const raw = String(value || "").trim().toUpperCase();

  if (market === "a") {
    const code = raw.replace(/\.(SH|SS|SZ|BJ)$/i, "");
    if (!/^\d{6}$/.test(code)) throw new Error("A股请输入6位数字代码");
    return code;
  }

  if (market === "hk") {
    const code = raw.replace(/\.HK$/i, "");
    if (!/^\d{1,5}$/.test(code)) throw new Error("港股请输入1至5位数字代码");
    return code.length <= 4 ? code.padStart(4, "0") : code;
  }

  const code = raw.replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(code)) throw new Error("美股代码格式不正确");
  return code;
}

function aShareExchange(code) {
  if (/^(4|8|92)/.test(code)) return { marketId: 0, exchange: "北京证券交易所", suffix: "BJ" };
  if (/^(5|6|9)/.test(code)) return { marketId: 1, exchange: "上海证券交易所", suffix: "SS" };
  return { marketId: 0, exchange: "深圳证券交易所", suffix: "SZ" };
}

function aShareMarket(code) {
  if (/^(688|689)/.test(code)) return "科创板";
  if (/^(300|301)/.test(code)) return "创业板";
  if (/^(4|8|92)/.test(code)) return "北交所";
  if (/^6/.test(code)) return "上海主板";
  return "深圳主板";
}

async function lookupAStock(code) {
  const exchange = aShareExchange(code);
  const fields = "f43,f57,f58,f127";
  const url = "https://push2.eastmoney.com/api/qt/stock/get" +
    `?fltt=2&invt=2&secid=${exchange.marketId}.${encodeURIComponent(code)}` +
    `&fields=${encodeURIComponent(fields)}`;
  const body = await fetchJson(url, "东方财富");
  const data = body?.data;

  if (!data?.f58 || data.f58 === "-") throw new Error("没有找到这只A股");

  return {
    code: data.f57 || code,
    name: data.f58,
    industry: data.f127 && data.f127 !== "-" ? data.f127 : "",
    market: aShareMarket(code),
    exchange: exchange.exchange,
    currency: "CNY",
    quote_symbol: `${code}.${exchange.suffix}`,
    latest_price: data.f43 !== null && data.f43 !== undefined && data.f43 !== "-"
      ? Number(data.f43)
      : null,
    source: "eastmoney"
  };
}

function yahooSymbol(code, market) {
  return market === "hk" ? `${code}.HK` : code;
}

async function fetchYahooChart(symbol, range = "6mo", interval = "1d") {
  const safeRange = ["1mo", "3mo", "6mo", "1y", "2y", "5y"].includes(range) ? range : "6mo";
  const safeInterval = interval === "1d" ? interval : "1d";
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
    `${encodeURIComponent(symbol)}?range=${safeRange}&interval=${safeInterval}` +
    "&events=div%2Csplits&includeAdjustedClose=true";
  const body = await fetchJson(url, "Yahoo Finance");
  const result = body?.chart?.result?.[0];

  if (!result) throw new Error(body?.chart?.error?.description || "Yahoo Finance没有返回行情");

  const quote = result.indicators?.quote?.[0] || {};
  const bars = (result.timestamp || []).map((timestamp, index) => {
    const open = Number(quote.open?.[index]);
    const high = Number(quote.high?.[index]);
    const low = Number(quote.low?.[index]);
    const close = Number(quote.close?.[index]);
    const volume = Number(quote.volume?.[index] || 0);
    if (![open, high, low, close].every(Number.isFinite)) return null;
    return {
      time: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0
    };
  }).filter(Boolean);

  if (!bars.length) throw new Error("Yahoo Finance没有可用K线");

  return {
    symbol,
    exchange: result.meta?.exchangeName || result.meta?.fullExchangeName || "",
    currency: result.meta?.currency || "",
    source: "yahoo",
    latest_price: Number(result.meta?.regularMarketPrice ?? bars.at(-1)?.close),
    bars
  };
}

async function lookupYahooStock(code, market) {
  const symbol = yahooSymbol(code, market);
  const searchUrl = "https://query1.finance.yahoo.com/v1/finance/search" +
    `?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
  const body = await fetchJson(searchUrl, "Yahoo Finance");
  const quotes = Array.isArray(body?.quotes) ? body.quotes : [];
  const exact = quotes.find(item => String(item.symbol || "").toUpperCase() === symbol.toUpperCase());
  const quote = exact || quotes.find(item => item.quoteType === "EQUITY");
  if (!quote) throw new Error("Yahoo Finance没有找到这只股票");

  let chart = null;
  try {
    chart = await fetchYahooChart(quote.symbol || symbol, "1mo", "1d");
  } catch {
    // 公司资料仍可保存；最新价格可以稍后通过K线刷新。
  }

  return {
    code,
    name: quote.longname || quote.shortname || quote.symbol || code,
    industry: quote.industry || quote.sector || "",
    market: market === "hk" ? "港股" : "美股",
    exchange: quote.exchDisp || quote.exchange || chart?.exchange || "",
    currency: chart?.currency || (market === "hk" ? "HKD" : "USD"),
    quote_symbol: quote.symbol || symbol,
    latest_price: Number.isFinite(chart?.latest_price) ? chart.latest_price : null,
    source: "yahoo"
  };
}

function eastmoneyLimit(range) {
  return ({ "1mo": 35, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1600 })[range] || 180;
}

function aShareFromSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  const match = symbol.match(/^(\d{6})(?:\.(SS|SH|SZ|BJ))?$/);
  if (!match) return null;
  const code = match[1];
  const suffix = match[2] === "SH" ? "SS" : match[2];
  return { code, ...aShareExchange(code), suffix: suffix || aShareExchange(code).suffix };
}

async function fetchEastmoneyChart(symbol, range) {
  const stock = aShareFromSymbol(symbol);
  if (!stock) throw new Error("A股K线代码格式不正确");
  const marketId = stock.suffix === "SS" ? 1 : 0;
  const url = "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
    `?secid=${marketId}.${encodeURIComponent(stock.code)}` +
    `&klt=101&fqt=1&lmt=${eastmoneyLimit(range)}&end=20500101` +
    "&fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6%2Cf7%2Cf8" +
    "&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61";
  const body = await fetchJson(url, "东方财富K线");
  const lines = body?.data?.klines;
  if (!Array.isArray(lines) || !lines.length) throw new Error("东方财富没有可用K线");

  const bars = lines.map(line => {
    const fields = String(line).split(",");
    const [time, open, close, high, low, volume] = fields;
    const values = [open, high, low, close].map(Number);
    if (!time || !values.every(Number.isFinite)) return null;
    return {
      time,
      open: values[0],
      high: values[1],
      low: values[2],
      close: values[3],
      volume: Number(volume || 0)
    };
  }).filter(Boolean);

  return {
    symbol: `${stock.code}.${stock.suffix}`,
    exchange: stock.exchange,
    currency: "CNY",
    source: "eastmoney",
    bars
  };
}

async function handleLookup(query) {
  const market = normalizeMarket(query.market);
  const code = normalizeCode(query.code, market);
  return market === "a" ? lookupAStock(code) : lookupYahooStock(code, market);
}

async function handleChart(query) {
  const symbol = String(query.symbol || "").trim().toUpperCase();
  if (!symbol) throw new Error("缺少K线代码");
  const range = String(query.range || "6mo");
  const aShare = aShareFromSymbol(symbol);

  if (aShare) {
    try {
      return await fetchEastmoneyChart(symbol, range);
    } catch (eastmoneyError) {
      try {
        return await fetchYahooChart(symbol, range, "1d");
      } catch {
        throw eastmoneyError;
      }
    }
  }

  return fetchYahooChart(symbol, range, "1d");
}

module.exports = async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") return sendJson(res, 405, { error: "只支持GET请求" });
    requireSession(req);
    if (!checkRateLimit(req)) return sendJson(res, 429, { error: "请求过于频繁，请稍后再试" });

    const action = String(req.query?.action || "");
    if (action === "lookup") return sendJson(res, 200, await handleLookup(req.query));
    if (action === "chart") return sendJson(res, 200, await handleChart(req.query));
    return sendJson(res, 400, { error: "不支持的行情操作" });
  } catch (error) {
    const status = Number(error?.statusCode || 502);
    return sendJson(res, status, { error: error?.message || "行情服务暂时不可用" });
  }
};

module.exports._test = {
  aShareExchange,
  aShareFromSymbol,
  normalizeCode,
  normalizeMarket
};
