function normalizeSymbol(code) {
  const value = String(code || "").trim().toUpperCase();
  if (/^\d{6}$/.test(value)) return value;
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(value)) return value.slice(0, 6);
  throw new Error("请输入6位股票代码，例如 600422");
}

function marketCandidates(symbol) {
  // 东方财富 secid：上海通常为 1，深圳/北京通常为 0。
  // 先按代码规则猜测；失败时自动尝试另一个市场，避免新代码段误判。
  const likelyShanghai = /^(5|6|9(?!2))/.test(symbol);
  return likelyShanghai ? [1, 0] : [0, 1];
}

function marketName(symbol) {
  if (/^(688|689)/.test(symbol)) return "科创板";
  if (/^(300|301)/.test(symbol)) return "创业板";
  if (/^(4|8|92)/.test(symbol)) return "北交所";
  if (/^6/.test(symbol)) return "上海主板";
  if (/^(0|1|2|3)/.test(symbol)) return "深圳主板";
  return "A股";
}

function tsCode(symbol) {
  if (/^(4|8|92)/.test(symbol)) return `${symbol}.BJ`;
  if (/^(5|6|9)/.test(symbol)) return `${symbol}.SH`;
  return `${symbol}.SZ`;
}

function normalizeListDate(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 1_000_000_000) {
    const date = new Date(number * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

async function fetchEastmoney(symbol) {
  const fields = "f43,f57,f58,f127,f189";
  let lastError = null;

  for (const market of marketCandidates(symbol)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url =
        "https://push2.eastmoney.com/api/qt/stock/get" +
        `?fltt=2&invt=2&secid=${market}.${encodeURIComponent(symbol)}` +
        `&fields=${encodeURIComponent(fields)}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json,text/plain,*/*",
          "Referer": "https://quote.eastmoney.com/"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        lastError = new Error(`行情资料源返回 ${response.status}`);
        continue;
      }

      const result = await response.json();
      const data = result?.data;
      if (!data || !data.f58 || data.f58 === "-") {
        lastError = new Error("该市场没有找到股票");
        continue;
      }

      return {
        ts_code: tsCode(symbol),
        symbol: data.f57 || symbol,
        name: data.f58,
        area: "",
        industry: data.f127 && data.f127 !== "-" ? data.f127 : "",
        market: marketName(symbol),
        list_date: normalizeListDate(data.f189),
        latest_price:
          data.f43 !== null && data.f43 !== undefined && data.f43 !== "-"
            ? Number(data.f43)
            : null,
        source: "eastmoney"
      };
    } catch (error) {
      lastError =
        error?.name === "AbortError"
          ? new Error("公司资料查询超时")
          : error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("没有找到该股票");
}

async function readCache(url, key, symbol) {
  if (!url || !key) return null;
  const endpoint =
    `${url}/rest/v1/stock_master` +
    `?symbol=eq.${encodeURIComponent(symbol)}` +
    `&select=ts_code,symbol,name,area,industry,market,list_date,updated_at` +
    `&limit=1`;

  const response = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function writeCache(url, key, stock) {
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/stock_master?on_conflict=ts_code`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        ts_code: stock.ts_code,
        symbol: stock.symbol,
        name: stock.name,
        area: stock.area || "",
        industry: stock.industry || "",
        market: stock.market || "",
        list_date: stock.list_date || null,
        updated_at: new Date().toISOString()
      })
    });
  } catch {
    // 缓存失败不应阻止用户添加股票。
  }
}

function cacheIsFresh(row) {
  if (!row?.updated_at) return false;
  const age = Date.now() - new Date(row.updated_at).getTime();
  return Number.isFinite(age) && age < 30 * 24 * 60 * 60 * 1000;
}

export default async function handler(req, res) {
  try {
    const symbol = normalizeSymbol(req.query.code);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 优先读取30天内缓存，减少外部请求；没有缓存时直接查公开股票资料源。
    const cached = await readCache(url, key, symbol);
    if (cacheIsFresh(cached)) {
      res.setHeader(
        "Vercel-CDN-Cache-Control",
        "s-maxage=86400, stale-while-revalidate=604800"
      );
      return res.status(200).json({ ...cached, source: "cache" });
    }

    const stock = await fetchEastmoney(symbol);
    await writeCache(url, key, stock);

    res.setHeader(
      "Vercel-CDN-Cache-Control",
      "s-maxage=86400, stale-while-revalidate=604800"
    );
    return res.status(200).json(stock);
  } catch (error) {
    return res.status(400).json({
      error:
        error?.message ||
        "自动匹配失败。你仍然可以手动填写公司名称和行业。"
    });
  }
}
