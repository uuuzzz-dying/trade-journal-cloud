function rows(data) {
  const fields = data?.fields || [];
  return (data?.items || []).map(item =>
    Object.fromEntries(fields.map((f, i) => [f, item[i]]))
  );
}
async function tushare(api_name, params, fields) {
  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({api_name, token:process.env.TUSHARE_TOKEN, params, fields})
  });
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "Tushare 查询失败");
  return rows(result.data);
}
export default async function handler(req,res) {
  try {
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({error:"Unauthorized"});
    }
    const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key||!process.env.TUSHARE_TOKEN) throw new Error("缺少环境变量");
    const headers={apikey:key,Authorization:`Bearer ${key}`};
    const pos=await fetch(`${url}/rest/v1/positions?status=eq.open&select=stock_id`,{headers}).then(r=>r.json());
    const ids=[...new Set(pos.map(x=>x.stock_id))];
    if(!ids.length)return res.status(200).json({ok:true,count:0,message:"暂无持仓"});
    const inFilter=`(${ids.join(",")})`;
    const stocks=await fetch(`${url}/rest/v1/stocks?id=in.${encodeURIComponent(inFilter)}&select=id,code`,{headers}).then(r=>r.json());
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
    const codeMap=new Map(stocks.map(s=>[String(s.code).slice(0,6),s]));
    const data=await tushare("daily",{trade_date:today},"ts_code,trade_date,open,close");
    let updated=0;
    for(const q of data){
      const s=codeMap.get(String(q.ts_code).slice(0,6)); if(!s)continue;
      const date=`${q.trade_date.slice(0,4)}-${q.trade_date.slice(4,6)}-${q.trade_date.slice(6,8)}`;
      const r=await fetch(`${url}/rest/v1/stocks?id=eq.${s.id}`,{
        method:"PATCH",headers:{...headers,"Content-Type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify({open_price:q.open,close_price:q.close,current_price:q.close,price_date:date})
      });
      if(r.ok)updated++;
    }
    res.status(200).json({ok:true,count:updated,date:today});
  } catch(e){res.status(400).json({error:e.message});}
}