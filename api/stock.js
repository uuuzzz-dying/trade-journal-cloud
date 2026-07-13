function normalizeSymbol(code) {
  const value = String(code || "").trim().toUpperCase();
  if (/^\d{6}$/.test(value)) return value;
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(value)) return value.slice(0, 6);
  throw new Error("请输入6位股票代码，例如 600422");
}

export default async function handler(req, res) {
  try {
    const symbol = normalizeSymbol(req.query.code);
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return res.status(500).json({error: "Supabase 环境变量未配置"});
    }

    const endpoint =
      `${supabaseUrl}/rest/v1/stock_master` +
      `?symbol=eq.${encodeURIComponent(symbol)}` +
      `&select=ts_code,symbol,name,area,industry,market,list_date&limit=1`;

    const response = await fetch(endpoint, {
      headers: {apikey: anonKey, Authorization: `Bearer ${anonKey}`}
    });

    if (!response.ok) throw new Error(await response.text());

    const items = await response.json();
    const stock = items[0];
    if (!stock) {
      return res.status(404).json({error: "数据库中没有找到该股票。请先执行一次股票资料同步。"});
    }

    res.setHeader("Vercel-CDN-Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({...stock, close: null});
  } catch (error) {
    res.status(400).json({error: error.message});
  }
}
