"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { cfg, setYtdlpExe, setFfmpegLocation, setDownloadDir, setMusicDir } = require("./config");
const { sanitizeString, downloadMp3, fetchSiteData, cleanupDownloadDir } = require("./lib/downloader");

fs.mkdirSync(cfg.downloadDir, { recursive: true });
fs.mkdirSync(cfg.musicDir, { recursive: true });
cleanupDownloadDir({ olderThanMs: 60 * 60 * 1000 });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asciiSafe(s, fallback) {
  return String(s).replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, 150) || fallback;
}

function contentDisposition(name, ext) {
  const full = `${name}.${ext}`;
  return `attachment; filename="${asciiSafe(full, `download.${ext}`)}"; filename*=UTF-8''${encodeURIComponent(full)}`;
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
    p.saved { color: #57606a; font-size: .85rem; }
    pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; font-size: .8rem; }
  </style>
</head>
<body>
  <h1>${escTitle}</h1>
  <p class="saved">Saved to ${escapeHtml(cfg.musicDir)}</p>
  <audio controls preload="none" src="/mp3/${escId}"></audio>
  <p><a href="/mp3/${escId}">Download .mp3</a></p>
</body>
</html>
`;
}

function afterResponse(res, fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {
      fn();
    } catch (_) {}
  };
  res.on("finish", run);
  res.on("close", run);
}

function handleEndpoint(req, res, kind, id) {
  if (kind === "mp3") {
    downloadMp3(id, cfg.cmdMp3)
      .then(async ({ file, title }) => {
        const stat = await fs.promises.stat(file);
        const basename = path.basename(file);
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": stat.size,
          "Content-Disposition": contentDisposition(title, cfg.resultExt),
          "Cache-Control": "no-store",
        });
        afterResponse(res, () => {
          cleanupDownloadDir({ keep: basename });
          cleanupDownloadDir();
          console.log(`mp3 point - ${title}`);
        });
        const stream = fs.createReadStream(file);
        stream.on("error", (err) => {
          console.error(`[mp3] stream error for "${id}" (${file}):`, err);
          res.destroy();
        });
        stream.pipe(res);
      })
      .catch((err) => {
        cleanupDownloadDir();
        console.error(`[mp3] error for "${id}":`, err);
        console.error(`[mp3] stderr:`, String(err.stderr || ""));
        console.error(`[mp3] stdout:`, String(err.stdout || ""));
        const detail = String(err.stderr || err.output || err.message || "").slice(0, 2000);
        sendJson(res, 500, { error: "command failed", detail });
      });
    return;
  }

  if (kind === "sitemp3") {
    fetchSiteData(id)
      .then(({ title }) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderSite(id, title));
        afterResponse(res, () => {
          cleanupDownloadDir();
          console.log(`sitemp3 - ${title}`);
        });
      })
      .catch((err) => {
        cleanupDownloadDir();
        console.error(`[sitemp3] error for "${id}":`, err);
        console.error(`[sitemp3] stderr:`, String(err.stderr || ""));
        console.error(`[sitemp3] stdout:`, String(err.stdout || ""));
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
        "  GET /mp3/[id]     -> runs the cmd, streams the .mp3, then deletes it + leftover trash\n" +
        "  GET /sitemp3/[id] -> runs the cmd, moves the .mp3 to MUSIC_DIR, returns an HTML page\n"
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
  console.log(`  music dir:    ${cfg.musicDir}`);
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
  setMusicDir,
  esc: escapeHtml,
};