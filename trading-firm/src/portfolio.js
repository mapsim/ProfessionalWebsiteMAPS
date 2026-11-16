// Carteira fictícia (paper trading), guardada em data/state.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
const START_CASH = 10_000;
const FEE = 0.001; // 0,1% por ordem

// Limites rígidos, aplicados em código independentemente do que os agentes digam.
export const LIMITS = { maxTradePct: 25, maxExposurePct: 60 };

function fresh() {
  return { cash: START_CASH, positions: {}, history: [] };
}

export function loadState() {
  try {
    return { ...fresh(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return fresh();
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function resetState() {
  const state = fresh();
  save(state);
  return state;
}

// `prices` só precisa de conter os símbolos conhecidos; os outros ficam ao preço médio de compra.
export function summarise(state, prices = {}) {
  const positions = Object.entries(state.positions).map(([symbol, p]) => {
    const price = prices[symbol] ?? p.avgPrice;
    return { symbol, qty: p.qty, avgPrice: p.avgPrice, price, value: p.qty * price, pnl: p.qty * (price - p.avgPrice) };
  });
  const equity = state.cash + positions.reduce((a, p) => a + p.value, 0);
  return { cash: state.cash, positions, equity, startCash: START_CASH, limits: LIMITS, history: state.history.slice(-20) };
}

/**
 * Executa a decisão final. `sizePct` é % do capital total numa compra
 * e % da posição numa venda. Devolve o registo da ordem.
 */
export function execute(state, { symbol, action, sizePct, price, rationale }) {
  const pos = state.positions[symbol] ?? { qty: 0, avgPrice: 0 };
  const equity = summarise(state, { [symbol]: price }).equity;
  const order = { at: new Date().toISOString(), symbol, action, price, qty: 0, value: 0, fee: 0, note: "", rationale };

  if (action === "buy") {
    const room = (LIMITS.maxExposurePct / 100) * equity - pos.qty * price;
    const wanted = (Math.min(sizePct, LIMITS.maxTradePct) / 100) * equity;
    const spend = Math.max(0, Math.min(wanted, room, state.cash / (1 + FEE)));
    if (spend < 1) {
      order.action = "hold";
      order.note = "Compra não executada: sem margem dentro dos limites de exposição ou sem liquidez.";
    } else {
      if (spend < wanted - 0.01) order.note = "Tamanho reduzido pelos limites de risco da carteira.";
      order.qty = spend / price;
      order.value = spend;
      order.fee = spend * FEE;
      pos.avgPrice = (pos.qty * pos.avgPrice + spend) / (pos.qty + order.qty);
      pos.qty += order.qty;
      state.cash -= spend + order.fee;
      state.positions[symbol] = pos;
    }
  } else if (action === "sell") {
    const qty = pos.qty * (Math.min(Math.max(sizePct, 0), 100) / 100);
    if (qty * price < 1) {
      order.action = "hold";
      order.note = "Venda não executada: não há posição para vender.";
    } else {
      order.qty = qty;
      order.value = qty * price;
      order.fee = order.value * FEE;
      order.realisedPnl = qty * (price - pos.avgPrice) - order.fee;
      pos.qty -= qty;
      state.cash += order.value - order.fee;
      if (pos.qty * price < 1) delete state.positions[symbol];
      else state.positions[symbol] = pos;
    }
  }

  state.history.push(order);
  save(state);
  return order;
}
