require("dotenv").config();

const express = require("express");
const path = require("path");
const marketData = require("./api/market-data");

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
  });
});

app.get("/api/market-data", marketData);
app.use(express.static(publicDir, { etag: true, maxAge: "5m" }));

app.use((req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

if (require.main === module) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`Trade Journal running at http://127.0.0.1:${port}`);
  });
}

module.exports = app;
