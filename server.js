"use strict";

const http = require("http");
const fs = require("fs");
const { cfg, setYtdlpExe, setFfmpegLocation, setDownloadDir } = require("./config");
const { sanitizeString, fetchMp3, fetchSiteData } = require("./lib/downloader");

fs.mkdirSync(cfg.downloadDir, { recursive: true });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function renderSite(id, title) {
  const escId = escapeHtml(id);
  const escTitle = escapeHtml(title || id);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escId} - ${escapeHtml(cfg.siteTitle)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; overflow-wrap: anywhere; }
    audio { width: 100%; margin: 1rem 0; }
    a { color: #0366d6; }
    pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; font-size: .8rem; }
  </style>
</head>
<body>
  <h1>${escTitle}</h1>
  <audio controls preload="none" src="/mp3/${escId}"></audio>
  <p><a href="/mp3/${escId}">Download .mp3</a></p>
</body>
</html>
`;
}

function handleEndpoint(req, res, kind, id) {
  if (kind === "mp3") {
    fetchMp3(id)
      .then(async ({ file }) => {
        const stat = await fs.promises.stat(file);
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="${id}.mp3"`,
          "Cache-Control": "no-store",
        });
        const stream = fs.createReadStream(file);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      })
      .catch((err) => {
        const detail = String(err.stderr || err.output || err.message || "").slice(0, 2000);
        sendJson(res, 500, { error: "command failed", detail });
      });
    return;
  }

  if (kind === "sitemp3") {
    fetchSiteData(id)
      .then((title) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderSite(id, title.trim()));
      })
      .catch((err) => {
        sendJson(res, 500, { error: "command failed", detail: String(err.message || "").slice(0, 2000) });
      });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "method not allowed" });
  }

  if (parts.length === 0) {
    return sendText(
      res,
      200,
      "YoutuberServer\n" +
        "  GET /mp3/[id]     -> runs CMD_MP3, streams the produced .mp3\n" +
        "  GET /sitemp3/[id] -> runs CMD_SITEMP3, returns an HTML page with an audio player\n"
    );
  }

  if (parts.length !== 2) {
    return sendJson(res, 404, { error: "expected /mp3/[id] or /sitemp3/[id]" });
  }

  const [kind, rawId] = parts;
  if (kind !== "mp3" && kind !== "sitemp3") {
    return sendJson(res, 404, { error: "unknown endpoint" });
  }

  const id = sanitizeString(rawId);
  if (!id) {
    return sendJson(res, 400, { error: "invalid string (allowed: letters, digits, . _ -)" });
  }

  handleEndpoint(req, res, kind, id);
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`YoutuberServer listening on http://${cfg.host}:${cfg.port}`);
  console.log(`  mp3:     http://localhost:${cfg.port}/mp3/[string]`);
  console.log(`  sitemp3: http://localhost:${cfg.port}/sitemp3/[string]`);
  console.log(`  download dir: ${cfg.downloadDir}`);
  console.log(`  yt-dlp: ${cfg.ytdlpExe} | ffmpeg: ${cfg.ffmpegLocation}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

module.exports = {
  cfg,
  server,
  setYtdlpExe,
  setFfmpegLocation,
  setDownloadDir,
  esc: escapeHtml,
};