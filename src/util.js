"use strict";

const axios = require("axios");
const xmlParser = require("xml2js");
const { promisify } = require("util");
const admin = require("firebase-admin");
const ical = require("node-ical").async;

const badWords = require("./badWords.json");

let env;
try {
  env = require("./env.json");
} catch {}

let serviceAccount;
try {
  serviceAccount = require("./credentials-firebase.json");
} catch {}

admin.initializeApp({
  credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault(),
});

const db = admin.firestore();
const xmlParserStringAsync = promisify(xmlParser.parseString);

const getCanteenId = async (chatId) => {
  const userRef = db.collection("users").where("telegramChatId", "==", chatId);
  const doc = await userRef.get();
  if (!doc.empty) {
    return doc.docs[0].data().canteen;
  } else {
    return null;
  }
};

const getTimetableId = async (chatId) => {
  const userRef = db.collection("users").where("telegramChatId", "==", chatId);
  const doc = await userRef.get();
  if (!doc.empty) {
    return doc.docs[0].data()?.timetable?.id;
  } else {
    return null;
  }
};

const getAppointments = async (telegramChatId) => {
  const userRef = db.collection("users").doc(telegramChatId.toString());
  const doc = await userRef.get();

  if (doc.exists) {
    return doc.data()?.appointments ?? [];
  } else {
    return null;
  }
};

const checkUserExists = async (chat) => {
  const userRef = db.collection("users").where("telegramChatId", "==", chat.id);
  const doc = await userRef.get();
  if (doc.empty) {
    createOrUpdate({
      telegramChatId: chat.id,
      givenName: chat.first_name,
      lastName: chat.last_name ?? "",
    }).catch((err) => {
      console.error(err);
    });
    return false;
  }
  return true;
};

const saveAppointmentForUser = async (chatId, appointmentData) => {
  const userRef = db.collection("users").where("telegramChatId", "==", chatId);
  const doc = await userRef.get();
  if (!doc.empty) {
    if (doc.docs[0].data().appointments) {
      return doc.docs[0]._ref.update({
        appointments: admin.firestore.FieldValue.arrayUnion({
          id: Math.floor(Math.random() * 100000000),
          ...appointmentData,
        }),
      });
    } else {
      return doc.docs[0]._ref.update({
        appointments: [
          {
            id: Math.floor(Math.random() * 100000000),
            ...appointmentData,
          },
        ],
      });
    }
  } else {
    return null;
  }
};

const getTimetableUrl = async (chatId) => {
  const userRef = db.collection("users").where("telegramChatId", "==", chatId);
  const doc = await userRef.get();
  if (!doc.empty) {
    return doc.docs[0].data().timetable?.iCalLink;
  } else {
    return null;
  }
};

const createOrUpdate = async (userData) =>
  await db.collection("users").doc(userData.telegramChatId.toString()).set(userData, { merge: true });

const _getNewsFeedForIwi = async () => {
  const { data } = await axios.get("https://www.iwi.hs-karlsruhe.de/intranet/feed/rss/news.xml");
  return xmlParserStringAsync(data);
};

const _extractNewsFromRssFeed = (rssFeed) =>
  rssFeed.rss.channel[0].item.reduce((result, item) => {
    result.push({
      title: item.title[0],
      content: item.description[0].replace("<![CDATA[ ", "").replace(" ]]>", "").replace(/<.*?>/g, " "),
    });
    return result;
  }, []);

const getNews = async () => _extractNewsFromRssFeed(await _getNewsFeedForIwi());

const getCanteenNames = async () => {
  const { data } = await axios.get("https://www.iwi.hs-karlsruhe.de/hskampus-broker/api/canteen");
  return data;
};

const _getCanteenMenus = async (id) => {
  try {
    const { data } = await axios.get(
      `https://www.iwi.hs-karlsruhe.de/hskampus-broker/api/canteen/${id}/date/2021-07-12`
    );
    return data[0] ?? {};
  } catch (e) {
    console.log(e);
  }
};

const getCanteenMenu = async (id) => {
  const canteenMenus = await _getCanteenMenus(id);
  if (!canteenMenus.lines) {
    return {
      name: (await getCanteenNames()).filter(canteen => canteen.id === id)[0].name,
    };
  }
  const lines = canteenMenus.lines.reduce((result, current) => {
    if (current.meals?.length > 0) {
      result.push(current);
    }
    return result;
  }, []);
  return {
    name: canteenMenus.name,
    lines,
  };
};

const currentDate = () => new Date().toISOString().slice(0, 10);

const loadEnvVariables = () => (process.env = { ...process.env, ...env });

const arrayToMap = (array, key) =>
  array.reduce((map, element) => {
    map[element[key]] = element;
    return map;
  }, {});

const getTimetableForDate = async (date = "2021-07-21", ctx) => {
  const chatId = ctx.update.message.chat.id;
  const url = await getTimetableUrl(chatId);
  const { data } = await axios.get(url);
  const directEvents = await ical.parseICS(data);
  return Object.values(directEvents)
    .filter((event) => date === event.start?.toISOString().slice(0, 10))
    .map((event) => {
      event.block = BLOCK_TIME_ASSIGNMENT[event.start?.getHours() + (process.env.NODE_ENV === "production" ? 2 : 0)];
      return event;
    });
};

const BLOCK_TIME_ASSIGNMENT = { 8: "1. Block", 9: "2. Block", 11: "3. Block", 14: "4. Block", 15: "5. Block" };

const getAllCoursesAndFaculties = async () => {
  // Get all timetables from HS API
  const result = await axios.get("https://www.iwi.hs-karlsruhe.de/hskampus-broker/api/semesters/");
  // Build data structure faculty - course - semester
  const coursesByFaculty = result.data.reduce((result, current) => {
    // ignore entries without faculty (api specific)
    if (!current.course?.faculty?.id) {
      return result;
    }
    // map entries for course wirtschaftsinformatik --> bad designed API
    if (current.iCalFileHttpLink?.includes("WIIM")) {
      current.course.name = "Wirtschaftsinformatik (Master)";
    } else if (current.iCalFileHttpLink?.includes("WIIB")) {
      current.course.name = "Wirtschaftsinformatik (Bachelor)";
    } else if (current.iCalFileHttpLink?.includes("IIBB")) {
      current.course.name = "International IT Business (Bachelor)";
    } else if (current.iCalFileHttpLink?.includes("DSCB")) {
      return result;
    }
    // Cut length of course name because of restriction in telegraf
    current.course.name = current.course.name.slice(0, 45);
    const faculty = current.course.faculty.id;
    // Build data structure - start with faculty
    if (result[faculty]) {
      // Faculty already exists
      if (result[faculty][current.course.name]) {
        // Course already exists - e.g. Wirtschaftsinformatik
        // Ignore already added semesters
        if (
          result[faculty][current.course.name].filter((entry) => entry.semester === current.semesterNumber).length > 0
        ) {
          return result;
        }
        // Add semester to course
        result[faculty][current.course.name].push({
          id: current.id,
          semester: current.semesterNumber,
          iCalLink: current.iCalFileHttpLink,
          name: current.name,
        });
        // New course in same faculty
      } else {
        result[faculty][current.course.name] = [
          {
            id: current.id,
            semester: current.semesterNumber,
            iCalLink: current.iCalFileHttpLink,
            name: current.name,
          },
        ];
      }
    } else {
      // new faculty
      result[faculty] = {
        [current.course.name]: [
          {
            id: current.id,
            semester: current.semesterNumber,
            iCalLink: current.iCalFileHttpLink,
            name: current.name,
          },
        ],
      };
    }
    return result;
  }, {});
  const allFaculties = [
    ...new Set(
      result.data
        .reduce((result, current) => {
          try {
            result.push(current.course?.faculty.id);
          } catch (err) {}
          return result;
        }, [])
        .filter((row) => row)
    ),
  ];
  return {
    allFaculties,
    coursesByFaculty,
  };
};

const checkForBadWords = (string) => {
  return badWords.reduce((result, badWord) => {
    if (result) {
      return true;
    }
    const badWordRegex = new RegExp(badWord, "i");
    string.split(" ").forEach((word) => {
      if (badWordRegex.test(word)) {
        result = true;
      }
    });
    return result;
  }, false);
};

module.exports = {
  loadEnvVariables,
  getNews,
  getCanteenMenu,
  getCanteenNames,
  getCanteenId,
  createOrUpdate,
  arrayToMap,
  getTimetableForDate,
  getAllCoursesAndFaculties,
  getTimetableId,
  checkForBadWords,
  saveAppointmentForUser,
  checkUserExists,
  getTimetableUrl,
  getAppointments,
};
