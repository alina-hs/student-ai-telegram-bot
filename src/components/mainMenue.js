"use strict";

const { Keyboard } = require("telegram-keyboard");

const {
  getNews,
  getCanteenMenu,
  getCanteenId,
  getTimetableForDate,
  checkUserExists,
  getTimetableUrl,
  getAppointments,
} = require("../util");

const settingsComponent = require("./settings");

const initialize = async (bot) => {
  //Built-in Keyboard
  bot.hears("Stundenplan heute", async (ctx) => {
    const chatId = ctx.update.message.chat.id;
    const url = await getTimetableUrl(chatId);
    if (!url) {
      await ctx.reply(
        "Du hast noch keinen Standardstundenplan. Hier kannt du die entsprechende Fakultät, Studiengang und Semester auswählen."
      );
      return global.menuMiddleware.replyToContext(ctx, "/dTT/");
    }
    const date = new Date("2021-06-29");
    await ctx.replyWithMarkdown(await timeTableHelper(date, ctx));
  });

  bot.hears("Stundenplan morgen", async (ctx) => {
    const chatId = ctx.update.message.chat.id;
    const url = await getTimetableUrl(chatId);
    if (!url) {
      await ctx.reply(
        "Du hast noch keinen Standardstundenplan. Hier kannt du die entsprechende Fakultät, Studiengang und Semester auswählen."
      );
      return global.menuMiddleware.replyToContext(ctx, "/dTT/");
    }
    const date = new Date("2021-06-30");
    await ctx.replyWithMarkdown(await timeTableHelper(date, ctx));
  });

  bot.hears("Stundenplan übermorgen", async (ctx) => {
    const chatId = ctx.update.message.chat.id;
    const url = await getTimetableUrl(chatId);
    if (!url) {
      await ctx.reply(
        "Du hast noch keinen Standardstundenplan. Hier kannt du die entsprechende Fakultät, Studiengang und Semester auswählen."
      );
      return global.menuMiddleware.replyToContext(ctx, "/dTT/");
    }
    const date = new Date("2021-06-31");
    await ctx.replyWithMarkdown(await timeTableHelper(date, ctx));
  });

  bot.hears("News", async (ctx) => {
    const text = (await getNews()).slice(0, 3).reduce((result, news) => {
      result += `*${news.title.replace(/\*/g, "")}*\n${news.content.replace(/\*/g, "")}\n\n`;
      return result;
    }, "");
    await ctx.replyWithMarkdown(text);
  });

  bot.hears("Vereinbarte Termine", async (ctx) => {
    const appointments = await getAppointments(ctx.update.message.chat.id);
    if (appointments.length === 0) {
      return ctx.reply(
        "Du hast noch keine vereinbarten Termine, du kannst die Vereinbarung von einem Termin über den Button 'Erstellen von Termin' starten."
      );
    }
    return ctx.replyWithMarkdown(
      appointments.reduce((result, appointment, index) => {
        result += appointment.professor.firstName
          ? appointment.professor.firstName + " " + appointment.professor.lastName
          : appointment.professor;
        result +=
          " am " +
          appointment.date.toDate().toLocaleDateString("de", {
            timeZone: "Europe/Berlin",
            month: "long",
            day: "numeric",
          }) +
          " um " +
          appointment.date.toDate().toLocaleTimeString("de", { timeZone: "Europe/Berlin" }).slice(0, 5) +
          " für " +
          appointment.subject +
          (appointments.length - 1 === index ? "." : ", \n");
        return result;
      }, "*Du hast ein Termin mit*: \n")
    );
  });

  bot.hears("Mensa", async (ctx) => {
    const canteenId = await getCanteenId(ctx.update.message.chat.id);
    if (!canteenId) {
      await ctx.reply("Du hast noch keinen Standardmensa. Hier kannt du diese auswählen.");
      return global.menuMiddleware.replyToContext(ctx, "/defaultCan/");
    }
    const canteen = await getCanteenMenu(canteenId);
    let text;
    if (Array.isArray(canteen.lines) && canteen.lines.length > 0) {
      text = canteen.lines.reduce((result, menuLine) => {
        result += `*${menuLine.name}*\n${menuLine.meals.reduce((resultMeals, meal) => {
          resultMeals += `${meal.meal} ${meal.price1}€\n`;
          return resultMeals;
        }, "")}\n`;
        return result;
      }, `*${canteen.name}*\n`);
    } else {
      text = `*${canteen.name}*\nHeute gibt es kein Essen. Vielleicht ist ja Feiertag?`;
    }
    await ctx.replyWithMarkdown(text);
  });

  bot.hears("Erstellen von Termin", async (ctx) => {
    return ctx.scene.enter("professor-appointment");
  });

  const _generateKeyboardMenu = () =>
    Keyboard.make([
      ["Stundenplan heute", "Stundenplan morgen", "Stundenplan übermorgen"],
      ["News", "Mensa", "Vereinbarte Termine"],
      ["Erstellen von Termin", "Einstellungen"],
    ]);

  bot.command("start", async (ctx) => {
    const userExists = await checkUserExists(ctx.update.message.chat);
    if (userExists) {
      return ctx.reply(
        `Hey ${ctx.from.first_name}, willkommen zum studentAI! Benutze /help für Hilfe.`,
        _generateKeyboardMenu().reply()
      );
    }
    return ctx.replyWithMarkdown(welcomeText, _generateKeyboardMenu().reply());
  });

  bot.hears("Einstellungen", async (ctx) => {
    return global.menuMiddleware.replyToContext(ctx, "/");
  });

  const timeTableHelper = async (date, ctx) => {
    let text;
    text = `Dein Stundenplan für den ${date.toLocaleDateString("de", { timeZone: "Europe/Berlin" })} ist folgender: \n`;
    const timetable = await getTimetableForDate(date.toISOString().slice(0, 10), ctx);
    if (timetable.length === 0) {
      return "Du hast keine Vorlesung :) Genieße den freien Tag.";
    }
    return timetable.reduce((result, current) => {
      text += `*${current.block}* (${current.start
        .toLocaleTimeString("de", { timeZone: "Europe/Berlin" })
        .slice(0, 5)} - ${current.end
        .toLocaleTimeString("de", { timeZone: "Europe/Berlin" })
        .slice(0, 5)}) - ${current.summary.trim().replace(/\*/g, "")} \n`;
      return text;
    }, text);
  };
  const settings = await settingsComponent.initialize();

  //
  // Help
  //
  settings.interact("Hilfe", "Hilfe", {
    do: async (ctx) => {
      await sendWelcomeMessage(ctx);
      return false;
    },
  });

  return settings;
};

const welcomeText =
  "Herzlich willkommen zu deinem *persönlichen Helfer*, um dir deinen Campus Alltag zu " +
  "erleichtern. Ich kann dich bei den folgenden Dingen unterstützen: \n \n" +
  "*Termine mit Professoren* \n" +
  "Termin vereinbaren \n" +
  "Vereinbarte Termine anzeigen \n \n" +
  "*Mensa*\n" +
  "Essen für den heutigen Tag anzeigen\n" +
  "Persönliche Standardmensa festlegen\n\n" +
  "*Stundenplan*\n" +
  "Persönliche Standardstundenplan festlegen\n" +
  "Stundenplan für heute, morgen oder übermorgen anzeigen\n\n" +
  "*Intranet-News*\n" +
  "News der Fakultät Wirtschaftsinformatik anzeigen\n\n" +
  "*Coming soon* \n" +
  "Intranet News von anderen Fakultäten anzeigen\n" +
  "Vereinbarte Termine bearbeiten und löschen \n \n" +
  "Dieses Nachricht wird nur bei dem ersten Starten von dem Bot angezeigt. Solltest du diese Nachricht zu einem " +
  "späteren Zeitpunkt nochmal anzeigen wollen, findest du dazu einen Button in den Einstellungen oder schreibe einfach /help.";

const sendWelcomeMessage = async (ctx) => {
  return ctx.replyWithMarkdown(welcomeText);
};

module.exports = {
  initialize,
  sendWelcomeMessage,
};
