"use strict";

const { execFile } = require("child_process");

function tokenize(cmd) {
  const tokens = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === " " && !inQuote) {
      if (current.length) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length) tokens.push(current);
  return tokens;
}

function prepare(cmdTemplate, vars) {
  const replacements = new Map();
  let str = cmdTemplate;
  Object.entries(vars).forEach(([key, value], i) => {
    const sentinel = `\u0000TOK${i}\u0000`;
    replacements.set(sentinel, String(value));
    str = str.split(key).join(sentinel);
  });
  return tokenize(str).map((tok) => {
    let out = tok;
    for (const [sentinel, value] of replacements) {
      out = out.split(sentinel).join(value);
    }
    return out;
  });
}

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const [bin, ...rest] = args;
    if (!bin) {
      reject(new Error("empty command"));
      return;
    }
    execFile(
      bin,
      rest,
      {
        cwd: opts.cwd,
        timeout: opts.timeout || 0,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

module.exports = { tokenize, prepare, run };