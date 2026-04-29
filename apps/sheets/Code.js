/** @deprecated Static `{origin}/lesson1.json` was removed; lesson JSON is auth-only via `/api/transcript`. Point this URL only if you restore a public mirror — otherwise this sheet action will fail at runtime. */
const LESSON1_JSON_URL = "https://ai-spanish-web.vercel.app/lesson1.json";

const LESSON_COLUMNS = [
  "Name",
  "Type",
  "First Intro",
  "Second Intro",
  "Question",
  "Answer",
  "Grammar",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("AI Spanish")
    .addItem("Open Sidebar", "showSidebar")
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("sidebar")
    .setTitle("AI Spanish");
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Fetches lesson JSON from LESSON1_JSON_URL (legacy static path; see deprecation on LESSON1_JSON_URL).
 * Returns a plain object for google.script.run (success/error).
 */
function populateLessonFromJson() {
  try {
    const response = UrlFetchApp.fetch(LESSON1_JSON_URL, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        message: "Fetch failed HTTP " + code + ": " + body.slice(0, 280),
      };
    }

    /** @type {unknown} */
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        message: "Expected a JSON array of phrases",
      };
    }

    const rows = [LESSON_COLUMNS];
    parsed.forEach(function (phrase) {
      rows.push(phraseRow(phrase));
    });

    writeRowsToActiveSheet(rows);
    const count = rows.length > 1 ? rows.length - 1 : 0;
    return { ok: true, message: "Loaded " + count + " phrase(s)." };
  } catch (e) {
    return {
      ok: false,
      message:
        typeof e.message === "string" ? e.message : String(e),
    };
  }
}

/**
 * @param {*} phrase phrase object from lesson JSON (words omitted when flattening Spanish)
 */
function phraseRow(phrase) {
  if (phrase === null || typeof phrase !== "object") {
    throw new Error("Invalid phrase entry (not an object)");
  }
  const en = phrase.English || {};
  const es = phrase.Spanish || {};
  var typeCell = phrase.type === undefined ? "" : phrase.type;
  return [
    phrase.name ?? "",
    typeCell,
    en["first-intro"] ?? "",
    en["second-intro"] ?? "",
    en.question ?? "",
    es.answer ?? "",
    es.grammar ?? "",
  ];
}

function writeRowsToActiveSheet(rows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const targetRows = rows.length;
  const targetCols = LESSON_COLUMNS.length;

  var prevLastRow = sheet.getLastRow();
  var prevLastCol = sheet.getLastColumn();
  var clearRows = Math.max(prevLastRow, targetRows);
  var clearCols = Math.max(prevLastCol, targetCols);
  if (clearRows >= 1 && clearCols >= 1) {
    sheet.getRange(1, 1, clearRows, clearCols).clearContent();
  }

  if (targetRows >= 1) {
    sheet.getRange(1, 1, targetRows, targetCols).setValues(rows);
    sheet.getRange(1, 1, 1, targetCols).setFontWeight("bold");
    if (targetRows > 1) {
      sheet.getRange(2, 1, targetRows, targetCols).setFontWeight("normal");
    }
  }
}
