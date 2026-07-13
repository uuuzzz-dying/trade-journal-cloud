# 我的交易成长日志｜云同步正式版 V1

## 你现在已经做过的事情

如果你已经在 Supabase 执行过旧版 `schema.sql`，通常不需要再次新建项目。

为了确认数据库完整，建议在 Supabase 的 SQL Editor 再运行一次本项目里的：

`supabase/schema.sql`

它使用 `if not exists`，重复运行不会重复创建表。

---

# 上传 GitHub

不要上传 ZIP 文件本身。

1. 解压 ZIP。
2. 打开解压后的 `我的交易成长日志_云同步正式版V1` 文件夹。
3. 在 GitHub 空仓库页面点击 `uploading an existing file`。
4. 把文件夹里面的所有内容拖到 GitHub 页面。
5. 应该直接看到：
   - `api`
   - `public`
   - `supabase`
   - `.env.example`
   - `.gitignore`
   - `package.json`
   - `vercel.json`
   - `README_下一步操作.md`
6. 点击底部绿色 `Commit changes`。

---

# 连接 Vercel

1. 登录 Vercel。
2. 点击 `Add New` → `Project`。
3. 导入 GitHub 仓库 `trade-journal-cloud`。
4. Framework Preset 选择 `Other`。
5. Build Command 留空。
6. Output Directory 填 `public`。

在 Vercel 项目的 `Settings` → `Environment Variables` 添加：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TUSHARE_TOKEN`

注意：

- 不要把密钥上传到 GitHub。
- 不要把密钥发给别人。
- `SUPABASE_ANON_KEY` 填 Publishable key 或 anon/public key。
- 不要填 service_role / secret key。
- 添加环境变量后必须重新部署。

---

# Supabase 设置

进入 Supabase：

`Authentication` → `Providers` → `Email`

确认 Email 登录已开启。

如果开启 Confirm email，注册后必须点击验证邮件才能登录。

---

# 测试

部署成功后：

1. 打开 Vercel 网址。
2. 注册一个邮箱账号。
3. 验证邮箱。
4. 登录。
5. 添加股票 `600422`。
6. 自定义板块填 `创新药`。
7. 点击联网查询。
8. 添加一条心得。
9. 手机和电脑登录同一账号检查同步。

---

# 常见错误

## 页面显示“尚未配置 Supabase 环境变量”

说明 Vercel 环境变量没有填好，或填好后没有 Redeploy。

## 股票查询提示 TUSHARE_TOKEN 未配置

检查变量名称必须完全是：

`TUSHARE_TOKEN`

## 股票查询提示权限不足

这是 Tushare 账号积分或接口权限问题。你仍然可以手动填写价格，但基础资料查询也可能受到账号权限限制。

## 注册后登录失败

先检查邮箱验证邮件。

## 数据库报 permission denied 或 row-level security

重新运行 `supabase/schema.sql`，确认四张表已经启用策略。
