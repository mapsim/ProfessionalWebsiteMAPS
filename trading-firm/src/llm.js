// "Cérebro" real: cada agente é uma chamada à API do Claude.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AGENTS } from "./agents.js";

// Um só modelo por omissão; ANALYST_MODEL permite pôr os analistas num modelo mais barato.
const MODEL = process.env.FIRM_MODEL || "claude-opus-5-5";
const ANALYST_MODEL = process.env.ANALYST_MODEL || MODEL;
const NEWS_SEARCH = process.env.NEWS_SEARCH !== "off";
const ANALYSTS = new Set(["tecnico", "mercado", "noticias"]);

export const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const modelInfo = () => ({ model: MODEL, analystModel: ANALYST_MODEL, newsSearch: NEWS_SEARCH });

let client;
const getClient = () => (client ??= new Anthropic());

function friendly(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Chave da API inválida. Verifica a variável ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error(`A chave não tem acesso ao modelo pedido (${err.message}).`);
  if (err instanceof Anthropic.NotFoundError) return new Error(`Modelo não encontrado (${err.message}).`);
  if (err instanceof Anthropic.RateLimitError) return new Error("Limite de pedidos da API atingido. Tenta de novo daqui a pouco.");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Não foi possível ligar à API da Anthropic.");
  if (err instanceof Anthropic.APIError) return new Error(`Erro da API (${err.status}): ${err.message}`);
  return err;
}

async function structured(agent, model, effort, ctx) {
  const params = {
    model,
    max_tokens: 16000,
    system: agent.system,
    output_config: { effort, format: betaZodOutputFormat(agent.schema) },
    messages: [{ role: "user", content: agent.prompt(ctx) }],
  };
  // Se o modelo recusar por política, a API repete o pedido num modelo alternativo.
  // Os modelos Haiku não suportam este mecanismo.
  if (!model.includes("haiku")) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const res = await getClient().beta.messages.parse(params);
  if (res.stop_reason === "refusal") throw new Error(`${agent.name} (${agent.role}) recusou responder.`);
  if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new Error(`${agent.name} (${agent.role}) devolveu uma resposta incompleta.`);
  return res.parsed_output;
}

const STANCES = { otimista: "bullish", pessimista: "bearish", neutra: "neutral", neutro: "neutral" };

function parseNewsReport(text) {
  const grab = (label) => text.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  const points = (text.split(/^PONTOS:\s*$/im)[1] ?? "")
    .split(/^POSIÇÃO:/im)[0]
    .split("\n")
    .map((l) => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const summary = grab("RESUMO") ?? text.trim().slice(0, 400);
  return {
    stance: STANCES[(grab("POSIÇÃO") ?? "").toLowerCase().replace(/[^a-zçã]/g, "")] ?? "neutral",
    confidence: Number.parseInt(grab("CONFIANÇA") ?? "", 10) || 40,
    summary,
    key_points: points.slice(0, 6),
    speech: grab("FALA") ?? summary.slice(0, 110),
  };
}

async function newsAnalyst(agent, ctx) {
  const messages = [{ role: "user", content: agent.prompt(ctx) }];
  let res;
  // A pesquisa corre nos servidores da Anthropic; `pause_turn` significa "ainda não acabei, volta a chamar".
  for (let i = 0; i < 4; i++) {
    res = await getClient().messages.create({
      model: ANALYST_MODEL,
      max_tokens: 16000,
      system: agent.system,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages,
    });
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  if (res.stop_reason === "refusal") throw new Error(`${agent.name} (${agent.role}) recusou responder.`);
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("a pesquisa não devolveu texto");
  return parseNewsReport(text);
}

export async function liveBrain(id, ctx) {
  const agent = AGENTS[id];
  try {
    if (id === "noticias") {
      if (!NEWS_SEARCH) {
        return {
          stance: "neutral",
          confidence: 0,
          summary: "Pesquisa de notícias desligada (NEWS_SEARCH=off).",
          key_points: [],
          speech: "Hoje não pesquisei notícias; não contem comigo.",
        };
      }
      try {
        return await newsAnalyst(agent, ctx);
      } catch (err) {
        // Sem notícias a firma continua a funcionar; a falha fica registada no relatório.
        if (err instanceof Anthropic.AuthenticationError) throw err;
        return {
          stance: "neutral",
          confidence: 0,
          summary: `Não consegui pesquisar notícias (${friendly(err).message}).`,
          key_points: [],
          speech: "Não consegui aceder às notícias; decidam sem mim.",
        };
      }
    }
    const model = ANALYSTS.has(id) ? ANALYST_MODEL : MODEL;
    const effort = ANALYSTS.has(id) || id === "bull" || id === "bear" ? "low" : "medium";
    return await structured(agent, model, effort, ctx);
  } catch (err) {
    throw friendly(err);
  }
}
