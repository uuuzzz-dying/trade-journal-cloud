const fs = require("node:fs");

const indexPath = require.resolve("../public/index.html");
let cachedHtml = "";

function buildHtml() {
  if (cachedHtml) return cachedHtml;

  const source = fs.readFileSync(indexPath, "utf8");

  if (!source.includes("</head>") || !source.includes("</body>")) {
    throw new Error("public/index.html 结构不完整");
  }

  cachedHtml = source;

  if (!cachedHtml.includes('href="/market.css"')) {
    cachedHtml = cachedHtml.replace(
      "</head>",
      '<link rel="stylesheet" href="/market.css">' +
        '<script defer src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>' +
        "</head>"
    );
  }

  if (!cachedHtml.includes('src="/market.js"')) {
    cachedHtml = cachedHtml.replace(
      "</body>",
      '<script src="/market.js"></script></body>'
    );
  }

  return cachedHtml;
}

module.exports = function handler(req, res) {
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.status(200).send(buildHtml());
  } catch (error) {
    console.error("Failed to build app page:", error);
    return res
      .status(500)
      .send(`页面加载失败：${error && error.message ? error.message : "unknown error"}`);
  }
};
