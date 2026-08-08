#!/usr/bin/env node
// AICompany 起動スクリプト: サーバーを立ててブラウザを開く
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.AICOMPANY_PORT || 4680);
const server = spawn("node", [path.join(__dirname, "..", "server.js")], {
  stdio: "inherit",
  env: process.env,
});

setTimeout(() => {
  const url = `http://localhost:${PORT}`;
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(opener[0], opener[1]);
}, 800);

process.on("SIGINT", () => { server.kill("SIGINT"); process.exit(0); });
process.on("SIGTERM", () => { server.kill("SIGTERM"); process.exit(0); });
