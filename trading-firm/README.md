# Trading Firm · simulação com agentes

Protótipo de uma trading firm de cripto em que cada trabalhador é um agente. Os bonecos
andam por um escritório 2D, trocam mensagens e chegam a uma decisão (comprar, vender ou
esperar) que é executada numa **carteira fictícia**. Não envia ordens reais para lado nenhum.

## Como correr

Precisa de Node 20 ou superior.

```bash
cd trading-firm
npm install
npm start          # abre em http://127.0.0.1:4180
```

- **Sem chave de API** (ou com `npm run demo`) arranca em modo de demonstração: as respostas
  dos agentes são geradas por regras simples sobre os indicadores, só para ver o escritório a
  funcionar. Não é análise de um LLM.
- **Com chave de API** cada agente é uma chamada ao Claude:

  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...     # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
  npm start
  ```

Os preços vêm da API pública da Crypto.com Exchange (não precisa de conta). Se a API não
estiver acessível, a aplicação usa preços sintéticos e mostra o aviso "Preços sintéticos".

### Opções (variáveis de ambiente)

| Variável | Por omissão | Para que serve |
|---|---|---|
| `FIRM_MODEL` | `claude-opus-5-5` | Modelo de todos os agentes |
| `ANALYST_MODEL` | igual a `FIRM_MODEL` | Modelo só dos três analistas, para reduzir custo |
| `NEWS_SEARCH` | ligado | `off` desliga a pesquisa web do analista de notícias |
| `DEMO` | — | `1` força o modo de demonstração |
| `PORT` | `4180` | Porta do servidor |

Cada sessão em modo real faz 8 chamadas ao modelo, uma delas com pesquisa web.

## Quem trabalha na firma

| Sala | Boneco | Função | O que faz |
|---|---|---|---|
| Research | Dina | Mesa de Dados | Vai buscar velas de 1h e diárias e calcula indicadores (código, sem LLM) |
| Research | Tiago | Analista Técnico | Tendência, momentum e níveis |
| Research | Marta | Analista de Volatilidade | Risco de negociar agora: ATR, volume, amplitude |
| Research | Nuno | Analista de Notícias | Pesquisa notícias recentes na web |
| Estratégia | Beatriz | Investigadora Otimista | Defende o caso de compra |
| Estratégia | Bruno | Investigador Pessimista | Rebate e defende o caso contrário |
| Trading | Rita | Trader | Proposta concreta: ação, tamanho, stop, objetivo |
| Risco | Ricardo | Gestor de Risco | Aprova, reduz ou veta |
| Direção | Paula | Portfolio Manager | Decisão final |
| Trading | Eva | Execução | Regista a ordem na carteira fictícia (código, sem LLM) |

Fluxo de uma sessão: dados → três analistas em paralelo → reunião com debate → proposta →
parecer do risco → decisão → execução.

Há regras aplicadas em código, independentemente do que os agentes respondam: só spot (sem
short nem alavancagem), no máximo 25% do capital por ordem, no máximo 60% de exposição a um
ativo, e um veto do risco a uma compra é vinculativo.

## Estrutura

```
server.js          servidor HTTP: páginas, API e eventos em tempo real (SSE)
src/agents.js      os agentes: papel, sala, instruções e formato de resposta
src/pipeline.js    a ordem de trabalhos de uma sessão e os eventos que emite
src/llm.js         chamadas ao Claude (modo real)
src/demo.js        respostas por regras (modo de demonstração)
src/market.js      dados de mercado e indicadores
src/portfolio.js   carteira fictícia, guardada em data/state.json
public/            o escritório: canvas, painel lateral e animação dos eventos
```

A parte visual não sabe nada de trading: limita-se a animar eventos (`status`, `message`,
`goto`, `market`, `portfolio`). Para acrescentar um agente basta defini-lo em `src/agents.js`
e chamá-lo em `src/pipeline.js`; o boneco aparece sozinho na sala indicada.

## Limitações

- É um protótipo para explorar a ideia. As decisões dos agentes não são aconselhamento
  financeiro e não há qualquer garantia de que sejam lucrativas.
- Os agentes não têm memória entre sessões, além do estado da carteira.
- Stop e objetivo fazem parte da proposta mas não são executados automaticamente.
- Se a página for aberta a meio de uma sessão, só mostra os eventos a partir desse momento.
