// Orquestra uma sessão: quem trabalha, em que ordem, e que eventos o escritório vê.
import { AGENTS } from "./agents.js";
import { getMarketSnapshot } from "./market.js";
import { execute, loadState, summarise } from "./portfolio.js";

const STANCE = { bullish: "otimista", bearish: "pessimista", neutral: "neutro" };
const VERDICT = { approve: "aprovado", reduce: "reduzir", veto: "vetado" };
const ACTION = { buy: "comprar", sell: "vender", hold: "esperar" };
const clampPct = (x) => Math.max(0, Math.min(100, Number(x) || 0));

/**
 * @param symbol  par a analisar, por exemplo "BTC_USDT"
 * @param brain   (agentId, ctx) => resposta estruturada do agente (real ou demo)
 * @param emit    (type, payload) => void, envia um evento para o escritório
 */
export async function runSession({ symbol, brain, emit }) {
  const say = (from, to, title, speech, body) => emit("message", { from, to, title, speech, body });
  const think = async (id, ctx) => {
    emit("status", { agent: id, state: "working" });
    try {
      return await brain(id, ctx);
    } finally {
      emit("status", { agent: id, state: "idle" });
    }
  };

  emit("run_start", { symbol });
  try {
    // 1. Mesa de dados
    emit("status", { agent: "dados", state: "working" });
    const snapshot = await getMarketSnapshot(symbol);
    emit("status", { agent: "dados", state: "idle" });
    emit("market", snapshot);
    say("dados", null, "Dados de mercado", `Dados de ${symbol.replace("_", "/")} prontos: ${snapshot.price.toFixed(2)}, ${snapshot.change_24h_pct}% em 24h.`, {
      aviso: snapshot.note,
      preco: snapshot.price,
      "1h": snapshot.hourly,
      diario: snapshot.daily,
    });

    const state = loadState();
    const ctx = { snapshot, portfolio: summarise(state, { [symbol]: snapshot.price }), reports: {} };

    // 2. Analistas em paralelo
    await Promise.all(
      ["tecnico", "mercado", "noticias"].map(async (id) => {
        const report = await think(id, ctx);
        ctx.reports[id] = report;
        say(id, null, `Relatório: ${STANCE[report.stance]} (${Math.round(report.confidence)}%)`, report.speech, report);
      }),
    );

    // 3. Reunião de investimento: debate otimista vs. pessimista
    const attendees = ["tecnico", "mercado", "noticias", "bull", "bear", "trader"];
    emit("goto", { agents: attendees, place: "meeting" });
    ctx.bull = await think("bull", ctx);
    say("bull", null, "Caso otimista", ctx.bull.speech, ctx.bull);
    ctx.bear = await think("bear", ctx);
    say("bear", null, "Caso pessimista", ctx.bear.speech, ctx.bear);

    // 4. Proposta da trader, ainda na reunião
    ctx.proposal = await think("trader", ctx);
    say("trader", null, `Proposta: ${ACTION[ctx.proposal.action]}`, ctx.proposal.speech, ctx.proposal);
    emit("goto", { agents: attendees, place: "desk" });

    // 5. Risco
    say("trader", "risco", "Pedido de parecer", "Ricardo, preciso do teu parecer sobre esta proposta.", null);
    ctx.review = await think("risco", ctx);
    say("risco", "pm", `Parecer do risco: ${VERDICT[ctx.review.verdict]}`, ctx.review.speech, ctx.review);

    // 6. Decisão final
    const decision = await think("pm", ctx);
    let action = decision.action;
    let sizePct = clampPct(decision.size_pct);
    let override = null;
    if (action === "buy" && ctx.review.verdict === "veto") {
      action = "hold";
      sizePct = 0;
      override = "Compra anulada: o veto do risco é vinculativo.";
    } else if (action === "buy" && sizePct > clampPct(ctx.review.max_size_pct)) {
      sizePct = clampPct(ctx.review.max_size_pct);
      override = `Tamanho limitado a ${sizePct}% pelo parecer do risco.`;
    }
    say("pm", "exec", `Decisão final: ${ACTION[action]}`, decision.speech, { ...decision, aplicado: { action, size_pct: sizePct, nota: override } });

    // 7. Execução na carteira fictícia
    emit("status", { agent: "exec", state: "working" });
    const order = execute(state, { symbol, action, sizePct, price: snapshot.price, rationale: decision.rationale });
    emit("status", { agent: "exec", state: "idle" });
    const done =
      order.action === "hold"
        ? order.note || "Sem ordem: ficamos como estamos."
        : `${order.action === "buy" ? "Comprei" : "Vendi"} ${order.qty.toFixed(6)} ${symbol.split("_")[0]} a ${order.price.toFixed(2)}.`;
    say("exec", null, "Execução", done, order);
    emit("portfolio", summarise(state, { [symbol]: snapshot.price }));
    emit("run_end", { ok: true, symbol, action: order.action });
  } catch (err) {
    console.error(err);
    emit("goto", { agents: Object.keys(AGENTS), place: "desk" });
    emit("failure", { message: err.message || String(err) });
    emit("run_end", { ok: false, symbol });
  }
}
