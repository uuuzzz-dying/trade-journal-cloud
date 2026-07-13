export const config = { maxDuration: 60 };

function rows(data) {
  const fields = data?.fields || [];
  return (data?.items || []).map(item =>
    Object.fromEntries(fields.map((field, index) => [field, item[index]]))
  );
}

async function fetchAllStocks() {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN");

  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      api_name: "stock_basic",
      token,
      params: {list_status: "L"},
      fields: "ts_code,symbol,name,area,industry,market,list_date"
    })
  });

  if (!response.ok) throw new Error(`Tushare 网络错误：${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "Tushare 查询失败");
  return rows(result.data);
}

async function upsert(url, key, records) {
  const chunkSize = 1000;
  for (let i = 0; i < records.length; i += chunkSize) {
    const response = await fetch(
      `${url}/rest/v1/stock_master?on_conflict=ts_code`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(records.slice(i, i + chunkSize))
      }
    );
    if (!response.ok) throw new Error(`写入 Supabase 失败：${await response.text()}`);
  }
}

export default async function handler(req, res) {
  try {
    const secret = process.env.STOCK_SYNC_SECRET;
    if (!secret) return res.status(500).json({error: "未配置 STOCK_SYNC_SECRET"});
    if (req.query.secret !== secret) return res.status(401).json({error: "同步密码错误"});

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return res.status(500).json({error: "未配置 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY"});
    }

    const data = await fetchAllStocks();
    const records = data.map(s => ({
      ts_code: s.ts_code,
      symbol: s.symbol,
      name: s.name,
      area: s.area || "",
      industry: s.industry || "",
      market: s.market || "",
      list_date: s.list_date
        ? `${s.list_date.slice(0,4)}-${s.list_date.slice(4,6)}-${s.list_date.slice(6,8)}`
        : null,
      updated_at: new Date().toISOString()
    }));

    await upsert(url, key, records);
    return res.status(200).json({
      ok: true,
      count: records.length,
      message: `已同步 ${records.length} 只正常上市股票。现在输入代码即可自动匹配。`
    });
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
}
