// Quem trabalha na firma: papel, sala, instruções e formato de resposta de cada agente.
import { z } from "zod";
import { describeSnapshot } from "./market.js";

const speech = z.string().describe("Uma frase curta (máx. 110 caracteres), na primeira pessoa, para o balão de fala.");

export const AnalystReport = z.object({
  stance: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().describe("Confiança de 0 a 100"),
  summary: z.string().describe("2 a 3 frases"),
  key_points: z.array(z.string()).describe("3 a 5 pontos concretos, com números"),
  speech,
});

export const Argument = z.object({
  thesis: z.string().describe("A tese em 1 a 2 frases"),
  points: z.array(z.string()).describe("3 a 4 argumentos, cada um apoiado nos relatórios"),
  speech,
});

export const TradeProposal = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  size_pct: z.number().describe("Compra: % do capital total a investir. Venda: % da posição a vender. Hold: 0."),
  stop_loss_pct: z.number().describe("Distância do stop em % abaixo do preço de entrada (0 se hold)"),
  take_profit_pct: z.number().describe("Objetivo em % acima do preço de entrada (0 se hold)"),
  rationale: z.string().describe("2 a 3 frases"),
  speech,
});

export const RiskReview = z.object({
  verdict: z.enum(["approve", "reduce", "veto"]),
  max_size_pct: z.number().describe("Tamanho máximo aceitável, na mesma unidade da proposta"),
  concerns: z.array(z.string()).describe("1 a 3 riscos concretos"),
  rationale: z.string().describe("1 a 2 frases"),
  speech,
});

export const Decision = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  size_pct: z.number().describe("Compra: % do capital total. Venda: % da posição. Hold: 0."),
  rationale: z.string().describe("2 a 3 frases que expliquem a decisão a quem não esteve na reunião"),
  speech,
});

const HOUSE_RULES =
  "Trabalhas numa pequena trading firm de cripto que opera apenas em spot (compra, venda ou espera; sem alavancagem nem short) " +
  "com uma carteira fictícia. Responde sempre em português de Portugal, de forma direta e com números. " +
  "Baseia-te só nos dados que te dão; se faltar informação, di-lo em vez de inventar.";

const fmt = (x, d = 2) => Number(x).toLocaleString("pt-PT", { maximumFractionDigits: d });

function reportsText(ctx) {
  return Object.entries(ctx.reports)
    .map(([id, r]) => {
      const a = AGENTS[id];
      return `## ${a.role} (${a.name}) — ${r.stance}, confiança ${r.confidence}\n${r.summary}\n${r.key_points.map((p) => `- ${p}`).join("\n")}`;
    })
    .join("\n\n");
}

function portfolioText(ctx) {
  const p = ctx.portfolio;
  const pos = p.positions.find((x) => x.symbol === ctx.snapshot.symbol);
  return [
    `Carteira: capital total ${fmt(p.equity)} USDT, liquidez ${fmt(p.cash)} USDT.`,
    pos
      ? `Posição atual em ${pos.symbol}: ${fmt(pos.qty, 6)} unidades, preço médio ${fmt(pos.avgPrice)}, valor ${fmt(pos.value)} USDT, resultado ${fmt(pos.pnl)} USDT.`
      : `Sem posição em ${ctx.snapshot.symbol}.`,
    `Limites da casa: no máximo ${p.limits.maxTradePct}% do capital por ordem e ${p.limits.maxExposurePct}% de exposição total ao ativo.`,
  ].join("\n");
}

const debateText = (ctx) =>
  `## Tese otimista\n${ctx.bull.thesis}\n${ctx.bull.points.map((p) => `- ${p}`).join("\n")}\n\n` +
  `## Tese pessimista\n${ctx.bear.thesis}\n${ctx.bear.points.map((p) => `- ${p}`).join("\n")}`;

/**
 * `room` e `seat` posicionam o boneco no escritório; `llm: false` marca
 * trabalhadores que são código puro (dados e execução).
 */
export const AGENTS = {
  dados: { name: "Dina", role: "Mesa de Dados", short: "Dados", room: "research", seat: 0, llm: false },

  tecnico: {
    name: "Tiago",
    role: "Analista Técnico", short: "Técnico",
    room: "research",
    seat: 1,
    schema: AnalystReport,
    system: `${HOUSE_RULES}\nÉs o analista técnico. Lês tendência, momentum e níveis de preço nos dois horizontes (1 hora e diário) e dizes se o quadro técnico favorece comprar, vender ou esperar.`,
    prompt: (ctx) => `${describeSnapshot(ctx.snapshot)}\n\nEscreve o teu relatório técnico.`,
  },

  mercado: {
    name: "Marta",
    role: "Analista de Volatilidade", short: "Volatilidade",
    room: "research",
    seat: 2,
    schema: AnalystReport,
    system: `${HOUSE_RULES}\nÉs a analista de volatilidade e liquidez. Não repetes a análise de tendência: avalias quão arriscado é negociar agora (ATR, amplitude recente, volume face à média, distância a máximos e mínimos) e se as condições favorecem entrar, sair ou esperar.`,
    prompt: (ctx) => `${describeSnapshot(ctx.snapshot)}\n\nEscreve o teu relatório de volatilidade e liquidez.`,
  },

  noticias: {
    name: "Nuno",
    role: "Analista de Notícias", short: "Notícias",
    room: "research",
    seat: 3,
    // Este agente usa pesquisa web e responde em texto com um formato fixo (ver llm.js).
    system:
      `${HOUSE_RULES}\nÉs o analista de notícias. Pesquisas na web as notícias dos últimos dias que possam mexer com o ativo ` +
      `(regulação, ETFs, macro, incidentes de segurança, grandes movimentos) e avalias o sentimento. Indica a data das notícias que citas.\n` +
      `Termina com exatamente este formato, sem mais nada depois:\n` +
      `RESUMO: <2 a 3 frases>\nPONTOS:\n- <ponto>\n- <ponto>\n- <ponto>\nPOSIÇÃO: <otimista|pessimista|neutra>\nCONFIANÇA: <0 a 100>\nFALA: <uma frase curta, máx. 110 caracteres>`,
    prompt: (ctx) =>
      `Hoje é ${new Date().toISOString().slice(0, 10)}. Ativo: ${ctx.snapshot.symbol.replace("_", "/")}. ` +
      `Preço atual ${ctx.snapshot.price}, variação 24h ${ctx.snapshot.change_24h_pct}%.\nPesquisa as notícias recentes e escreve o teu relatório.`,
  },

  bull: {
    name: "Beatriz",
    role: "Investigadora Otimista", short: "Otimista",
    room: "strategy",
    seat: 0,
    schema: Argument,
    system: `${HOUSE_RULES}\nNa reunião de investimento defendes o caso otimista. Constróis o melhor argumento honesto para comprar ou manter, usando os relatórios dos analistas. Não ignoras os riscos: explicas porque pesam menos.`,
    prompt: (ctx) => `${describeSnapshot(ctx.snapshot)}\n\n# Relatórios dos analistas\n${reportsText(ctx)}\n\nApresenta o caso otimista.`,
  },

  bear: {
    name: "Bruno",
    role: "Investigador Pessimista", short: "Pessimista",
    room: "strategy",
    seat: 1,
    schema: Argument,
    system: `${HOUSE_RULES}\nNa reunião de investimento defendes o caso pessimista. Constróis o melhor argumento honesto para vender ou ficar de fora, e respondes diretamente aos pontos da colega otimista.`,
    prompt: (ctx) =>
      `${describeSnapshot(ctx.snapshot)}\n\n# Relatórios dos analistas\n${reportsText(ctx)}\n\n` +
      `# O que a Beatriz acabou de defender\n${ctx.bull.thesis}\n${ctx.bull.points.map((p) => `- ${p}`).join("\n")}\n\nApresenta o caso pessimista e rebate.`,
  },

  trader: {
    name: "Rita",
    role: "Trader", short: "Trader",
    room: "trading",
    seat: 0,
    schema: TradeProposal,
    system: `${HOUSE_RULES}\nÉs a trader. Ouviste os analistas e o debate e transformas tudo numa proposta concreta: comprar, vender ou esperar, com tamanho, stop e objetivo. Esperar é uma proposta legítima quando os sinais se contradizem. Só podes vender o que a carteira tem.`,
    prompt: (ctx) =>
      `${describeSnapshot(ctx.snapshot)}\n\n${portfolioText(ctx)}\n\n# Relatórios dos analistas\n${reportsText(ctx)}\n\n# Debate\n${debateText(ctx)}\n\nFaz a tua proposta.`,
  },

  risco: {
    name: "Ricardo",
    role: "Gestor de Risco", short: "Risco",
    room: "risk",
    seat: 0,
    schema: RiskReview,
    system: `${HOUSE_RULES}\nÉs o gestor de risco. Avalias a proposta da trader face à volatilidade, à carteira e aos limites da casa. Podes aprovar, reduzir o tamanho ou vetar. Vendas que reduzem exposição raramente merecem veto. Um veto a uma compra é vinculativo.`,
    prompt: (ctx) =>
      `${describeSnapshot(ctx.snapshot)}\n\n${portfolioText(ctx)}\n\n# Proposta da trader\n${JSON.stringify(ctx.proposal, null, 2)}\n\n` +
      `# Relatório de volatilidade\n${ctx.reports.mercado.summary}\n\nDá o teu parecer.`,
  },

  pm: {
    name: "Paula",
    role: "Portfolio Manager", short: "Direção",
    room: "direction",
    seat: 0,
    schema: Decision,
    system: `${HOUSE_RULES}\nÉs a portfolio manager e tomas a decisão final. Pesas a proposta da trader, o parecer do risco e o debate. Numa compra não podes exceder o tamanho máximo dado pelo risco, e se o risco vetou uma compra a decisão tem de ser esperar.`,
    prompt: (ctx) =>
      `${describeSnapshot(ctx.snapshot)}\n\n${portfolioText(ctx)}\n\n# Debate\n${debateText(ctx)}\n\n` +
      `# Proposta da trader\n${JSON.stringify(ctx.proposal, null, 2)}\n\n# Parecer do risco\n${JSON.stringify(ctx.review, null, 2)}\n\nDecide.`,
  },

  exec: { name: "Eva", role: "Execução", short: "Execução", room: "trading", seat: 1, llm: false },
};

export const roster = () =>
  Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, role: a.role, short: a.short, room: a.room, seat: a.seat, llm: a.llm !== false }));
