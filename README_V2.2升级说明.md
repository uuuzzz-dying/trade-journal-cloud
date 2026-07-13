# V2.2：股票自动匹配与新闻搜索

## 新增功能

- 输入6位股票代码后，自动匹配公司名称、官方行业和市场
- 自定义板块仍由你自己填写
- 股票库增加公司新闻、行业新闻和东方财富搜索框
- 每只股票后面增加“公司”“行业”快捷新闻按钮
- 查询公司资料时不再每次调用 Tushare
- Tushare只用于手动同步全部股票资料

## 一、Supabase 建表

进入 Supabase：

SQL Editor → New query

打开本升级包：

`supabase/stock_master.sql`

复制全部内容并 Run。

## 二、上传 GitHub

覆盖：

- `public/index.html`
- `api/stock.js`

新增：

- `api/sync-stocks.js`
- `supabase/stock_master.sql`

Commit changes 后，Vercel通常会自动部署。

## 三、确认 Vercel 环境变量

需要以下变量，环境选择 `Production and Preview`：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TUSHARE_TOKEN`
- `STOCK_SYNC_SECRET`

`SUPABASE_SERVICE_ROLE_KEY` 和所有 Token 都不能上传到 GitHub。

## 四、Redeploy

如果上传 GitHub 后没有自动部署：

Vercel → Deployments → 最新部署 → Redeploy

## 五、手动同步一次全部股票

在浏览器地址栏打开：

`https://trade-journal-cloud.vercel.app/api/sync-stocks?secret=你的STOCK_SYNC_SECRET`

把最后面的内容替换为你在 Vercel 中设置的真实同步密码。

成功后应显示类似：

```json
{
  "ok": true,
  "count": 5000,
  "message": "已同步……现在输入代码即可自动匹配。"
}
```

不要连续刷新这个地址。同步成功一次就够了。

## 六、测试自动匹配

1. 回到网站
2. 强制刷新：Mac 使用 `Command + Shift + R`
3. 股票库 → 添加股票
4. 输入 `600422`
5. 等待约半秒
6. 应自动出现“昆药集团”、官方行业和市场
7. 你只需要填写自定义板块，例如“创新药”

## 七、新闻搜索

股票库下方选择股票，可搜索：

- 公司新闻：公司、公告、业绩、回购等
- 行业新闻：自定义板块或官方行业、政策、产业链
- 东方财富搜索

新闻搜索会打开新标签页，不会占用 Tushare 调用次数。

## 常见问题

### 显示“请先手动同步一次全部股票”

说明 `stock_master` 是空表，重新执行第五步。

### 同步地址提示未配置变量

检查 Vercel 环境变量名称拼写，并在保存后 Redeploy。

### 输入代码没有反应

先强制刷新网页；再检查最新 Vercel 部署是否为 Ready。

### 自动匹配失败但代码正确

可先手动填写名称，不会阻止保存；同时检查同步接口返回的错误信息。
