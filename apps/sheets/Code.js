/**
 * Script Properties (Project settings → Script properties in the Apps Script editor):
 * - WEB_ORIGIN — e.g. https://ai-spanish-web.vercel.app (no trailing slash)
 * - SUPABASE_URL — https://<project-ref>.supabase.co
 * - SUPABASE_ANON_KEY — Supabase anon (public) key
 *
 * Flow: password grant at Supabase → GET /api/transcript?lesson=1 with Bearer token.
 */

var SCRIPT_PROP_WEB_ORIGIN = "WEB_ORIGIN";
var SCRIPT_PROP_SUPABASE_URL = "SUPABASE_URL";
var SCRIPT_PROP_SUPABASE_ANON_KEY = "SUPABASE_ANON_KEY";

var DEFAULT_TRANSCRIPT_LESSON_ID = "1";
var TRANSCRIPT_PATH =
  "/api/transcript?lesson=" + DEFAULT_TRANSCRIPT_LESSON_ID;

var LESSON_COLUMNS = [
  "Name",
  "Type",
  "First Intro",
  "Second Intro",
  "Question",
  "Answer",
  "Grammar",
];

/**
 * @returns {{ webOrigin: string, supabaseUrl: string, anonKey: string } | { ok: false, message: string }}
 */
function readTranscriptConfig() {
  var props = PropertiesService.getScriptProperties();
  var webOrigin = (props.getProperty(SCRIPT_PROP_WEB_ORIGIN) || "").trim();
  var supabaseUrl = (props.getProperty(SCRIPT_PROP_SUPABASE_URL) || "").trim();
  var anonKey = (props.getProperty(SCRIPT_PROP_SUPABASE_ANON_KEY) || "").trim();

  if (!webOrigin || !supabaseUrl || !anonKey) {
    var missing = [];
    if (!webOrigin) missing.push(SCRIPT_PROP_WEB_ORIGIN);
    if (!supabaseUrl) missing.push(SCRIPT_PROP_SUPABASE_URL);
    if (!anonKey) missing.push(SCRIPT_PROP_SUPABASE_ANON_KEY);
    return {
      ok: false,
      message:
        "Missing Script Properties: " +
        missing.join(", ") +
        ". Set them under Project settings → Script properties.",
    };
  }

  while (webOrigin.length > 0 && webOrigin.charAt(webOrigin.length - 1) === "/") {
    webOrigin = webOrigin.slice(0, -1);
  }
  while (
    supabaseUrl.length > 0 &&
    supabaseUrl.charAt(supabaseUrl.length - 1) === "/"
  ) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }

  return { webOrigin: webOrigin, supabaseUrl: supabaseUrl, anonKey: anonKey };
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {{ ok: true, access_token: string } | { ok: false, message: string }}
 */
function fetchSupabaseAccessToken(email, password) {
  var cfg = readTranscriptConfig();
  if (cfg.ok === false) {
    return { ok: false, message: cfg.message };
  }

  var tokenUrl =
    cfg.supabaseUrl + "/auth/v1/token?grant_type=password";
  var payload = JSON.stringify({
    email: email,
    password: password,
  });

  var response = UrlFetchApp.fetch(tokenUrl, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: payload,
    headers: {
      apikey: cfg.anonKey,
      Authorization: "Bearer " + cfg.anonKey,
    },
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code < 200 || code >= 300) {
    var errMsg = "Sign-in failed (HTTP " + code + ").";
    try {
      /** @type {{ error_description?: string, msg?: string, message?: string }} */
      var errJson = JSON.parse(body);
      if (typeof errJson.error_description === "string" && errJson.error_description) {
        errMsg = errJson.error_description;
      } else if (typeof errJson.msg === "string" && errJson.msg) {
        errMsg = errJson.msg;
      } else if (typeof errJson.message === "string" && errJson.message) {
        errMsg = errJson.message;
      }
    } catch (parseErr) {
      if (body && body.length > 0 && body.length < 400) {
        errMsg = body;
      }
    }
    return { ok: false, message: errMsg };
  }

  try {
    /** @type {{ access_token?: string }} */
    var data = JSON.parse(body);
    if (typeof data.access_token !== "string" || !data.access_token) {
      return { ok: false, message: "Sign-in response had no access token." };
    }
    return { ok: true, access_token: data.access_token };
  } catch (e) {
    return { ok: false, message: "Could not parse sign-in response." };
  }
}

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
 * Signs in with Supabase (email + password), fetches lesson 1 from /api/transcript, writes the sheet.
 * @param {string} email
 * @param {string} password
 * @returns {{ ok: boolean, message: string }}
 */
function populateLessonFromJson(email, password) {
  try {
    var trimmedEmail = typeof email === "string" ? email.trim() : "";
    var pwd = typeof password === "string" ? password : "";
    if (!trimmedEmail || !pwd) {
      return { ok: false, message: "Email and password are required." };
    }

    var tokenResult = fetchSupabaseAccessToken(trimmedEmail, pwd);
    if (!tokenResult.ok) {
      return { ok: false, message: tokenResult.message };
    }

    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }

    var transcriptUrl = cfg.webOrigin + TRANSCRIPT_PATH;
    var response = UrlFetchApp.fetch(transcriptUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        Authorization: "Bearer " + tokenResult.access_token,
      },
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();
    if (httpCode < 200 || httpCode >= 300) {
      return {
        ok: false,
        message:
          "Transcript request failed HTTP " +
          httpCode +
          ": " +
          body.slice(0, 280),
      };
    }

    /** @type {unknown} */
    var parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        message: "Expected a JSON array of phrases",
      };
    }

    var rows = [LESSON_COLUMNS];
    parsed.forEach(function (phrase) {
      rows.push(phraseRow(phrase));
    });

    writeRowsToActiveSheet(rows);
    var count = rows.length > 1 ? rows.length - 1 : 0;
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
