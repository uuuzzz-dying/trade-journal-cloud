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
        '<link rel="stylesheet" href="/quant.css?v=1">' +
        '<script defer src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>' +
        "</head>"
    );
  } else if (!cachedHtml.includes('href="/quant.css')) {
    cachedHtml = cachedHtml.replace(
      "</head>",
      '<link rel="stylesheet" href="/quant.css?v=1">' + "</head>"
    );
  }

  if (!cachedHtml.includes('src="/market.js"')) {
    cachedHtml = cachedHtml.replace(
      "</body>",
      '<script src="/market.js"></script><script src="/quant.js?v=1"></script></body>'
    );
  } else if (!cachedHtml.includes('src="/quant.js')) {
    cachedHtml = cachedHtml.replace(
      "</body>",
      '<script src="/quant.js?v=1"></script></body>'
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
