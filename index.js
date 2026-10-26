
const HISTORY_LIMIT = 8;
const TELEGRAM_MESSAGE_LIMIT = 3900;

const SYSTEM_PROMPT = `
Você é o Orbit Support, assistente oficial de suporte do projeto Orbit.
Responda em português brasileiro, de forma calma, educada e clara.
Ajude com dúvidas sobre o projeto Orbit.
Não invente funcionalidades, preços ou datas de lançamento.
Nunca peça senhas, tokens, chaves API ou códigos de verificação.
Se não souber uma informação, admita isso com sinceridade.
Seja útil, amigável e objetivo.
`;

function getAIConfig(env = process.env) {
  const baseUrl = String(env.ORBIT_AI_BASE_URL || "").trim();
  const apiKey = String(env.ORBIT_AI_API_KEY || "").trim();
  const model = String(env.ORBIT_AI_MODEL || "").trim();
  const configuredValues = [baseUrl, apiKey, model].filter(Boolean).length;

  if (configuredValues === 0) {
    return { enabled: false };
  }

  if (configuredValues !== 3) {
    throw new Error(
      "Configure ORBIT_AI_BASE_URL, ORBIT_AI_API_KEY e ORBIT_AI_MODEL juntos."
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("ORBIT_AI_BASE_URL deve ser uma URL válida.");
  }

  const isLocalHttp =
    parsedUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);

  if (parsedUrl.protocol !== "https:" && !isLocalHttp) {
    throw new Error("ORBIT_AI_BASE_URL deve usar HTTPS (exceto em localhost).");
  }

  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error(
      "ORBIT_AI_BASE_URL não deve conter credenciais, parâmetros ou fragmentos."
    );
  }

  const normalizedBaseUrl = parsedUrl.toString().replace(/\/+$/, "");

  return {
    enabled: true,
    baseUrl: normalizedBaseUrl,
    apiKey,
    model,
  };
}

function loadConfig(env = process.env) {
  const telegramToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!telegramToken) {
    throw new Error("Configure TELEGRAM_BOT_TOKEN nas variáveis de ambiente.");
  }

  return {
    telegramToken,
    ai: getAIConfig(env),
  };
}

function getChatCompletionsUrl(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`;
}

function splitMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  const characters = Array.from(String(text));
  const chunks = [];
  let currentChunk = "";

  for (const character of characters) {
    if (currentChunk.length + character.length > limit) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += character;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function sendReply(bot, chatId, text) {
  const answer =
    typeof text === "string" && text.trim()
      ? text
      : "Não consegui responder agora. Tente novamente.";

  for (const chunk of splitMessage(answer)) {
    await bot.sendMessage(chatId, chunk);
  }
}

function basicReply(text) {
  const msg = text.toLowerCase();

  if (/^(oi|olá|ola|eai|e aí|bom dia|boa tarde|boa noite)[!. ]*$/.test(msg)) {
    return "Olá! 💙 Sou o Orbit Support, assistente do projeto Orbit. Como posso ajudar?";
  }

  if (msg.includes("whatsapp")) {
    return "A integração com o WhatsApp está nos nossos planos. Primeiro estamos preparando e testando o atendimento pelo Telegram.";
  }

  if (msg.includes("apk") || msg.includes("play store")) {
    return "O aplicativo Orbit ainda está em desenvolvimento. Acompanhe as novidades pelos canais oficiais do projeto.";
  }

  if (msg.includes("imagem")) {
    return "A geração de imagens é uma funcionalidade planejada para uma etapa futura do Orbit.";
  }

  if (msg.includes("ajuda") || msg.includes("suporte")) {
    return "Estou aqui para ajudar! Conte sua dúvida sobre o projeto Orbit. Digite /help para consultar os comandos.";
  }

  return "Recebi sua mensagem! 💙 A conexão com a inteligência artificial ainda está sendo configurada. Por enquanto, posso oferecer suporte básico sobre o Orbit.";
}

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;
  const answer = Array.isArray(content)
    ? content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
    : content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("A IA não retornou uma resposta válida.");
  }

  return answer.trim();
}

async function askAI(chatId, userText, { aiConfig, histories, fetchImpl = globalThis.fetch }) {
  if (!aiConfig?.enabled) {
    throw new Error("A integração com IA não está configurada.");
  }

  const history = histories.get(chatId) || [];

  const response = await fetchImpl(getChatCompletionsUrl(aiConfig.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userText },
      ],
      temperature: 0.5,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`O provedor de IA retornou HTTP ${response.status}`);
  }

  const data = await response.json();
  const answer = extractAssistantText(data);

  histories.set(chatId, [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: answer },
  ].slice(-HISTORY_LIMIT));

  return answer;
}

function registerHandlers(bot, { aiConfig, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const histories = new Map();
  const safeSendReply = async (chatId, text) => {
    try {
      await sendReply(bot, chatId, text);
    } catch {
      logger.error("Falha ao enviar uma mensagem pelo Telegram.");
    }
  };
  const registerCommand = (pattern, text) => {
    bot.onText(pattern, async (msg) => {
      await safeSendReply(msg.chat.id, text);
    });
  };

  registerCommand(
    /^\/start(?:@\w+)?(?:\s|$)/i,
    "🚀 Olá! Eu sou o Orbit Support.\n\n" +
      "Sou o assistente de suporte do projeto Orbit e estou sendo desenvolvido para ajudar nossos usuários.\n\n" +
      "Digite /help para conhecer os comandos."
  );

  registerCommand(
    /^\/help(?:@\w+)?(?:\s|$)/i,
    "🤖 ORBIT SUPPORT — AJUDA\n\n" +
      "/start — iniciar conversa\n" +
      "/help — mostrar os comandos\n" +
      "/about — conhecer o projeto\n\n" +
      "Envie sua dúvida sobre o Orbit para começar."
  );

  registerCommand(
    /^\/about(?:@\w+)?(?:\s|$)/i,
    "💙 O Orbit é um projeto de inteligência artificial em desenvolvimento. " +
      "O Orbit Support está começando pelo Telegram, com uma futura integração planejada para o WhatsApp."
  );

  bot.on("message", async (msg) => {
    if (!msg.text || msg.chat.type !== "private" || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;

    try {
      await bot.sendChatAction(chatId, "typing");

      const answer = aiConfig?.enabled
        ? await askAI(chatId, msg.text, { aiConfig, histories, fetchImpl })
        : basicReply(msg.text);

      await sendReply(bot, chatId, answer);
    } catch {
      logger.error("Falha ao processar mensagem do Telegram.");
      await safeSendReply(
        chatId,
        "Tive um problema temporário ao preparar a resposta. Tente novamente em instantes. 💙"
      );
    }
  });

  bot.on("polling_error", () => {
    logger.error("Erro de conexão com o Telegram; confira a conectividade e o token configurado.");
  });

  return histories;
}

function startBot({ env = process.env, TelegramBotClass, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const config = loadConfig(env);
  const TelegramBot = TelegramBotClass || require("node-telegram-bot-api");
  const bot = new TelegramBot(config.telegramToken, { polling: true });

  registerHandlers(bot, { aiConfig: config.ai, fetchImpl, logger });
  logger.log("Orbit Support iniciado.");
  logger.log(
    config.ai.enabled
      ? "Integração com IA configurada."
      : "Modo de suporte básico: API de IA ainda não configurada."
  );

  return bot;
}

if (require.main === module) {
  require("dotenv").config();
  try {
    startBot();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  askAI,
  basicReply,
  extractAssistantText,
  getAIConfig,
  getChatCompletionsUrl,
  loadConfig,
  registerHandlers,
  sendReply,
  splitMessage,
  startBot,
};
