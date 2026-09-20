"use strict";

const fs = require("fs");
const path = require("path");
const { cfg } = require("../config");
const { prepare, run } = require("./run");

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TRASH_RE = /\.(part|ytdl|ytdlp|tmp|temp)$/i;

const DECODE_MAP = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function sanitizeString(s) {
  if (!s) return null;
  const id = String(s).split("&")[0];
  if (!ID_RE.test(id)) return null;
  return id;
}

function decodeEntities(s) {
  return String(s).replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, k) => DECODE_MAP["&" + k + ";"]);
}

function sanitizeTitle(title) {
  if (!title) return "";
  return String(title)
    .replace(/["\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

async function getPageTitle(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; YoutuberServer/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    let m =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return "";
    return decodeEntities(m[1]).replace(/\s*-\s*YouTube\s*$/i, "").trim();
  } catch (_) {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function newestFileIn(dir, ext) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith("." + ext))
    .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return matches.length ? path.join(dir, matches[0].name) : null;
}

function buildArgs(template, id) {
  return prepare(template, {
    "[YTDLP]": cfg.ytdlpExe,
    "[FFMPEG]": cfg.ffmpegLocation,
    "[DOWNLOAD_DIR]": cfg.downloadDir,
    "[STRING]": id,
  });
}

// Deletes leftover/trash files in the download dir.
//   keep       -> basename never deleted
//   olderThanMs -> only delete files older than that + always delete .part/.ytdl junk
//   (no opts)    -> delete every file
function cleanupDownloadDir(opts = {}) {
  const { keep, olderThanMs } = opts;
  const now = Date.now();
  let removed = 0;
  for (const entry of fs.readdirSync(cfg.downloadDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (keep && entry.name === keep) continue;
    const full = path.join(cfg.downloadDir, entry.name);
    let should;
    if (olderThanMs !== undefined) {
      should = TRASH_RE.test(entry.name);
      if (!should) {
        try {
          should = now - fs.statSync(full).mtimeMs > olderThanMs;
        } catch (_) {
          should = true;
        }
      }
    } else {
      should = true;
    }
    if (should) {
      try {
        fs.unlinkSync(full);
        removed++;
      } catch (_) {}
    }
  }
  return removed;
}

function moveToMusicDir(file) {
  fs.mkdirSync(cfg.musicDir, { recursive: true });
  const dest = path.join(cfg.musicDir, path.basename(file));
  try {
    fs.renameSync(file, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      fs.copyFileSync(file, dest);
      fs.unlinkSync(file);
    } else {
      throw err;
    }
  }
  return dest;
}

async function downloadMp3(id, cmdTemplate) {
  cleanupDownloadDir({ olderThanMs: 30 * 60 * 1000 });

  let title = sanitizeTitle(await getPageTitle(id));
  if (!title) title = id;

  const args = buildArgs(cmdTemplate || cfg.cmdMp3, id);
  args.push("--output", path.join(cfg.downloadDir, `${title}.%(ext)s`));

  const { stdout, stderr } = await run(args, { cwd: cfg.downloadDir, timeout: cfg.cmdTimeoutMs });

  const file = path.join(cfg.downloadDir, `${title}.${cfg.resultExt}`);
  if (!fs.existsSync(file)) {
    const fallback = newestFileIn(cfg.downloadDir, cfg.resultExt);
    if (fallback) return { file: fallback, title, stdout, stderr };
    const err = new Error(`no .${cfg.resultExt} file produced`);
    err.output = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { file, title, stdout, stderr };
}

async function fetchMp3(id) {
  return downloadMp3(id, cfg.cmdMp3);
}

async function fetchSiteData(id) {
  const { file, title, stdout, stderr } = await downloadMp3(id, cfg.cmdSitemp3 || cfg.cmdMp3);
  const savedPath = moveToMusicDir(file);
  return { title, savedPath, stdout, stderr };
}

module.exports = {
  sanitizeString,
  sanitizeTitle,
  getPageTitle,
  downloadMp3,
  fetchMp3,
  fetchSiteData,
  cleanupDownloadDir,
  moveToMusicDir,
  newestFileIn,
};