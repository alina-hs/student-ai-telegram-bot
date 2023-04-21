"use strict";

const { Telegraf, session } = require("telegraf");
const { MenuMiddleware } = require("telegraf-inline-menu");
const { loadEnvVariables } = require("./util");

const mainMenuComponent = require("./components/mainMenue");
const appointmentWizard = require("./components/appointmentProfessor");

loadEnvVariables();

const { BOT_TOKEN } = process.env;
let bot;

const startup = async () => {
  bot = new Telegraf(BOT_TOKEN);
  bot.use(session());
  bot.use((await appointmentWizard.initialize()).middleware());
  const mainMenu = await mainMenuComponent.initialize(bot);
  if (process.env.NODE_ENV === "production") {
    bot.telegram.setWebhook("https://europe-west3-studentai-ffbd1.cloudfunctions.net/telegramBackend");
  }

  const menuMiddleware = new MenuMiddleware("/", mainMenu);
  global.menuMiddleware = menuMiddleware;
  bot.use(menuMiddleware);
  bot.command("help", (ctx) => mainMenuComponent.sendWelcomeMessage(ctx));

  if (process.env.NODE_ENV !== "production") {
    await bot.launch();
    console.log("Bot started");
  }

  bot.catch((err, ctx) => {
    console.error(err);
    return ctx.reply(
      "Es ist ein Fehler aufgetreten. Wir werden den Fehler analysieren und daran arbeiten, dass es in Zukunft nicht mehr auftreten wird."
    );
  });

  console.log(menuMiddleware.tree());
};

exports.botFunction = async (req, res) => {
  try {
    await startupPromise;
    await bot.handleUpdate(req.body);
  } catch (err) {
    console.error(err);
  } finally {
    res.status(200).end();
  }
};

const startupPromise = startup();
