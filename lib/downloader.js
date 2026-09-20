"use strict";

const fs = require("fs");
const path = require("path");
const { cfg } = require("../config");
const { prepare, run } = require("./run");

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function sanitizeString(s) {
  if (!s || !ID_RE.test(s)) return null;
  return s;
}

function buildArgs(template, id) {
  return prepare(template, {
    "[YTDLP]": cfg.ytdlpExe,
    "[FFMPEG]": cfg.ffmpegLocation,
    "[DOWNLOAD_DIR]": cfg.downloadDir,
    "[STRING]": id,
  });
}

const DECODE_MAP = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

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

async function runCommand(template, id) {
  if (!template) throw new Error("command template not configured (see .env)");
  const args = buildArgs(template, id);
  return run(args, { cwd: cfg.downloadDir, timeout: cfg.cmdTimeoutMs });
}

async function fetchMp3(id) {
  let title = sanitizeTitle(await getPageTitle(id));
  if (!title) title = id;

  const args = buildArgs(cfg.cmdMp3, id);
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

async function fetchSiteData(id) {
  const { stdout } = await runCommand(cfg.cmdSiteMp3, id);
  return stdout;
}

module.exports = {
  sanitizeString,
  sanitizeTitle,
  getPageTitle,
  fetchMp3,
  fetchSiteData,
  newestFileIn,
};