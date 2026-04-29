/**
 * Script Properties (Project settings → Script properties in the Apps Script editor):
 * - WEB_ORIGIN — e.g. https://ai-spanish-web.vercel.app (no trailing slash)
 * - SUPABASE_URL — https://<project-ref>.supabase.co
 * - SUPABASE_ANON_KEY — Supabase anon (public) key
 *
 * Flow: password grant at Supabase → GET /api/transcript?lesson=1 with Bearer token;
 * sidebar play uses GET /api/audio with same token and phrase directory from the last load.
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

/** 1-based column indexes; must stay aligned with LESSON_COLUMNS. */
var COL_NAME = LESSON_COLUMNS.indexOf("Name") + 1;
var COL_FIRST_INTRO = LESSON_COLUMNS.indexOf("First Intro") + 1;
var COL_SECOND_INTRO = LESSON_COLUMNS.indexOf("Second Intro") + 1;
var COL_ANSWER = LESSON_COLUMNS.indexOf("Answer") + 1;

/** Must match apps/web/src/app/api/audio/route.ts ALLOWED_SEGMENTS. */
var ALLOWED_AUDIO_SEGMENTS = [
  "en-first-intro",
  "en-second-intro",
  "en-question",
  "es-answer",
];

/**
 * S3 folder segment for /api/audio ?lesson= — matches packages/logic s3LessonFolderForTranscriptLessonId.
 * @param {string} transcriptLessonId e.g. "1"
 */
function s3LessonFolderForTranscriptLessonId(transcriptLessonId) {
  return "lesson" + String(transcriptLessonId || "");
}

/**
 * Values from the active row for the phrase columns shown in the sidebar.
 * @returns {{ row: number, phraseName: string, firstIntro: string, secondIntro: string, answer: string }}
 */
function getActiveRowPhrasePreview() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range) {
    return {
      row: 0,
      phraseName: "",
      firstIntro: "",
      secondIntro: "",
      answer: "",
    };
  }

  var row = range.getRow();
  var lastCol = sheet.getLastColumn();
  if (lastCol < COL_FIRST_INTRO || lastCol < COL_SECOND_INTRO || lastCol < COL_ANSWER) {
    return {
      row: row,
      phraseName: "",
      firstIntro: "",
      secondIntro: "",
      answer: "",
    };
  }

  var phraseNameCell =
    lastCol >= COL_NAME ? sheet.getRange(row, COL_NAME).getDisplayValue() : "";
  var phraseName =
    phraseNameCell != null ? String(phraseNameCell).trim() : "";

  var firstIntro = sheet.getRange(row, COL_FIRST_INTRO).getDisplayValue();
  var secondIntro = sheet.getRange(row, COL_SECOND_INTRO).getDisplayValue();
  var answer = sheet.getRange(row, COL_ANSWER).getDisplayValue();

  return {
    row: row,
    phraseName: phraseName,
    firstIntro: firstIntro != null ? String(firstIntro) : "",
    secondIntro: secondIntro != null ? String(secondIntro) : "",
    answer: answer != null ? String(answer) : "",
  };
}

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

/**
 * GET /api/audio presigned MP3 URL (requires valid Supabase Bearer token).
 * @param {string} accessToken
 * @param {number} phraseIndex 0-based phrase index
 * @param {string} segment en-first-intro | en-second-intro | en-question | es-answer
 * @param {string} transcriptLessonId e.g. "1" (mapped to lesson1 for S3)
 * @returns {{ ok: true, url: string } | { ok: false, message: string }}
 */
function getPresignedMp3Url(accessToken, phraseIndex, segment, transcriptLessonId) {
  try {
    var token =
      typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in. Load lesson from web first." };
    }

    var n =
      typeof phraseIndex === "number"
        ? phraseIndex
        : parseInt(String(phraseIndex), 10);
    if (isNaN(n) || n < 0 || n !== Math.floor(n)) {
      return { ok: false, message: "Invalid phrase index." };
    }

    var seg = typeof segment === "string" ? segment : "";
    if (!isAllowedAudioSegment(seg)) {
      return { ok: false, message: "Invalid audio segment." };
    }

    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;
    var lessonSeg = s3LessonFolderForTranscriptLessonId(lessonId);

    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }

    var audioUrl =
      cfg.webOrigin +
      "/api/audio?phrase=" +
      encodeURIComponent(String(n)) +
      "&segment=" +
      encodeURIComponent(seg) +
      "&lesson=" +
      encodeURIComponent(lessonSeg);

    var response = UrlFetchApp.fetch(audioUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();

    if (httpCode === 401) {
      return {
        ok: false,
        message:
          "Session expired or unauthorized. Use “Load lesson from web” to sign in again.",
      };
    }

    if (httpCode < 200 || httpCode >= 300) {
      var errMsg = "Audio request failed (HTTP " + httpCode + ").";
      try {
        /** @type {{ error?: string, message?: string }} */
        var errJson = JSON.parse(body);
        if (typeof errJson.error === "string" && errJson.error) {
          errMsg = errJson.error;
        } else if (typeof errJson.message === "string" && errJson.message) {
          errMsg = errJson.message;
        }
      } catch (ignore) {
        if (body && body.length > 0 && body.length < 280) {
          errMsg = body;
        }
      }
      return { ok: false, message: errMsg };
    }

    try {
      /** @type {{ url?: string }} */
      var data = JSON.parse(body);
      if (typeof data.url !== "string" || !data.url) {
        return { ok: false, message: "Audio response had no URL." };
      }
      return { ok: true, url: data.url };
    } catch (e) {
      return { ok: false, message: "Could not parse audio response." };
    }
  } catch (err) {
    return {
      ok: false,
      message:
        typeof err.message === "string" ? err.message : String(err),
    };
  }
}

function isAllowedAudioSegment(segment) {
  var i;
  for (i = 0; i < ALLOWED_AUDIO_SEGMENTS.length; i++) {
    if (ALLOWED_AUDIO_SEGMENTS[i] === segment) {
      return true;
    }
  }
  return false;
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
 * On success also returns access_token and phraseDirectory for sidebar audio + name→index lookup.
 * @param {string} email
 * @param {string} password
 * @returns {Object}
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
    /** @type {{ name: string, index: number }[]} */
    var phraseDirectory = [];

    parsed.forEach(function (phrase, loopIndex) {
      rows.push(phraseRow(phrase));

      var nameVal = "";
      var indexVal = loopIndex;
      if (phrase !== null && typeof phrase === "object") {
        if (phrase.name != null) {
          nameVal = String(phrase.name);
        }
        if (typeof phrase.index === "number" && !isNaN(phrase.index)) {
          indexVal = Math.floor(phrase.index);
        }
      }
      phraseDirectory.push({ name: nameVal, index: indexVal });
    });

    writeRowsToActiveSheet(rows);
    var count = rows.length > 1 ? rows.length - 1 : 0;
    return {
      ok: true,
      message: "Loaded " + count + " phrase(s).",
      access_token: tokenResult.access_token,
      phraseDirectory: phraseDirectory,
      transcriptLessonId: DEFAULT_TRANSCRIPT_LESSON_ID,
    };
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
