function normalizeSymbol(code) {
  const value = String(code || "").trim().toUpperCase();
  if (/^\d{6}$/.test(value)) return value;
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(value)) return value.slice(0, 6);
  throw new Error("请输入6位股票代码，例如 600422");
}

export default async function handler(req, res) {
  try {
    const symbol = normalizeSymbol(req.query.code);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return res.status(500).json({error: "尚未配置 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY"});
    }

    const endpoint =
      `${url}/rest/v1/stock_master` +
      `?symbol=eq.${encodeURIComponent(symbol)}` +
      `&select=ts_code,symbol,name,area,industry,market,list_date&limit=1`;

    const response = await fetch(endpoint, {
      headers: {apikey: key, Authorization: `Bearer ${key}`}
    });

    if (!response.ok) throw new Error(await response.text());

    const rows = await response.json();
    if (!rows[0]) {
      return res.status(404).json({
        error: "股票资料库中没有该代码，请先手动同步一次全部股票"
      });
    }

    res.setHeader("Vercel-CDN-Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
}
