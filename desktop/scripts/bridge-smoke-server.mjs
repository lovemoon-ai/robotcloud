import http from "node:http";
import fs from "node:fs";

const port = Number.parseInt(process.env.ROBOTCLOUD_SMOKE_PORT || "48950", 10);
const resultPath = process.env.ROBOTCLOUD_SMOKE_RESULT || "bridge-smoke-result.json";

const page = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>RobotCloud Bridge Smoke</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; margin: 24px; background: #101418; color: #e9eef4; }
      pre { white-space: pre-wrap; border: 1px solid #36424d; padding: 16px; background: #151b21; }
    </style>
  </head>
  <body>
    <h1>RobotCloud Bridge Smoke</h1>
    <pre id="log">starting...</pre>
    <script>
      const logEl = document.getElementById("log");
      const lines = [];
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function log(message) {
        lines.push(String(message));
        logEl.textContent = lines.join("\n");
      }

      async function waitForBridge() {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          if (window.robotcloudDesktop) return window.robotcloudDesktop;
          await wait(100);
        }
        throw new Error("robotcloudDesktop bridge was not injected");
      }

      async function waitFor(predicate, timeoutMs, label) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await wait(250);
        }
        throw new Error(label + " timed out");
      }

      async function runSo101Info(desktop) {
        let output = "";
        let exitPayload = null;
        const offOutput = desktop.so101.onOutput((event) => {
          output += "[" + event.stream + "] " + event.data;
          log("so101: " + event.data.trim());
        });
        const offExit = desktop.so101.onExit((event) => {
          exitPayload = event;
          log("so101 exit: " + JSON.stringify(event));
        });
        const started = await desktop.so101.run({ action: "info" });
        await waitFor(() => exitPayload, 10 * 60 * 1000, "so101 info");
        offOutput();
        offExit();
        return {
          runId: started.runId,
          code: exitPayload.code,
          containsVersion: /LeRobot version/i.test(output),
          outputTail: output.slice(-4000)
        };
      }

      async function runTerminalInfo(desktop, status) {
        let output = "";
        let exitPayload = null;
        const offOutput = desktop.terminal.onOutput((event) => {
          output += event.data;
          log("terminal: " + event.data.trim());
        });
        const offExit = desktop.terminal.onExit((event) => {
          exitPayload = event;
          log("terminal exit: " + JSON.stringify(event));
        });
        const started = await desktop.terminal.start();
        await wait(500);
        const command = status.platform === "windows" ? "python -m lerobot.scripts.lerobot_info" : "lerobot-info";
        await desktop.terminal.write(started.sessionId, command + "\r\nexit\r\n");
        await waitFor(() => exitPayload, 5 * 60 * 1000, "terminal info");
        offOutput();
        offExit();
        return {
          sessionId: started.sessionId,
          shell: started.shell,
          code: exitPayload.code,
          containsVersion: /LeRobot version/i.test(output),
          outputTail: output.slice(-4000)
        };
      }

      async function postResult(result) {
        await fetch("/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result, null, 2)
        });
      }

      (async () => {
        try {
          log("waiting for bridge");
          const desktop = await waitForBridge();
          log("bridge ready");
          const status = await desktop.status();
          log("status: " + JSON.stringify(status));
          const so101Info = await runSo101Info(desktop);
          const terminalInfo = await runTerminalInfo(desktop, status);
          const ok = Boolean(status.isDesktop && so101Info.containsVersion && terminalInfo.containsVersion);
          const result = { ok, status, so101Info, terminalInfo, finishedAt: new Date().toISOString() };
          log("result: " + JSON.stringify({ ok }, null, 2));
          await postResult(result);
        } catch (error) {
          const result = { ok: false, error: String(error && error.stack ? error.stack : error), finishedAt: new Date().toISOString() };
          log("error: " + result.error);
          await postResult(result);
        }
      })();
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/so101/" || req.url === "/test.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/result") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      fs.writeFileSync(resultPath, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RobotCloud bridge smoke server listening on http://127.0.0.1:${port}`);
  console.log(`Result path: ${resultPath}`);
});
