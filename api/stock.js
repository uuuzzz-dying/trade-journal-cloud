function normalizeCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(c)) return c;
  if (!/^\d{6}$/.test(c)) throw new Error("股票代码必须是6位数字");
  if (/^(5|6|9)/.test(c)) return `${c}.SH`;
  if (/^(0|1|2|3)/.test(c)) return `${c}.SZ`;
  if (/^(4|8)/.test(c)) return `${c}.BJ`;
  throw new Error("暂时无法判断交易所，请输入如 600422.SH");
}
async function tushare(api_name, params, fields) {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("服务器尚未配置 TUSHARE_TOKEN");
  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ api_name, token, params, fields })
  });
  if (!response.ok) throw new Error(`Tushare网络错误：${response.status}`);
  const data = await response.json();
  if (data.code !== 0) throw new Error(data.msg || "Tushare查询失败");
  return data.data || {fields:[],items:[]};
}
function firstRow(data) {
  if (!data.items?.[0]) return null;
  return Object.fromEntries(data.fields.map((f,i)=>[f,data.items[0][i]]));
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control","s-maxage=3600, stale-while-revalidate");
  try {
    const ts_code = normalizeCode(req.query.code);
    const basic = firstRow(await tushare(
      "stock_basic",
      {ts_code, list_status:"L"},
      "ts_code,symbol,name,area,industry,market,list_date"
    ));
    if (!basic) return res.status(404).json({error:"没有找到该股票，请检查代码或Tushare权限"});
    let quote = null;
    try {
      quote = firstRow(await tushare("daily",{ts_code},"ts_code,trade_date,close"));
    } catch (_) {}
    res.status(200).json({
      ...basic,
      close: quote?.close ?? null,
      trade_date: quote?.trade_date ?? null
    });
  } catch (e) {
    res.status(400).json({error:e.message});
  }
}