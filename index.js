
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AI_BASE_URL = process.env.ORBIT_AI_BASE_URL?.replace(/\/+$/, "");
const AI_API_KEY = process.env.ORBIT_AI_API_KEY;
const AI_MODEL = process.env.ORBIT_AI_MODEL;

if (!TOKEN) {
  console.error("Configure TELEGRAM_BOT_TOKEN nas variáveis de ambiente.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const histories = new Map();
const HISTORY_LIMIT = 8;

const SYSTEM_PROMPT = `
Você é o Orbit Support, assistente oficial de suporte do projeto Orbit.
Responda em português brasileiro, de forma calma, educada e clara.
Ajude com dúvidas sobre o projeto Orbit.
Não invente funcionalidades, preços ou datas de lançamento.
Nunca peça senhas, tokens, chaves API ou códigos de verificação.
Se não souber uma informação, admita isso com sinceridade.
Seja útil, amigável e objetivo.
`;

async function sendReply(chatId, text) {
  const answer = String(text || "Não consegui responder agora. Tente novamente.");

  for (let i = 0; i < answer.length; i += 3900) {
    await bot.sendMessage(chatId, answer.slice(i, i + 3900));
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

async function askAI(chatId, userText) {
  const history = histories.get(chatId) || [];

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userText }
      ],
      temperature: 0.5,
      max_tokens: 500
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`O provedor de IA retornou HTTP ${response.status}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("A IA não retornou uma resposta válida.");
  }

  histories.set(chatId, [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: answer }
  ].slice(-HISTORY_LIMIT));

  return answer.trim();
}

bot.onText(/^\/start(?:@\w+)?(?:\s|$)/i, async (msg) => {
  await sendReply(
    msg.chat.id,
    "🚀 Olá! Eu sou o Orbit Support.\n\n" +
    "Sou o assistente de suporte do projeto Orbit e estou sendo desenvolvido para ajudar nossos usuários.\n\n" +
    "Digite /help para conhecer os comandos."
  );
});

bot.onText(/^\/help(?:@\w+)?(?:\s|$)/i, async (msg) => {
  await sendReply(
    msg.chat.id,
    "🤖 ORBIT SUPPORT — AJUDA\n\n" +
    "/start — iniciar conversa\n" +
    "/help — mostrar os comandos\n" +
    "/about — conhecer o projeto\n\n" +
    "Envie sua dúvida sobre o Orbit para começar."
  );
});

bot.onText(/^\/about(?:@\w+)?(?:\s|$)/i, async (msg) => {
  await sendReply(
    msg.chat.id,
    "💙 O Orbit é um projeto de inteligência artificial em desenvolvimento. " +
    "O Orbit Support está começando pelo Telegram, com uma futura integração planejada para o WhatsApp."
  );
});

bot.on("message", async (msg) => {
  if (!msg.text || msg.chat.type !== "private") return;
  if (msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, "typing");

    const aiReady = AI_BASE_URL && AI_API_KEY && AI_MODEL;
    const answer = aiReady
      ? await askAI(chatId, msg.text)
      : basicReply(msg.text);

    await sendReply(chatId, answer);
  } catch (error) {
    console.error("Erro no atendimento:", error.message);

    await sendReply(
      chatId,
      "Tive um problema temporário ao preparar a resposta. Tente novamente em instantes. 💙"
    );
  }
});

bot.on("polling_error", (error) => {
  console.error("Erro de conexão com o Telegram:", error.message);
});

console.log("Orbit Support iniciado.");
console.log(
  AI_BASE_URL && AI_API_KEY && AI_MODEL
    ? "Integração com IA configurada."
    : "Modo de suporte básico: API de IA ainda não configurada."
);
