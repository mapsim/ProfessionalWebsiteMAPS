// Servidor local: páginas estáticas, API e eventos em tempo real (Server-Sent Events).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roster } from "./src/agents.js";
import { demoBrain } from "./src/demo.js";
import { hasCredentials, liveBrain, modelInfo } from "./src/llm.js";
import { SYMBOLS } from "./src/market.js";
import { runSession } from "./src/pipeline.js";
import { loadState, resetState, summarise } from "./src/portfolio.js";

const PORT = Number(process.env.PORT) || 4180;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const DEMO = process.env.DEMO === "1" || !hasCredentials();

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" };

const clients = new Set();
let running = false;

function emit(type, payload) {
  const frame = `data: ${JSON.stringify({ type, payload, at: Date.now() })}\n\n`;
  for (const res of clients) res.write(frame);
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("pedido demasiado grande");
  }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": ligado\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    return json(res, 200, { demo: DEMO, running, symbols: SYMBOLS, agents: roster(), portfolio: summarise(loadState()), ...modelInfo() });
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    if (running) return json(res, 409, { error: "Já há uma sessão a decorrer." });
    let body;
    try {
      body = await readJson(req);
    } catch {
      return json(res, 400, { error: "Pedido inválido." });
    }
    if (!SYMBOLS.includes(body.symbol)) return json(res, 400, { error: "Par desconhecido." });
    running = true;
    runSession({ symbol: body.symbol, brain: DEMO ? demoBrain : liveBrain, emit }).finally(() => (running = false));
    return json(res, 202, { ok: true });
  }

  if (url.pathname === "/api/reset" && req.method === "POST") {
    if (running) return json(res, 409, { error: "Espera que a sessão termine." });
    return json(res, 200, { portfolio: summarise(resetState()) });
  }

  if (req.method !== "GET") return json(res, 405, { error: "Método não suportado." });
  const file = path.join(PUBLIC, path.normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "Proibido." });
  fs.readFile(file, (err, content) => {
    if (err) return json(res, 404, { error: "Não encontrado." });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(content);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Trading firm em http://127.0.0.1:${PORT}`);
  console.log(DEMO ? "Modo DEMONSTRAÇÃO (sem chave de API): respostas geradas por regras, não por LLM." : `Modo REAL: modelo ${modelInfo().model}.`);
});
