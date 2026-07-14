export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    deprecated: true,
    message:
      "已取消 Tushare stock_basic 全量同步。现在输入6位股票代码时，系统会直接联网匹配并自动缓存，不再受该接口每日次数限制。"
  });
}
