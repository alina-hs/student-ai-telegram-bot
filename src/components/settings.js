"use strict";

const {
  arrayToMap,
  getCanteenNames,
  createOrUpdate,
  getCanteenId,
  getAllCoursesAndFaculties,
  getTimetableId,
} = require("../util");
const { MenuTemplate, createBackMainMenuButtons } = require("telegraf-inline-menu");

const initialize = async () => {
  const settingsMenu = new MenuTemplate("Einstellungen");

  //
  // Default Canteen
  //
  const defaultCanteenMenu = new MenuTemplate("Standardmensa");
  const canteens = await getCanteenNames();
  const canteensNameMap = arrayToMap(canteens, "name");
  const canteenIdCache = {};
  defaultCanteenMenu.select(
    "select",
    canteens.map((canteen) => canteen.name),
    {
      columns: 1,
      set: async (ctx, key) => {
        const chat = ctx.update.callback_query.message.chat;
        delete canteenIdCache[chat.id];
        await createOrUpdate({
          telegramChatId: chat.id,
          givenName: chat.first_name,
          canteen: canteensNameMap[key].id,
        });
        await ctx.reply(`Deine Standardmensa ist die ${key}. Diese kannst du in den Einstellungen wieder ändern.`);
        return true;
      },
      isSet: async (ctx, key) => {
        const chatId = ctx.update.callback_query?.message.chat.id ?? ctx.update.message.chat.id;
        let canteenId;
        if (canteenIdCache[chatId]) {
          canteenId = canteenIdCache[chatId];
        } else {
          canteenId = canteenIdCache[chatId] = await getCanteenId(chatId);
        }
        return canteenId === canteensNameMap[key].id;
      },
    }
  );
  defaultCanteenMenu.manualRow(createBackMainMenuButtons());

  settingsMenu.submenu("Standardmensa auswählen", "defaultCan", defaultCanteenMenu, {
    columns: 1,
  });

  //
  // Default Timetable
  //
  const { allFaculties, coursesByFaculty } = await getAllCoursesAndFaculties();

  const defaultTimetableMenu = new MenuTemplate("Fakultät");
  const facultySubmenu = new MenuTemplate("Studiengang");
  const courseSubmenu = new MenuTemplate("Semester");

  defaultTimetableMenu.chooseIntoSubmenu("f", () => allFaculties, facultySubmenu, { columns: 1 });
  facultySubmenu.chooseIntoSubmenu(
    "c",
    (ctx) => {
      return Object.keys(coursesByFaculty[ctx.match[1]]);
    },
    courseSubmenu,
    { columns: 1 }
  );
  const timetableCache = {};
  courseSubmenu.select(
    "s",
    (ctx) => {
      return coursesByFaculty[ctx.match[1]][ctx.match[2]].map((semester) => semester.semester);
    },
    {
      columns: 1,
      set: async (ctx, key) => {
        const chat = ctx.update.callback_query.message.chat;
        delete timetableCache[chat.id];
        await createOrUpdate({
          telegramChatId: chat.id,
          givenName: chat.first_name,
          timetable: coursesByFaculty[ctx.match[1]][ctx.match[2]].find(
            (semester) => Number(semester.semester) === Number(key)
          ),
        });
        await ctx.reply(
          `Dein neuer Standardstundenplan ist jetzt ${ctx.match[2]} in dem Semester ${ctx.match[3]}. Diesen kannst du in den Einstellungen wieder ändern.`
        );
        return true;
      },
      isSet: async (ctx, key) => {
        const chatId = ctx.update.callback_query.message.chat.id;
        const { id } = coursesByFaculty[ctx.match[1]][ctx.match[2]].find(
          (semester) => Number(semester.semester) === Number(key)
        );
        let timetableIdOfUser;
        if (timetableCache[chatId]) {
          timetableIdOfUser = timetableCache[chatId];
        } else {
          timetableIdOfUser = timetableCache[chatId] = await getTimetableId(chatId);
        }
        return timetableIdOfUser === id;
      },
    }
  );

  settingsMenu.submenu("Standardstudenplan auswählen", "dTT", defaultTimetableMenu, {
    columns: 1,
  });

  defaultTimetableMenu.manualRow(createBackMainMenuButtons());
  courseSubmenu.manualRow(createBackMainMenuButtons());
  facultySubmenu.manualRow(createBackMainMenuButtons());
  return settingsMenu;
};

module.exports = {
  initialize,
};
