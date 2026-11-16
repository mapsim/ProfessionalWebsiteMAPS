// Dados de mercado (API pública da Crypto.com Exchange) e indicadores técnicos.

const API = "https://api.crypto.com/exchange/v1/public/get-candlestick";

export const SYMBOLS = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT", "ADA_USDT"];

const toMillis = (raw) => (typeof raw === "number" ? raw : /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw));

function normalise(rows) {
  return rows
    .map((r) => ({
      t: toMillis(r.t ?? r.timestamp),
      o: Number(r.o ?? r.open),
      h: Number(r.h ?? r.high),
      l: Number(r.l ?? r.low),
      c: Number(r.c ?? r.close),
      v: Number(r.v ?? r.volume),
    }))
    .filter((c) => Number.isFinite(c.c) && Number.isFinite(c.t))
    .sort((a, b) => a.t - b.t);
}

async function fetchCandles(symbol, timeframe, count) {
  const url = `${API}?instrument_name=${encodeURIComponent(symbol)}&timeframe=${timeframe}&count=${count}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Crypto.com respondeu ${res.status}`);
  const json = await res.json();
  const candles = normalise(json?.result?.data ?? []);
  if (candles.length < 30) throw new Error("velas insuficientes na resposta");
  return candles;
}

// Passeio aleatório com seed, usado apenas quando a API não está acessível.
function syntheticCandles(symbol, stepMs, count) {
  const base = { BTC_USDT: 65000, ETH_USDT: 3200, SOL_USDT: 150, XRP_USDT: 0.6, ADA_USDT: 0.45 }[symbol] ?? 100;
  let seed = [...symbol].reduce((a, ch) => a * 31 + ch.charCodeAt(0), stepMs % 9973) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const vol = stepMs >= 86_400_000 ? 0.03 : 0.007;
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  const out = [];
  let price = base * (0.8 + rand() * 0.4);
  for (let i = count - 1; i >= 0; i--) {
    const o = price;
    const c = o * (1 + (rand() - 0.49) * 2 * vol);
    out.push({
      t: end - i * stepMs,
      o,
      h: Math.max(o, c) * (1 + rand() * vol * 0.5),
      l: Math.min(o, c) * (1 - rand() * vol * 0.5),
      c,
      v: 500 + rand() * 2500,
    });
    price = c;
  }
  return out;
}

const sma = (xs, n) => (xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n);

function emaSeries(xs, n) {
  const k = 2 / (n + 1);
  const out = [xs[0]];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function atrPct(candles, n = 14) {
  if (candles.length <= n) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { h, l } = candles[i];
    const pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return (sma(trs, n) / candles.at(-1).c) * 100;
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

function indicators(candles) {
  const closes = candles.map((c) => c.c);
  const last = closes.at(-1);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = emaSeries(macdLine, 9);
  const window = candles.slice(-30);
  const vols = candles.map((c) => c.v);
  return {
    last,
    sma20: round(sma(closes, 20), 6),
    sma50: round(sma(closes, 50), 6),
    rsi14: round(rsi(closes)),
    macd_hist_pct: round(((macdLine.at(-1) - signal.at(-1)) / last) * 100, 3),
    atr14_pct: round(atrPct(candles)),
    change_5_pct: round(pct(last, closes.at(-6))),
    change_20_pct: round(pct(last, closes.at(-21))),
    high_30: Math.max(...window.map((c) => c.h)),
    low_30: Math.min(...window.map((c) => c.l)),
    volume_vs_avg20: round(vols.at(-2) / sma(vols.slice(0, -1), 20)),
  };
}

export async function getMarketSnapshot(symbol) {
  let hourly;
  let daily;
  let synthetic = false;
  let note = null;
  try {
    [hourly, daily] = await Promise.all([fetchCandles(symbol, "1h", 200), fetchCandles(symbol, "1D", 120)]);
  } catch (err) {
    synthetic = true;
    note = `Sem acesso à API de mercado (${err.message}); a usar preços sintéticos.`;
    hourly = syntheticCandles(symbol, 3_600_000, 200);
    daily = syntheticCandles(symbol, 86_400_000, 120);
    // Alinha o último preço diário com o horário para os dois quadros serem coerentes.
    const k = hourly.at(-1).c / daily.at(-1).c;
    daily = daily.map((c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
  }
  const price = hourly.at(-1).c;
  return {
    symbol,
    synthetic,
    note,
    price,
    as_of: new Date(hourly.at(-1).t).toISOString(),
    change_24h_pct: round(pct(price, hourly.at(-25)?.c)),
    hourly: indicators(hourly),
    daily: indicators(daily),
    sparkline: hourly.slice(-48).map((c) => c.c),
  };
}

// Versão compacta, em texto, para pôr nos prompts dos agentes.
export function describeSnapshot(s) {
  const frame = (name, i) =>
    `${name}: preço ${i.last}, SMA20 ${i.sma20}, SMA50 ${i.sma50}, RSI14 ${i.rsi14}, ` +
    `histograma MACD ${i.macd_hist_pct}% do preço, ATR14 ${i.atr14_pct}%, ` +
    `variação 5 velas ${i.change_5_pct}%, 20 velas ${i.change_20_pct}%, ` +
    `máximo/mínimo 30 velas ${i.high_30}/${i.low_30}, volume da última vela fechada vs média 20: ${i.volume_vs_avg20}x`;
  return [
    `Ativo: ${s.symbol} (spot, Crypto.com Exchange). Dados até ${s.as_of}.`,
    s.synthetic ? "AVISO: preços SINTÉTICOS de teste, não são dados reais de mercado." : null,
    `Preço atual: ${s.price}. Variação 24h: ${s.change_24h_pct}%.`,
    frame("Velas de 1 hora", s.hourly),
    frame("Velas diárias", s.daily),
  ]
    .filter(Boolean)
    .join("\n");
}
