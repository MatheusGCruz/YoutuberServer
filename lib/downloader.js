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
  const { stdout, stderr } = await runCommand(cfg.cmdMp3, id);
  const file = newestFileIn(cfg.downloadDir, cfg.resultExt);
  if (!file) {
    const err = new Error(`no .${cfg.resultExt} file produced`);
    err.output = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { file, stdout, stderr };
}

async function fetchSiteData(id) {
  const { stdout } = await runCommand(cfg.cmdSiteMp3, id);
  return stdout;
}

module.exports = { sanitizeString, fetchMp3, fetchSiteData, newestFileIn };