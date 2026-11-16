// Escritório 2D: desenha os bonecos e anima os eventos que chegam do servidor.

const W = 960;
const H = 560;
const CORRIDOR_Y = 272;

const ROOMS = {
  research: { x: 16, y: 16, w: 412, h: 214, label: "Research", floor: "#1d2735", top: true },
  strategy: { x: 440, y: 16, w: 256, h: 214, label: "Estratégia", floor: "#241f33", top: true },
  direction: { x: 708, y: 16, w: 236, h: 214, label: "Direção", floor: "#1c2b2c", top: true },
  meeting: { x: 16, y: 314, w: 412, h: 230, label: "Sala de reuniões", floor: "#2a2620" },
  trading: { x: 440, y: 314, w: 256, h: 230, label: "Trading", floor: "#2d2319" },
  risk: { x: 708, y: 314, w: 236, h: 230, label: "Risco", floor: "#2b2a1a" },
};
const DOOR = 46;
const doorOf = (room) => ({ x: room.x + room.w / 2, y: room.top ? room.y + room.h : room.y });

const SHIRT = { research: "#4f9cf9", strategy: "#9b7bf0", direction: "#2fc4b2", trading: "#f28c3a", risk: "#e6c84a" };
const SHIRT_BY_ID = { bull: "#46c98b", bear: "#f0706a" };
const SKINS = ["#f2c9a0", "#e0a877", "#c68655", "#8f5a3a"];
const HAIRS = ["#2b1d14", "#5a3b22", "#b9772e", "#d9c27a", "#3a3f4a", "#7b2f2a"];

const $ = (id) => document.getElementById(id);
const canvas = $("office");
const ctx = canvas.getContext("2d");
const agents = new Map();
let speed = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));
const fmt = (x, d = 2) => Number(x).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Posições ----------

function deskSpot(agent) {
  const room = ROOMS[agent.room];
  const n = [...agents.values()].filter((a) => a.room === agent.room).length;
  return { x: room.x + (room.w * (agent.seat + 0.5)) / n, y: room.y + 138 };
}

function meetingSpot(i) {
  const r = ROOMS.meeting;
  const col = i % 3;
  const below = i >= 3;
  return { x: r.x + r.w / 2 + (col - 1) * 96, y: r.y + (below ? 204 : 84) };
}

function route(agent, target, targetRoom) {
  if (agent.at === targetRoom) return [target];
  const a = doorOf(ROOMS[agent.at]);
  const b = doorOf(ROOMS[targetRoom]);
  return [
    { x: a.x, y: a.y },
    { x: a.x, y: CORRIDOR_Y },
    { x: b.x, y: CORRIDOR_Y },
    { x: b.x, y: b.y },
    target,
  ];
}

function walk(agent, target, targetRoom) {
  agent.path = route(agent, target, targetRoom);
  agent.at = targetRoom;
  return new Promise((resolve) => (agent.arrived = resolve));
}

// ---------- Desenho ----------

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawRoom(room) {
  ctx.fillStyle = room.floor;
  ctx.fillRect(room.x, room.y, room.w, room.h);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let x = room.x; x < room.x + room.w; x += 32)
    for (let y = room.y; y < room.y + room.h; y += 32)
      if (((x - room.x) / 32 + (y - room.y) / 32) % 2 === 0) ctx.fillRect(x, y, Math.min(32, room.x + room.w - x), Math.min(32, room.y + room.h - y));

  ctx.strokeStyle = "#465066";
  ctx.lineWidth = 4;
  const d = doorOf(room);
  const yDoor = d.y;
  const yFar = room.top ? room.y : room.y + room.h;
  ctx.beginPath();
  ctx.moveTo(d.x - DOOR / 2, yDoor);
  ctx.lineTo(room.x, yDoor);
  ctx.lineTo(room.x, yFar);
  ctx.lineTo(room.x + room.w, yFar);
  ctx.lineTo(room.x + room.w, yDoor);
  ctx.lineTo(d.x + DOOR / 2, yDoor);
  ctx.stroke();

  ctx.fillStyle = "rgba(232,236,243,0.55)";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(room.label.toUpperCase(), room.x + 10, room.y + 20);
}

function drawDesk(agent) {
  const x = agent.desk.x;
  const y = agent.desk.y - 10;
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(x - 34, y - 62, 68, 26);
  ctx.fillStyle = "#553a25";
  ctx.fillRect(x - 34, y - 38, 68, 4);
  // monitor
  ctx.fillStyle = "#11151c";
  ctx.fillRect(x - 14, y - 76, 28, 18);
  ctx.fillStyle = agent.working ? "#7fd4ff" : "#2e4a63";
  ctx.fillRect(x - 12, y - 74, 24, 14);
  ctx.fillStyle = "#11151c";
  ctx.fillRect(x - 3, y - 58, 6, 4);
  // placa com a função
  ctx.fillStyle = "rgba(232,236,243,0.7)";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(agent.short, x, y - 84);
}

function drawMeetingTable() {
  const r = ROOMS.meeting;
  const cx = r.x + r.w / 2;
  const cy = r.y + 128;
  ctx.fillStyle = "#553a25";
  ctx.fillRect(cx - 150, cy - 22, 300, 50);
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(cx - 150, cy - 26, 300, 46);
}

function drawAgent(agent, t) {
  const u = 4;
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const step = agent.walking ? Math.floor(t / 130) % 2 : -1;
  const bob = agent.walking ? step : 0;

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // pernas
  ctx.fillStyle = "#2a3040";
  ctx.fillRect(x - 2 * u, y - 4 * u + (step === 0 ? -u : 0), 2 * u - 1, 4 * u);
  ctx.fillRect(x + 1, y - 4 * u + (step === 1 ? -u : 0), 2 * u - 1, 4 * u);
  // tronco e braços
  ctx.fillStyle = agent.shirt;
  ctx.fillRect(x - 3 * u, y - 9 * u - bob, 6 * u, 5 * u);
  ctx.fillRect(x - 4 * u, y - 9 * u - bob + (step === 1 ? u : 0), u, 4 * u);
  ctx.fillRect(x + 3 * u, y - 9 * u - bob + (step === 0 ? u : 0), u, 4 * u);
  // cabeça
  ctx.fillStyle = agent.skin;
  ctx.fillRect(x - 2 * u, y - 13 * u - bob, 4 * u, 4 * u);
  ctx.fillStyle = agent.hair;
  ctx.fillRect(x - 2 * u, y - 14 * u - bob, 4 * u, 2 * u);
  if (agent.longHair) ctx.fillRect(x - 3 * u, y - 13 * u - bob, u, 4 * u), ctx.fillRect(x + 2 * u, y - 13 * u - bob, u, 4 * u);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x - u, y - 11 * u - bob, 2, 2);
  ctx.fillRect(x + u - 2, y - 11 * u - bob, 2, 2);

  ctx.fillStyle = "#e8ecf3";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(agent.name, x, y + 17);
}

function wrap(text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawBubble(agent, text, thinking) {
  ctx.font = "12px system-ui, sans-serif";
  const lines = thinking ? [text] : wrap(text, 190);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 15 + 10;
  const bx = Math.min(Math.max(agent.x - w / 2, 6), W - w - 6);
  const by = Math.max(agent.y - 66 - h, 6);
  ctx.fillStyle = thinking ? "rgba(232,236,243,0.85)" : "#ffffff";
  ctx.strokeStyle = "#11151c";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 7);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(agent.x - 5, by + h - 1);
  ctx.lineTo(agent.x, by + h + 6);
  ctx.lineTo(agent.x + 5, by + h - 1);
  ctx.fillStyle = thinking ? "rgba(232,236,243,0.85)" : "#ffffff";
  ctx.fill();
  ctx.fillStyle = "#11151c";
  ctx.textAlign = "left";
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 18 + i * 15));
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 100) / 1000;
  last = now;

  for (const a of agents.values()) {
    a.walking = a.path.length > 0;
    let budget = 150 * speed * dt;
    while (a.path.length && budget > 0) {
      const p = a.path[0];
      const dist = Math.hypot(p.x - a.x, p.y - a.y);
      if (dist <= budget) {
        a.x = p.x;
        a.y = p.y;
        budget -= dist;
        a.path.shift();
      } else {
        a.x += ((p.x - a.x) / dist) * budget;
        a.y += ((p.y - a.y) / dist) * budget;
        budget = 0;
      }
    }
    if (!a.path.length && a.arrived) {
      a.arrived();
      a.arrived = null;
    }
  }

  ctx.fillStyle = "#151920";
  ctx.fillRect(0, 0, W, H);
  Object.values(ROOMS).forEach(drawRoom);
  drawMeetingTable();
  const sorted = [...agents.values()].sort((a, b) => a.y - b.y);
  sorted.forEach(drawDesk);
  sorted.forEach((a) => drawAgent(a, now));
  for (const a of sorted) {
    if (a.bubble) drawBubble(a, a.bubble, false);
    else if (a.working && !a.walking) drawBubble(a, ".".repeat(1 + (Math.floor(now / 350) % 3)).padEnd(3, " "), true);
  }
  requestAnimationFrame(frame);
}

// ---------- Painel lateral ----------

const LABELS = {
  summary: "Resumo", key_points: "Pontos", thesis: "Tese", points: "Argumentos", rationale: "Justificação", concerns: "Riscos",
  stance: "Posição", confidence: "Confiança", action: "Ação", size_pct: "Tamanho (%)", stop_loss_pct: "Stop (%)",
  take_profit_pct: "Objetivo (%)", verdict: "Parecer", max_size_pct: "Tamanho máx. (%)", aviso: "Aviso", preco: "Preço",
  price: "Preço", qty: "Quantidade", value: "Valor (USDT)", fee: "Comissão (USDT)", note: "Nota", realisedPnl: "Resultado realizado (USDT)",
  aplicado: "Aplicado", symbol: "Par",
};
const HIDDEN = new Set(["speech", "at"]);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderBody(body) {
  const box = document.createDocumentFragment();
  for (const [key, value] of Object.entries(body)) {
    if (HIDDEN.has(key) || value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
    const label = LABELS[key] ?? key;
    if (Array.isArray(value)) {
      box.append(el("p", `${label}:`));
      const ul = el("ul");
      value.forEach((v) => ul.append(el("li", String(v))));
      box.append(ul);
    } else if (typeof value === "object") {
      box.append(el("p", `${label}:`), el("pre", JSON.stringify(value, null, 1)));
    } else {
      box.append(el("p", `${label}: ${typeof value === "number" ? Number(value.toFixed(6)) : value}`));
    }
  }
  return box;
}

function addFeed(node) {
  $("feed-empty").hidden = true;
  $("feed").prepend(node);
}

function addMessage({ from, to, title, speech, body }) {
  const a = agents.get(from);
  const li = el("li");
  li.style.borderLeftColor = a.shirt;
  const who = el("div", null, "who");
  who.append(el("strong", a.name), ` · ${a.role}${to ? ` → ${agents.get(to).name}` : ""}`);
  li.append(who, el("div", title, "title"), el("div", speech, "speech"));
  if (body) {
    const details = el("details");
    details.append(el("summary", "Ver detalhe"), renderBody(body));
    li.append(details);
  }
  addFeed(li);
}

function renderMarket(s) {
  const box = $("market");
  box.className = "";
  box.replaceChildren();
  const up = s.change_24h_pct >= 0;
  const head = el("div", null, "stat-row");
  head.append(el("span", s.symbol.replace("_", "/")), el("span", `${up ? "+" : ""}${fmt(s.change_24h_pct)}% 24h`, up ? "up" : "down"));
  box.append(head, el("div", fmt(s.price), "big"));

  const pts = s.sparkline;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 30");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${28 - ((p - lo) / (hi - lo || 1)) * 26}`).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", up ? "#46c98b" : "#f0706a");
  line.setAttribute("stroke-width", "1.2");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(line);
  box.append(svg, el("div", `Últimas 48 horas · RSI 1h ${s.hourly.rsi14} · RSI diário ${s.daily.rsi14}`, "muted"));
  $("data-badge").hidden = !s.synthetic;
}

function renderPortfolio(p) {
  const box = $("portfolio");
  box.replaceChildren();
  const row = (k, v, cls) => {
    const r = el("div", null, "stat-row");
    r.append(el("span", k), el("span", v, cls));
    return r;
  };
  const pnl = p.equity - p.startCash;
  box.append(el("div", `${fmt(p.equity)} USDT`, "big"));
  box.append(row("Resultado total", `${pnl >= 0 ? "+" : ""}${fmt(pnl)} USDT`, pnl >= 0 ? "up" : "down"), row("Liquidez", `${fmt(p.cash)} USDT`));
  for (const pos of p.positions) box.append(row(pos.symbol.replace("_", "/"), `${fmt(pos.qty, 6)} · ${fmt(pos.value)} USDT`));
  if (!p.positions.length) box.append(el("div", "Sem posições abertas.", "muted"));
  const trades = p.history.filter((h) => h.action !== "hold").slice(-3).reverse();
  if (trades.length) {
    box.append(el("h2", "Últimas ordens")).style.marginTop = "10px";
    for (const t of trades) box.append(row(`${t.action === "buy" ? "Compra" : "Venda"} ${t.symbol.split("_")[0]}`, `${fmt(t.value)} @ ${fmt(t.price)}`));
  }
}

// ---------- Eventos ----------

const queue = [];
let draining = false;

const handlers = {
  run_start({ symbol }) {
    $("banner").hidden = true;
    addFeed(el("li", `Sessão ${symbol.replace("_", "/")} · ${new Date().toLocaleTimeString("pt-PT")}`, "divider"));
    setRunning(true);
  },
  status({ agent, state }) {
    agents.get(agent).working = state === "working";
  },
  market: renderMarket,
  portfolio: renderPortfolio,
  async goto({ agents: ids, place }) {
    await Promise.all(
      ids.map((id, i) => {
        const a = agents.get(id);
        return place === "meeting" ? walk(a, meetingSpot(i), "meeting") : walk(a, a.desk, a.room);
      }),
    );
  },
  async message(msg) {
    const a = agents.get(msg.from);
    const target = msg.to && agents.get(msg.to);
    if (target) await walk(a, { x: target.desk.x - 50, y: target.desk.y + 6 }, target.room);
    a.bubble = msg.speech;
    addMessage(msg);
    await sleep(Math.max(2200, msg.speech.length * 55));
    a.bubble = null;
    if (target) walk(a, a.desk, a.room);
  },
  failure({ message }) {
    $("banner").textContent = `A sessão falhou: ${message}`;
    $("banner").hidden = false;
    addFeed(el("li", message, "error"));
  },
  run_end() {
    setRunning(false);
  },
};

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { type, payload } = queue.shift();
    try {
      await handlers[type]?.(payload);
    } catch (err) {
      console.error(type, err);
    }
  }
  draining = false;
}

function setRunning(on) {
  $("run").disabled = on;
  $("reset").disabled = on;
  $("run").textContent = on ? "Sessão a decorrer…" : "Iniciar sessão";
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Pedido falhou");
  return data;
}

async function init() {
  setupCanvas();
  const state = await (await fetch("/api/state")).json();

  state.agents.forEach((a, i) => {
    agents.set(a.id, {
      ...a,
      shirt: SHIRT_BY_ID[a.id] ?? SHIRT[a.room],
      skin: SKINS[i % SKINS.length],
      hair: HAIRS[(i * 5 + 2) % HAIRS.length],
      longHair: /a$/.test(a.name),
      at: a.room,
      path: [],
      working: false,
      bubble: null,
    });
  });
  for (const a of agents.values()) {
    a.desk = deskSpot(a);
    a.x = a.desk.x;
    a.y = a.desk.y;
  }

  for (const s of state.symbols) $("symbol").append(new Option(s.replace("_", "/"), s));
  const mode = $("mode");
  mode.textContent = state.demo ? "Demonstração · respostas por regras, sem LLM" : `Ao vivo · ${state.model}`;
  mode.classList.toggle("live", !state.demo);
  renderPortfolio(state.portfolio);
  setRunning(state.running);

  $("speed").addEventListener("change", (e) => (speed = Number(e.target.value)));
  $("run").addEventListener("click", async () => {
    setRunning(true);
    try {
      await post("/api/run", { symbol: $("symbol").value });
    } catch (err) {
      setRunning(false);
      $("banner").textContent = err.message;
      $("banner").hidden = false;
    }
  });
  $("reset").addEventListener("click", async () => {
    if (!confirm("Repor a carteira fictícia para 10 000 USDT e apagar o histórico?")) return;
    renderPortfolio((await post("/api/reset")).portfolio);
  });

  new EventSource("/api/events").onmessage = (e) => {
    queue.push(JSON.parse(e.data));
    drain();
  };
  requestAnimationFrame(frame);
}

init().catch((err) => {
  $("banner").textContent = `Não foi possível ligar ao servidor: ${err.message}`;
  $("banner").hidden = false;
});
