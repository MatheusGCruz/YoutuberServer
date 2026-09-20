"use strict";

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) {
    /* .env is optional */
  }
}

loadEnv(path.join(__dirname, ".env"));

const state = {
  ytdlpExe: process.env.YTDLP_EXE || "yt-dlp.exe",
  ffmpegLocation: process.env.FFMPEG_LOCATION || "E:\\ffmpeg\\bin",
  downloadDir: path.resolve(process.env.DOWNLOAD_DIR || "./downloads"),
};

const cfg = {
  get port() {
    return parseInt(process.env.PORT || "3030", 10);
  },
  get host() {
    return process.env.HOST || "0.0.0.0";
  },
  get cmdMp3() {
    return process.env.CMD_MP3 || "";
  },
  get cmdSiteMp3() {
    return process.env.CMD_SITEMP3 || "";
  },
  get resultExt() {
    return (process.env.RESULT_EXT || "mp3").replace(/^\./, "");
  },
  get cmdTimeoutMs() {
    return parseInt(process.env.CMD_TIMEOUT_MS || "0", 10);
  },
  get siteTitle() {
    return process.env.SITE_TITLE || "YoutuberServer";
  },

  get ytdlpExe() {
    return state.ytdlpExe;
  },
  get ffmpegLocation() {
    return state.ffmpegLocation;
  },
  get downloadDir() {
    return state.downloadDir;
  },
};

function setYtdlpExe(p) {
  state.ytdlpExe = p;
  return state.ytdlpExe;
}

function setFfmpegLocation(p) {
  state.ffmpegLocation = p;
  return state.ffmpegLocation;
}

function setDownloadDir(p) {
  state.downloadDir = path.resolve(p);
  fs.mkdirSync(state.downloadDir, { recursive: true });
  return state.downloadDir;
}

module.exports = { cfg, setYtdlpExe, setFfmpegLocation, setDownloadDir };