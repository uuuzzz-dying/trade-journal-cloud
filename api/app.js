import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
let cachedHtml = "";

function buildHtml() {
  if (cachedHtml) return cachedHtml;
  const source = readFileSync(indexPath, "utf8");
  cachedHtml = source
    .replace(
      "</head>",
      '<link rel="stylesheet" href="/market.css"><script defer src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script></head>'
    )
    .replace("</body>", '<script src="/market.js"></script></body>');
  return cachedHtml;
}

export default function handler(req, res) {
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.status(200).send(buildHtml());
  } catch (error) {
    return res.status(500).send(`页面加载失败：${error?.message || "unknown error"}`);
  }
}
