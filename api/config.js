export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "服务器尚未配置 SUPABASE_URL 或 SUPABASE_ANON_KEY" });
  }
  res.status(200).json({ supabaseUrl, supabaseAnonKey });
}