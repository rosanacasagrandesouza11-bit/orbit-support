const test = require("node:test");
const assert = require("node:assert/strict");

const {
  basicReply,
  extractAssistantText,
  getAIConfig,
  getChatCompletionsUrl,
  loadConfig,
  registerHandlers,
  sendReply,
  splitMessage,
  startBot,
} = require("../index");

const completeAIEnv = {
  ORBIT_AI_BASE_URL: "https://ai.example.test/v1/",
  ORBIT_AI_API_KEY: "mock-key-for-test",
  ORBIT_AI_MODEL: "orbit-test-model",
};

class FakeBot {
  constructor() {
    this.textHandlers = [];
    this.eventHandlers = new Map();
    this.sentMessages = [];
    this.chatActions = [];
  }

  onText(pattern, handler) {
    this.textHandlers.push({ pattern, handler });
  }

  on(event, handler) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  async sendMessage(chatId, text) {
    this.sentMessages.push({ chatId, text });
  }

  async sendChatAction(chatId, action) {
    this.chatActions.push({ chatId, action });
  }

  async emitMessage(message) {
    for (const { pattern, handler } of this.textHandlers) {
      if (pattern.test(message.text || "")) {
        await handler(message);
      }
    }

    for (const handler of this.eventHandlers.get("message") || []) {
      await handler(message);
    }
  }
}

test("AI configuration trims values and accepts an HTTPS base URL", () => {
  const config = getAIConfig({
    ORBIT_AI_BASE_URL: " https://ai.example.test/v1/// ",
    ORBIT_AI_API_KEY: " mock-key ",
    ORBIT_AI_MODEL: " orbit-model ",
  });

  assert.deepEqual(config, {
    enabled: true,
    baseUrl: "https://ai.example.test/v1",
    apiKey: "mock-key",
    model: "orbit-model",
  });
});

test("AI configuration stays optional when all AI variables are empty", () => {
  assert.deepEqual(getAIConfig({}), { enabled: false });
  assert.deepEqual(
    loadConfig({ TELEGRAM_BOT_TOKEN: "telegram-test-token" }),
    { telegramToken: "telegram-test-token", ai: { enabled: false } }
  );
});

test("partial AI configuration and unsafe URLs fail with actionable errors", () => {
  assert.throws(
    () => getAIConfig({ ORBIT_AI_API_KEY: "mock-key" }),
    /Configure ORBIT_AI_BASE_URL/
  );
  assert.throws(
    () => getAIConfig({
      ...completeAIEnv,
      ORBIT_AI_BASE_URL: "http://ai.example.test/v1",
    }),
    /deve usar HTTPS/
  );
  assert.throws(() => loadConfig({}), /Configure TELEGRAM_BOT_TOKEN/);
});

test("chat completions URL accepts a base URL or the full endpoint", () => {
  assert.equal(
    getChatCompletionsUrl("https://ai.example.test/v1"),
    "https://ai.example.test/v1/chat/completions"
  );
  assert.equal(
    getChatCompletionsUrl("https://ai.example.test/v1/chat/completions"),
    "https://ai.example.test/v1/chat/completions"
  );
});

test("AI request uses the configured endpoint, bearer auth, model, and conversation history", async () => {
  const aiConfig = getAIConfig(completeAIEnv);
  const histories = new Map();
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "  Resposta da IA  " } }],
      }),
    };
  };

  const { askAI } = require("../index");
  assert.equal(
    await askAI(123, "Oi, Orbit", { aiConfig, histories, fetchImpl }),
    "Resposta da IA"
  );
  assert.equal(captured.url, "https://ai.example.test/v1/chat/completions");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer mock-key-for-test");

  const request = JSON.parse(captured.options.body);
  assert.equal(request.model, "orbit-test-model");
  assert.equal(request.messages.at(-1).content, "Oi, Orbit");

  await askAI(123, "Outra pergunta", {
    aiConfig,
    histories,
    fetchImpl: async (_url, options) => {
      const nextRequest = JSON.parse(options.body);
      assert.deepEqual(
        nextRequest.messages.slice(-3).map(({ role }) => role),
        ["user", "assistant", "user"]
      );
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Tudo certo." } }] }),
      };
    },
  });
});

test("AI response parsing supports text parts and rejects empty or invalid content", () => {
  assert.equal(
    extractAssistantText({
      choices: [{ message: { content: [{ type: "text", text: "Olá" }, { type: "text", text: "!" }] } }],
    }),
    "Olá!"
  );
  assert.throws(() => extractAssistantText({ choices: [] }), /resposta válida/);
});

test("AI HTTP errors do not include provider response bodies", async () => {
  const { askAI } = require("../index");
  await assert.rejects(
    askAI(1, "Oi", {
      aiConfig: getAIConfig(completeAIEnv),
      histories: new Map(),
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => "sensitive provider response",
      }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /sensitive provider response/);
      return true;
    }
  );
});

test("private Telegram messages reach the AI and send the resulting reply", async () => {
  const bot = new FakeBot();
  const calls = [];
  registerHandlers(bot, {
    aiConfig: getAIConfig(completeAIEnv),
    fetchImpl: async (url, options) => {
      calls.push({ url, request: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Resposta testada." } }] }),
      };
    },
    logger: { error() {} },
  });

  await bot.emitMessage({ text: "Preciso de ajuda", chat: { id: 55, type: "private" } });

  assert.equal(bot.chatActions[0].action, "typing");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.messages.at(-1).content, "Preciso de ajuda");
  assert.deepEqual(bot.sentMessages, [{ chatId: 55, text: "Resposta testada." }]);
});

test("startBot creates a polling Telegram client without printing credentials", () => {
  let receivedToken;
  let receivedOptions;
  class CapturingBot extends FakeBot {
    constructor(token, options) {
      super();
      receivedToken = token;
      receivedOptions = options;
    }
  }
  const logs = [];

  const bot = startBot({
    env: {
      TELEGRAM_BOT_TOKEN: "telegram-test-token",
      ...completeAIEnv,
    },
    TelegramBotClass: CapturingBot,
    logger: { log: (message) => logs.push(message), error() {} },
  });

  assert.ok(bot instanceof CapturingBot);
  assert.equal(receivedToken, "telegram-test-token");
  assert.deepEqual(receivedOptions, { polling: true });
  assert.deepEqual(logs, ["Orbit Support iniciado.", "Integração com IA configurada."]);
});

test("commands work without AI, while groups and other commands are ignored", async () => {
  const bot = new FakeBot();
  registerHandlers(bot, {
    aiConfig: { enabled: false },
    logger: { error() {} },
  });

  await bot.emitMessage({ text: "/start", chat: { id: 7, type: "private" } });
  await bot.emitMessage({ text: "oi", chat: { id: 8, type: "group" } });
  await bot.emitMessage({ text: "/unknown", chat: { id: 9, type: "private" } });

  assert.match(bot.sentMessages[0].text, /Orbit Support/);
  assert.equal(bot.sentMessages.length, 1);
  assert.match(basicReply("ajuda"), /Estou aqui para ajudar/);
});

test("Telegram message chunking preserves Unicode and stays within the limit", async () => {
  const text = "💙".repeat(4000);
  const chunks = splitMessage(text);
  assert.ok(chunks.every((chunk) => chunk.length <= 3900));
  assert.equal(chunks.join(""), text);
  assert.equal(chunks.join("").includes("�"), false);

  const bot = new FakeBot();
  await sendReply(bot, 15, text);
  assert.equal(bot.sentMessages.length, chunks.length);
  assert.equal(bot.sentMessages.map(({ text: chunk }) => chunk).join(""), text);
});
