# Orbit Support

Bot de suporte do Orbit para Telegram. O bot usa long polling e, quando as três
variáveis de IA estão configuradas, envia as mensagens para uma API compatível
com o endpoint OpenAI Chat Completions.

## Requisitos

- Node.js 20 ou superior
- npm
- Um bot criado pelo [@BotFather](https://t.me/BotFather)
- Uma API de IA compatível com Chat Completions (opcional; sem ela, o bot usa
  respostas básicas locais)

## Configuração local

```sh
npm install
cp .env.example .env
```

Preencha `.env` localmente. Nunca faça commit desse arquivo nem compartilhe os
valores dos tokens ou das chaves.

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Sim | Token do bot gerado pelo BotFather. |
| `ORBIT_AI_BASE_URL` | Não* | URL base HTTPS da API compatível, por exemplo `https://api.openai.com/v1`. Também aceita a URL completa terminada em `/chat/completions`. |
| `ORBIT_AI_API_KEY` | Não* | Chave da API de IA, enviada como `Authorization: Bearer …`. |
| `ORBIT_AI_MODEL` | Não* | Identificador exato do modelo disponível no provedor. |

*As três variáveis `ORBIT_AI_*` devem ser preenchidas juntas. Se todas
estiverem vazias, o bot inicia em modo de respostas básicas. Se apenas parte
estiver configurada, a inicialização falha com uma mensagem de configuração.

## Iniciar e testar

```sh
npm start
npm test
```

O bot recebe mensagens privadas por long polling. Os comandos `/start`, `/help`
e `/about` são respondidos sem chamar a IA. O GitHub Actions executa testes e
verificação de sintaxe; ele não hospeda o bot continuamente.

## Hospedagem

Hospede como processo Node.js de execução contínua (worker), com o comando
`npm start`, e configure as quatro variáveis no painel de variáveis/segredos do
provedor. Não coloque credenciais em arquivos versionados nem no workflow de
testes.

A opção de menor custo é uma VM Always Free da Oracle Cloud: custa US$ 0 dentro
das cotas, mas depende de capacidade na região e instâncias ociosas podem ser
recolhidas pela Oracle. Para um worker gerenciado, o plano mais barato do Render
é pago (consulte o preço vigente); os serviços gratuitos do Render são Web
Services que dormem sem tráfego recebido e não servem como worker de polling
contínuo. Consulte [os limites Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[as limitações do Render Free](https://render.com/docs/free) e
[os preços de compute do Render](https://render.com/pricing#compute).
