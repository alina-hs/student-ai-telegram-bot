"use strict";

const { Scenes, Markup } = require("telegraf");
const axios = require("axios");
const Levenshtein = require("levenshtein");
const getClosest = require("get-closest");
const { checkForBadWords, saveAppointmentForUser } = require("../util");

const compareLevenshteinDistance = (compareTo, baseItem) => {
  return new Levenshtein(compareTo, baseItem).distance;
};

const dateRegex = /^(0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[012])$/;
const timeRegex = /^([01]\d|2[0-3]):?([0-5]\d)$/;

const initialize = async () => {
  const allPeople = await axios.get("https://www.iwi.hs-karlsruhe.de/hskampus-broker/api/persons/");
  const allPeopleMap = allPeople.data
    .filter((person) => !person.isDeleted && person.academicDegree.includes("Prof"))
    .reduce((result, person) => {
      if (result[person.lastName]) {
        result[person.lastName].push(person);
      } else {
        result[person.lastName] = [person];
      }
      return result;
    }, {});

  const appointmentWizard = new Scenes.WizardScene(
    "professor-appointment",
    async (ctx) => {
      await ctx.reply("Wie ist der Nachname von dem Professor? (Schreibe /stop, um den Vorgang abzubrechen.)");
      ctx.wizard.state.data = {};
      return ctx.wizard.next();
    },
    async (ctx) => {
      const profLastName = ctx.message?.text;
      if (!profLastName) {
        return;
      }
      if (/stop/i.test(profLastName)) {
        await ctx.reply("Alles klar, ich habe die Termin Anlegung abgebrochen.");
        return ctx.scene.leave();
      }
      ctx.wizard.state.data.lastName = profLastName;
      const profEstimate = getClosest.custom(profLastName, Object.keys(allPeopleMap), compareLevenshteinDistance);
      const foundProfs = (ctx.wizard.state.data.foundProfs = Object.values(allPeopleMap)[profEstimate]);
      if (foundProfs.length > 1) {
        await ctx.reply(
          `Zu dem Namen ${profLastName} habe ich mehrere Möglichkeiten gefunden.`,
          Markup.inlineKeyboard(
            foundProfs.map((prof) =>
              Markup.button.callback(`${prof.academicDegree} ${prof.firstName} ${prof.lastName}`, prof.id)
            )
          )
        );
        return ctx.wizard.next();
      } else {
        ctx.wizard.state.data.selectedProf = foundProfs[0];
        await ctx.reply(
          `Meinst du ${foundProfs[0].academicDegree} ${foundProfs[0].firstName} ${foundProfs[0].lastName}?`
        );
        !foundProfs[0].imageUrl.includes("dummy") &&
          (await ctx.reply("Hier kommt noch ein Foto:\n" + foundProfs[0].imageUrl));
        return ctx.wizard.next();
      }
    },
    async (ctx) => {
      if (/stop/i.test(ctx.message?.text)) {
        await ctx.reply("Alles klar, ich habe die Termin Anlegung abgebrochen.");
        return ctx.scene.leave();
      }
      const selectedProfId = ctx.update?.callback_query?.data;
      const askForDateString = `An welchem Tag möchtest du den Termin ausmachen? Bitte benutze das Format ${(
        "0" +
        (new Date().getDate() + 1)
      ).slice(-2)}.${("0" + (new Date().getMonth() + 1)).slice(-2)} (TT.MM).`;
      if (selectedProfId) {
        const { foundProfs } = ctx.wizard.state.data;
        ctx.wizard.state.data.selectedProf = foundProfs.find((prof) => prof.id.toString() === selectedProfId);
        await ctx.reply(askForDateString);
        return ctx.wizard.next();
      }
      if (ctx.message?.text === "ja" || ctx.message?.text === "Ja") {
        await ctx.reply(askForDateString);
        return ctx.wizard.next();
      } else {
        await ctx.reply("Alles klar, dann sag mir bitte nochmal den Nachnamen.");
        return ctx.wizard.back();
      }
    },
    async (ctx) => {
      if (/stop/i.test(ctx.message?.text)) {
        await ctx.reply("Alles klar, ich habe die Termin Anlegung abgebrochen.");
        return ctx.scene.leave();
      }
      const date = ctx.message?.text;
      if (!date) {
        return;
      }
      const parsedDate = dateRegex.exec(date);
      if (date.length !== 5 || !parsedDate || parsedDate[1].length + parsedDate[2].length !== date.length - 1) {
        return ctx.reply(
          `Das Datum ist nicht im richtigen Format. Wenn du für morgen einen Termin vereinbaren möchtest, versuche doch mal ${(
            "0" +
            (new Date().getDate() + 1)
          ).slice(-2)}.${("0" + (new Date().getMonth() + 1)).slice(-2)}.`
        );
      }
      const enteredDate = new Date(`${new Date().getFullYear()}-${parsedDate[2]}-${parsedDate[1]}`);
      if (enteredDate.getTime() <= new Date(new Date().toISOString().slice(0, 10)).getTime()) {
        return ctx.reply(
          "Das Datum liegt in der Vergangenheit oder ist am heutigen Tag. Bitte verwende ein Datum in der Zukunft."
        );
      }
      ctx.wizard.state.data.selectedDate = enteredDate;
      await ctx.reply(
        "Zu welcher Uhrzeit möchtest du den Termin vereinbaren? Verwende bitte das folgende Format 13:45 (HH:MM)."
      );
      return ctx.wizard.next();
    },
    async (ctx) => {
      if (/stop/i.test(ctx.message?.text)) {
        await ctx.reply("Alles klar, ich habe die Termin Anlegung abgebrochen.");
        return ctx.scene.leave();
      }
      const time = ctx.message?.text;
      if (!time) {
        return;
      }
      const parsedTime = timeRegex.exec(time);
      if (!parsedTime) {
        return ctx.reply("Die Uhrzeit ist nicht im richtigen Format. Versuche doch mal 08:30.");
      }
      if (parsedTime[1] >= 18) {
        return ctx.reply(
          "Ich würde sagen, dass ist schon etwas zu spät für einen Termin. Versuche bitte einen Termin vor 18:00 zu vereinbaren."
        );
      }
      const { selectedProf } = ctx.wizard.state.data;
      if (parsedTime[1] < 8) {
        return ctx.reply(
          `Um diese Uhrzeit schläft ${selectedProf.firstName} ${selectedProf.lastName} bestimmt noch. Versuche bitte einen Termin nach 08:00 zu vereinbaren.`
        );
      }
      const { selectedDate } = ctx.wizard.state.data;
      selectedDate.setHours(parsedTime[1] - (process.env.NODE_ENV === "production" ? 2 : 0), parsedTime[2]);
      await ctx.reply(
        `Bitte wählen noch einen Betreff, damit ${selectedProf.firstName} ${selectedProf.lastName} auch weiß worum es geht.`
      );
      return ctx.wizard.next();
    },
    async (ctx) => {
      if (/stop/i.test(ctx.message?.text)) {
        ctx.reply("Alles klar, ich habe die Termin Anlegung abgebrochen.");
        return ctx.scene.leave();
      }
      const subject = ctx.message?.text;
      if (!subject) {
        return;
      }

      if (checkForBadWords(subject)) {
        return ctx.reply("Das ist aber nicht sehr nett. Bitte verwende einen Betreff ohne Beleidigungen.");
      }

      const { selectedDate, selectedProf } = ctx.wizard.state.data;
      await ctx.reply(
        `Perfekt, ich habe eine Terminanfrage an ${selectedProf.academicDegree} ${selectedProf.firstName} ${
          selectedProf.lastName
        } für den ${selectedDate.toLocaleDateString("de", {
          timeZone: "Europe/Berlin",
          month: "numeric",
          day: "numeric",
        })} um ${selectedDate
          .toLocaleTimeString("de", { timeZone: "Europe/Berlin" })
          .slice(
            0,
            5
          )} gesendet. Ich werde dich hier im Chat benachrichtigen, sobald der Professor auf die Anfrage geantwortet hat.`
      );
      await saveAppointmentForUser(ctx.update.message.chat.id, {
        professor: selectedProf,
        date: selectedDate,
        subject,
      });
      return ctx.scene.leave();
    }
  );
  return new Scenes.Stage([appointmentWizard]);
};

module.exports = {
  initialize,
};
