// "Cérebro" de demonstração: respostas geradas por regras simples sobre os indicadores,
// para ver o escritório a funcionar sem chave de API. Não é análise de um LLM.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function techScore(i) {
  let s = 0;
  if (i.last > i.sma20) s++;
  else s--;
  if (i.last > i.sma50) s++;
  else s--;
  if (i.rsi14 > 55) s++;
  if (i.rsi14 < 45) s--;
  if (i.macd_hist_pct > 0) s++;
  else s--;
  return s;
}

const stanceOf = (score, t = 2) => (score >= t ? "bullish" : score <= -t ? "bearish" : "neutral");

const brains = {
  tecnico({ snapshot: s }) {
    const score = techScore(s.hourly) + techScore(s.daily);
    const stance = stanceOf(score, 3);
    const side = (i) => (i.last > i.sma20 ? "acima" : "abaixo");
    return {
      stance,
      confidence: clamp(40 + Math.abs(score) * 7, 40, 90),
      summary: `No diário o preço está ${side(s.daily)} da SMA20 com RSI ${s.daily.rsi14}; na hora está ${side(s.hourly)} da SMA20 com RSI ${s.hourly.rsi14}.`,
      key_points: [
        `Diário: variação de 20 velas ${s.daily.change_20_pct}%, histograma MACD ${s.daily.macd_hist_pct}%`,
        `1h: variação de 5 velas ${s.hourly.change_5_pct}%, histograma MACD ${s.hourly.macd_hist_pct}%`,
        `Intervalo de 30 dias: ${s.daily.low_30.toFixed(2)} – ${s.daily.high_30.toFixed(2)}`,
      ],
      speech: { bullish: "O quadro técnico está a favor dos compradores.", bearish: "Tendência fraca nos dois horizontes.", neutral: "Sinais técnicos mistos, sem direção clara." }[stance],
    };
  },

  mercado({ snapshot: s }) {
    const hot = s.daily.atr14_pct > 4;
    const quiet = s.hourly.volume_vs_avg20 < 0.7;
    return {
      stance: hot ? "bearish" : "neutral",
      confidence: hot ? 65 : 50,
      summary: `ATR diário de ${s.daily.atr14_pct}% e volume horário a ${s.hourly.volume_vs_avg20}x da média. ${hot ? "Volatilidade alta: posições pequenas." : "Volatilidade normal."}`,
      key_points: [
        `ATR14 diário ${s.daily.atr14_pct}%, horário ${s.hourly.atr14_pct}%`,
        `Volume da última hora fechada: ${s.hourly.volume_vs_avg20}x a média de 20`,
        quiet ? "Pouca liquidez nesta hora: risco de slippage" : "Liquidez dentro do habitual",
      ],
      speech: hot ? "Volatilidade alta, cuidado com o tamanho." : "Condições de mercado normais para negociar.",
    };
  },

  noticias() {
    return {
      stance: "neutral",
      confidence: 0,
      summary: "Modo de demonstração: não foi feita pesquisa de notícias.",
      key_points: ["Com uma chave de API este analista pesquisa notícias recentes na web."],
      speech: "Em modo demo não pesquiso notícias.",
    };
  },

  bull({ snapshot: s, reports }) {
    return {
      thesis: `O ${s.symbol} segura-se acima do mínimo de 30 dias e há espaço até ao máximo recente.`,
      points: [
        `Técnico: ${reports.tecnico.summary}`,
        `O preço está ${(((s.price - s.daily.low_30) / s.daily.low_30) * 100).toFixed(1)}% acima do mínimo de 30 dias`,
        "Uma entrada pequena com stop limita a perda se a tese falhar",
      ],
      speech: "Há margem para subir e o risco pode ser limitado com um stop.",
    };
  },

  bear({ snapshot: s, reports }) {
    return {
      thesis: `Sem confirmação de tendência, comprar ${s.symbol} agora é pagar para ver.`,
      points: [
        `Volatilidade: ${reports.mercado.summary}`,
        `O preço está ${(((s.daily.high_30 - s.price) / s.daily.high_30) * 100).toFixed(1)}% abaixo do máximo de 30 dias`,
        "Não temos leitura de notícias; um título negativo apanha-nos desprevenidos",
      ],
      speech: "Sem tendência confirmada prefiro esperar.",
    };
  },

  trader({ snapshot: s, reports, portfolio }) {
    const votes = Object.values(reports).reduce((a, r) => a + (r.stance === "bullish" ? 1 : r.stance === "bearish" ? -1 : 0), 0);
    const hasPos = portfolio.positions.some((p) => p.symbol === s.symbol);
    const stop = clamp(Number((s.daily.atr14_pct * 1.5).toFixed(1)), 2, 12);
    if (votes > 0)
      return { action: "buy", size_pct: 12, stop_loss_pct: stop, take_profit_pct: stop * 2, rationale: "Os analistas inclinam-se para o lado comprador; proponho uma entrada moderada com stop a 1,5 ATR.", speech: "Proponho comprar 12% do capital, com stop." };
    if (votes < 0 && hasPos)
      return { action: "sell", size_pct: 50, stop_loss_pct: 0, take_profit_pct: 0, rationale: "Sinais negativos com posição aberta; proponho reduzir metade.", speech: "Proponho vender metade da posição." };
    return { action: "hold", size_pct: 0, stop_loss_pct: 0, take_profit_pct: 0, rationale: "Os sinais contradizem-se; não há vantagem clara.", speech: "Sem vantagem clara, proponho esperar." };
  },

  risco({ snapshot: s, proposal }) {
    if (proposal.action !== "buy")
      return { verdict: "approve", max_size_pct: proposal.size_pct, concerns: [], rationale: "A proposta não aumenta a exposição.", speech: "Sem objeções do risco." };
    if (s.daily.atr14_pct > 4)
      return { verdict: "reduce", max_size_pct: proposal.size_pct / 2, concerns: [`ATR diário de ${s.daily.atr14_pct}%`], rationale: "Volatilidade acima do habitual; metade do tamanho.", speech: "Aprovo, mas com metade do tamanho." };
    return { verdict: "approve", max_size_pct: proposal.size_pct, concerns: ["Sem leitura de notícias nesta sessão"], rationale: "Tamanho dentro dos limites e stop definido.", speech: "Aprovado, dentro dos limites." };
  },

  pm({ proposal, review }) {
    const size = proposal.action === "buy" ? Math.min(proposal.size_pct, review.max_size_pct) : proposal.size_pct;
    const action = proposal.action === "buy" && review.verdict === "veto" ? "hold" : proposal.action;
    const verb = { buy: "Compramos", sell: "Vendemos", hold: "Ficamos de fora" }[action];
    return {
      action,
      size_pct: action === "hold" ? 0 : size,
      rationale: `Sigo a proposta da trader com o ajuste do risco. ${proposal.rationale}`,
      speech: action === "hold" ? "Decisão: esperamos por melhor oportunidade." : `Decisão: ${verb.toLowerCase()} ${size}%${action === "sell" ? " da posição" : " do capital"}.`,
    };
  },
};

export async function demoBrain(id, ctx) {
  await sleep(900 + Math.random() * 1100);
  return brains[id](ctx);
}
