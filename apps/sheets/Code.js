/**
 * Script Properties (Project settings → Script properties in the Apps Script editor):
 * - WEB_ORIGIN — e.g. https://ai-spanish-web.vercel.app (no trailing slash)
 * - SUPABASE_URL — https://<project-ref>.supabase.co
 * - SUPABASE_ANON_KEY — Supabase anon (public) key
 *
 * Flow: Supabase password or refresh grant → GET /api/transcript, GET /api/audio,
 * POST /api/lesson-audio-synthesize, POST /api/lesson-audio-verify,
 * POST /api/transcript/merge-segment with Bearer token;
 * sidebar stores access + refresh in memory and refreshes before expiry.
 */

var SCRIPT_PROP_WEB_ORIGIN = "WEB_ORIGIN";
var SCRIPT_PROP_SUPABASE_URL = "SUPABASE_URL";
var SCRIPT_PROP_SUPABASE_ANON_KEY = "SUPABASE_ANON_KEY";

var DEFAULT_TRANSCRIPT_LESSON_ID = "1";
var TRANSCRIPT_PATH =
  "/api/transcript?lesson=" + DEFAULT_TRANSCRIPT_LESSON_ID;

var LESSON_COLUMNS = [
  "Index",
  "Name",
  "Type",
  "First Intro",
  "Second Intro",
  "Question",
  "Answer",
  "Grammar",
  "Verified",
  "First Intro Max volume",
  "First Intro Avg volume",
  "Second Intro Max volume",
  "Second Intro Avg volume",
  "Answer Max volume",
  "Answer Avg volume",
  "First Intro Heard",
  "Second Intro Heard",
  "Answer Heard",
];

/** 1-based column indexes; must stay aligned with LESSON_COLUMNS. */
var COL_INDEX = LESSON_COLUMNS.indexOf("Index") + 1;
var COL_NAME = LESSON_COLUMNS.indexOf("Name") + 1;
var COL_FIRST_INTRO = LESSON_COLUMNS.indexOf("First Intro") + 1;
var COL_SECOND_INTRO = LESSON_COLUMNS.indexOf("Second Intro") + 1;
var COL_ANSWER = LESSON_COLUMNS.indexOf("Answer") + 1;
var COL_VERIFIED = LESSON_COLUMNS.indexOf("Verified") + 1;
var COL_FIRST_INTRO_MAX_VOLUME =
  LESSON_COLUMNS.indexOf("First Intro Max volume") + 1;
var COL_FIRST_INTRO_AVG_VOLUME =
  LESSON_COLUMNS.indexOf("First Intro Avg volume") + 1;
var COL_SECOND_INTRO_MAX_VOLUME =
  LESSON_COLUMNS.indexOf("Second Intro Max volume") + 1;
var COL_SECOND_INTRO_AVG_VOLUME =
  LESSON_COLUMNS.indexOf("Second Intro Avg volume") + 1;
var COL_ANSWER_MAX_VOLUME = LESSON_COLUMNS.indexOf("Answer Max volume") + 1;
var COL_ANSWER_AVG_VOLUME = LESSON_COLUMNS.indexOf("Answer Avg volume") + 1;
var COL_FIRST_INTRO_HEARD = LESSON_COLUMNS.indexOf("First Intro Heard") + 1;
var COL_SECOND_INTRO_HEARD = LESSON_COLUMNS.indexOf("Second Intro Heard") + 1;
var COL_ANSWER_HEARD = LESSON_COLUMNS.indexOf("Answer Heard") + 1;

/** Light yellow background for rows that fail audio verification. */
var VERIFY_ROW_FAIL_BG = "#fff9c4";

/** Must match apps/web/src/app/api/audio/route.ts ALLOWED_SEGMENTS. */
var ALLOWED_AUDIO_SEGMENTS = [
  "first-intro",
  "second-intro",
  "question",
  "answer",
];

/**
 * Ngrok free tier serves an HTML interstitial ("You are about to visit…") unless this header is sent.
 * Without it, UrlFetchApp receives HTML and JSON.parse throws (e.g. login / transcript load).
 * @param {string} bearerToken Supabase access token (raw, no "Bearer " prefix)
 * @returns {{ Authorization: string, "ngrok-skip-browser-warning": string }}
 */
function headersForWebOrigin(bearerToken) {
  return {
    Authorization: "Bearer " + bearerToken,
    "ngrok-skip-browser-warning": "true",
  };
}

/**
 * S3 folder segment for /api/audio ?lesson= — matches packages/logic s3LessonFolderForTranscriptLessonId.
 * @param {string} transcriptLessonId e.g. "1"
 */
function s3LessonFolderForTranscriptLessonId(transcriptLessonId) {
  return "lesson" + String(transcriptLessonId || "");
}

/**
 * Values from the active row for the phrase columns shown in the sidebar.
 * @returns {{ row: number, phraseName: string, firstIntro: string, secondIntro: string, answer: string, firstIntroHeard: string, secondIntroHeard: string, answerHeard: string }}
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
      firstIntroHeard: "",
      secondIntroHeard: "",
      answerHeard: "",
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
      firstIntroHeard: "",
      secondIntroHeard: "",
      answerHeard: "",
    };
  }

  var phraseNameCell =
    lastCol >= COL_NAME ? sheet.getRange(row, COL_NAME).getDisplayValue() : "";
  var phraseName =
    phraseNameCell != null ? String(phraseNameCell).trim() : "";

  var firstIntro = sheet.getRange(row, COL_FIRST_INTRO).getDisplayValue();
  var secondIntro = sheet.getRange(row, COL_SECOND_INTRO).getDisplayValue();
  var answer = sheet.getRange(row, COL_ANSWER).getDisplayValue();

  var firstIntroHeard = "";
  var secondIntroHeard = "";
  var answerHeard = "";
  if (lastCol >= COL_FIRST_INTRO_HEARD) {
    var fh = sheet.getRange(row, COL_FIRST_INTRO_HEARD).getDisplayValue();
    firstIntroHeard = fh != null ? String(fh) : "";
  }
  if (lastCol >= COL_SECOND_INTRO_HEARD) {
    var sh = sheet.getRange(row, COL_SECOND_INTRO_HEARD).getDisplayValue();
    secondIntroHeard = sh != null ? String(sh) : "";
  }
  if (lastCol >= COL_ANSWER_HEARD) {
    var ah = sheet.getRange(row, COL_ANSWER_HEARD).getDisplayValue();
    answerHeard = ah != null ? String(ah) : "";
  }

  return {
    row: row,
    phraseName: phraseName,
    firstIntro: firstIntro != null ? String(firstIntro) : "",
    secondIntro: secondIntro != null ? String(secondIntro) : "",
    answer: answer != null ? String(answer) : "",
    firstIntroHeard: firstIntroHeard,
    secondIntroHeard: secondIntroHeard,
    answerHeard: answerHeard,
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
 * @returns {{ ok: true, access_token: string, refresh_token: string, expires_in: number } | { ok: false, message: string }}
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
    /** @type {{ access_token?: string, refresh_token?: string, expires_in?: number }} */
    var data = JSON.parse(body);
    if (typeof data.access_token !== "string" || !data.access_token) {
      return { ok: false, message: "Sign-in response had no access token." };
    }
    if (typeof data.refresh_token !== "string" || !data.refresh_token) {
      return {
        ok: false,
        message:
          "Sign-in had no refresh token. Enable refresh tokens in Supabase Auth or use a client that returns refresh_token.",
      };
    }
    var expiresIn = 3600;
    if (typeof data.expires_in === "number" && !isNaN(data.expires_in)) {
      expiresIn = Math.floor(data.expires_in);
    }
    return {
      ok: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: expiresIn,
    };
  } catch (e) {
    return { ok: false, message: "Could not parse sign-in response." };
  }
}

/**
 * @param {string} refreshToken
 * @returns {{ ok: true, access_token: string, refresh_token: string, expires_in: number } | { ok: false, message: string }}
 */
function refreshSupabaseAccessToken(refreshToken) {
  var rt = typeof refreshToken === "string" ? refreshToken.trim() : "";
  if (!rt) {
    return { ok: false, message: "No refresh token." };
  }

  var cfg = readTranscriptConfig();
  if (cfg.ok === false) {
    return { ok: false, message: cfg.message };
  }

  var tokenUrl = cfg.supabaseUrl + "/auth/v1/token?grant_type=refresh_token";
  var payload = JSON.stringify({ refresh_token: rt });

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
    var errMsg = "Session refresh failed (HTTP " + code + ").";
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
    /** @type {{ access_token?: string, refresh_token?: string, expires_in?: number }} */
    var data = JSON.parse(body);
    if (typeof data.access_token !== "string" || !data.access_token) {
      return { ok: false, message: "Refresh response had no access token." };
    }
    var expiresIn = 3600;
    if (typeof data.expires_in === "number" && !isNaN(data.expires_in)) {
      expiresIn = Math.floor(data.expires_in);
    }
    var newRefresh =
      typeof data.refresh_token === "string" && data.refresh_token
        ? data.refresh_token
        : rt;
    return {
      ok: true,
      access_token: data.access_token,
      refresh_token: newRefresh,
      expires_in: expiresIn,
    };
  } catch (e) {
    return { ok: false, message: "Could not parse refresh response." };
  }
}

/**
 * GET /api/audio presigned MP3 URL (requires valid Supabase Bearer token).
 * @param {string} accessToken
 * @param {string} phraseName Phrase slug (e.g. "perdona"); becomes the clip stem
 * @param {string} segment first-intro | second-intro | question | answer
 * @param {string} transcriptLessonId e.g. "1" (mapped to lesson1 for S3)
 * @returns {{ ok: true, url: string } | { ok: false, message: string }}
 */
function getPresignedMp3Url(accessToken, phraseName, segment, transcriptLessonId) {
  try {
    var token =
      typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in. Load lesson from web first." };
    }

    var name =
      typeof phraseName === "string" ? phraseName.trim() : "";
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      return { ok: false, message: "Invalid phrase name." };
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
      encodeURIComponent(name) +
      "&segment=" +
      encodeURIComponent(seg) +
      "&lesson=" +
      encodeURIComponent(lessonSeg);

    var response = UrlFetchApp.fetch(audioUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: headersForWebOrigin(token),
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();

    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message:
          "Session expired or unauthorized. Sign in again or wait for refresh.",
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

/**
 * @param {unknown[]} phrasesPayload
 * @param {number} phraseIndex
 * @returns {{ phraseIndex?: number, verified?: boolean } | null}
 */
function findPhraseVerificationResult(phrasesPayload, phraseIndex) {
  if (!Array.isArray(phrasesPayload)) {
    return null;
  }
  var j;
  for (j = 0; j < phrasesPayload.length; j++) {
    var row = phrasesPayload[j];
    if (
      row &&
      typeof row === "object" &&
      typeof row.phraseIndex === "number" &&
      row.phraseIndex === phraseIndex
    ) {
      return row;
    }
  }
  return null;
}

/**
 * Sheet row (1-based) for a transcript phrase index, or null.
 * @param {{ index: number }[]} phraseDirectory
 * @param {number} phraseIndex
 * @returns {number | null}
 */
function findLessonRowNumForPhraseIndex(phraseDirectory, phraseIndex) {
  if (!Array.isArray(phraseDirectory)) {
    return null;
  }
  var i;
  for (i = 0; i < phraseDirectory.length; i++) {
    var ent = phraseDirectory[i];
    if (
      ent &&
      typeof ent.index === "number" &&
      ent.index === phraseIndex
    ) {
      return i + 2;
    }
  }
  return null;
}

/** Move sheet selection so the sidebar preview polls the verified phrase row. */
function activatePhraseLessonRow(rowNum) {
  if (
    typeof rowNum !== "number" ||
    isNaN(rowNum) ||
    rowNum < 2
  ) {
    return;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.setActiveRange(sheet.getRange(rowNum, 1));
}

/**
 * Plain clip rows for HtmlService serialization (heard STT mismatch in sidebar).
 * @param {*} onePhrase phrases[n] entry
 * @returns {{ id: string, ok: boolean, transcript: string }[]}
 */
function clipsFromPhrasePayload(onePhrase) {
  var out = [];
  if (onePhrase === null || typeof onePhrase !== "object") {
    return out;
  }
  /** @type {{ clips?: unknown }} */
  var o = /** @type {{ clips?: unknown }} */ (onePhrase);
  if (!o.clips || !(o.clips instanceof Array)) {
    return out;
  }
  var j;
  for (j = 0; j < o.clips.length; j++) {
    var c = o.clips[j];
    if (c === null || typeof c !== "object") continue;
    var id = "";
    /** @type {{ id?: unknown, ok?: unknown, transcript?: unknown }} */
    var row = /** @type {{ id?: unknown, ok?: unknown, transcript?: unknown }} */ (
      c
    );
    if (typeof row.id === "string") id = row.id;
    var okClip = row.ok === true;
    var tr = "";
    if (typeof row.transcript === "string") tr = row.transcript;
    out.push({ id: id, ok: okClip, transcript: tr });
  }
  return out;
}

/**
 * Per-clip STT mismatch text for Heard columns ([first, second, answer]).
 * @param {unknown} clips phrases[n].clips from lesson-audio-verify
 * @returns {[string, string, string]}
 */
function heardSttTextsFromPhraseClips(clips) {
  var first = "";
  var second = "";
  var ans = "";
  if (!clips || !(clips instanceof Array)) {
    return [first, second, ans];
  }
  var j;
  for (j = 0; j < clips.length; j++) {
    var c = clips[j];
    if (c === null || typeof c !== "object") continue;
    /** @type {{ id?: unknown, ok?: unknown, transcript?: unknown }} */
    var row = /** @type {{ id?: unknown, ok?: unknown, transcript?: unknown }} */ (
      c
    );
    if (row.ok === true) continue;
    var tr =
      typeof row.transcript === "string" ? row.transcript.trim() : "";
    var heardCell = tr.length > 0 ? tr : "No audio";
    var id = typeof row.id === "string" ? row.id : "";
    if (id.endsWith("-first-intro")) {
      first = heardCell;
    } else if (id.endsWith("-second-intro")) {
      second = heardCell;
    } else if (id.endsWith("-answer")) {
      ans = heardCell;
    }
  }
  return [first, second, ans];
}

/**
 * Per-clip FFmpeg loudness (maxDb/meanDb) for volume columns.
 * @param {unknown} clips phrases[n].clips from lesson-audio-verify
 * @returns {[unknown, unknown, unknown, unknown, unknown, unknown]}
 */
function volumeSixPackFromPhraseClips(clips) {
  var fiMax = "";
  var fiAvg = "";
  var siMax = "";
  var siAvg = "";
  var ansMax = "";
  var ansAvg = "";
  if (!clips || !(clips instanceof Array)) {
    return [fiMax, fiAvg, siMax, siAvg, ansMax, ansAvg];
  }
  var j;
  for (j = 0; j < clips.length; j++) {
    var c = clips[j];
    if (c === null || typeof c !== "object") continue;
    /** @type {{ id?: unknown, maxDb?: unknown, meanDb?: unknown }} */
    var row = /** @type {{ id?: unknown, maxDb?: unknown, meanDb?: unknown }} */ (
      c
    );
    var id = typeof row.id === "string" ? row.id : "";
    var mx = row.maxDb;
    var mn = row.meanDb;
    var maxVal = typeof mx === "number" && !isNaN(mx) ? mx : "";
    var meanVal = typeof mn === "number" && !isNaN(mn) ? mn : "";
    if (id.endsWith("-first-intro")) {
      fiMax = maxVal;
      fiAvg = meanVal;
    } else if (id.endsWith("-second-intro")) {
      siMax = maxVal;
      siAvg = meanVal;
    } else if (id.endsWith("-answer")) {
      ansMax = maxVal;
      ansAvg = meanVal;
    }
  }
  return [fiMax, fiAvg, siMax, siAvg, ansMax, ansAvg];
}

/**
 * Applies `phrases` from POST /api/lesson-audio-verify to the Verified column and row fill.
 * @param {unknown[]} phrasesPayload
 * @param {{ index: number }[]} phraseDirectory
 */
function applyLessonVerificationToSheet(phrasesPayload, phraseDirectory) {
  if (!Array.isArray(phraseDirectory) || phraseDirectory.length === 0) {
    return;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var targetCols = LESSON_COLUMNS.length;
  var i;
  for (i = 0; i < phraseDirectory.length; i++) {
    var row = i + 2;
    var wantIndex =
      phraseDirectory[i] && typeof phraseDirectory[i].index === "number"
        ? phraseDirectory[i].index
        : null;
    if (wantIndex === null) {
      continue;
    }
    var vr = findPhraseVerificationResult(phrasesPayload, wantIndex);
    var verified =
      vr &&
      vr.verified !== undefined &&
      vr.verified === true;
    /** @type {{ clips?: unknown } | null} */
    var vrClipsHolder =
      vr && typeof vr === "object"
        ? /** @type {{ clips?: unknown }} */ (vr)
        : null;
    var clipsArr =
      vrClipsHolder && vrClipsHolder.clips ? vrClipsHolder.clips : [];
    var volSix = volumeSixPackFromPhraseClips(clipsArr);
    sheet.getRange(row, COL_FIRST_INTRO_MAX_VOLUME).setValue(volSix[0]);
    sheet.getRange(row, COL_FIRST_INTRO_AVG_VOLUME).setValue(volSix[1]);
    sheet.getRange(row, COL_SECOND_INTRO_MAX_VOLUME).setValue(volSix[2]);
    sheet.getRange(row, COL_SECOND_INTRO_AVG_VOLUME).setValue(volSix[3]);
    sheet.getRange(row, COL_ANSWER_MAX_VOLUME).setValue(volSix[4]);
    sheet.getRange(row, COL_ANSWER_AVG_VOLUME).setValue(volSix[5]);
    var heardTriple = heardSttTextsFromPhraseClips(clipsArr);
    sheet.getRange(row, COL_FIRST_INTRO_HEARD).setValue(heardTriple[0]);
    sheet.getRange(row, COL_SECOND_INTRO_HEARD).setValue(heardTriple[1]);
    sheet.getRange(row, COL_ANSWER_HEARD).setValue(heardTriple[2]);
    sheet.getRange(row, COL_VERIFIED).setValue(verified === true);
    var bg = verified === true ? null : VERIFY_ROW_FAIL_BG;
    // getRange(r,c,numRows,numColumns) — count form, not (r1,c1,r2,c2).
    sheet.getRange(row, 1, 1, targetCols).setBackground(bg);
  }
}

/**
 * Writes Max/Avg volume + Heard for one verified clip (partial phrase verify).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNum 1-based
 * @param {unknown} clip
 */
function applySingleClipVerificationToSheetCells(sheet, rowNum, clip) {
  if (clip === null || typeof clip !== "object") {
    return;
  }
  /** @type {{ id?: unknown, ok?: unknown, transcript?: unknown, maxDb?: unknown, meanDb?: unknown }} */
  var row = clip;
  var id = typeof row.id === "string" ? row.id : "";
  var mx = row.maxDb;
  var mn = row.meanDb;
  var maxVal = typeof mx === "number" && !isNaN(mx) ? mx : "";
  var meanVal = typeof mn === "number" && !isNaN(mn) ? mn : "";
  var heard = "";
  if (row.ok !== true) {
    var tr = typeof row.transcript === "string" ? row.transcript.trim() : "";
    heard = tr.length > 0 ? tr : "No audio";
  }
  if (id.endsWith("-first-intro")) {
    sheet.getRange(rowNum, COL_FIRST_INTRO_MAX_VOLUME).setValue(maxVal);
    sheet.getRange(rowNum, COL_FIRST_INTRO_AVG_VOLUME).setValue(meanVal);
    sheet.getRange(rowNum, COL_FIRST_INTRO_HEARD).setValue(heard);
  } else if (id.endsWith("-second-intro")) {
    sheet.getRange(rowNum, COL_SECOND_INTRO_MAX_VOLUME).setValue(maxVal);
    sheet.getRange(rowNum, COL_SECOND_INTRO_AVG_VOLUME).setValue(meanVal);
    sheet.getRange(rowNum, COL_SECOND_INTRO_HEARD).setValue(heard);
  } else if (id.endsWith("-answer")) {
    sheet.getRange(rowNum, COL_ANSWER_MAX_VOLUME).setValue(maxVal);
    sheet.getRange(rowNum, COL_ANSWER_AVG_VOLUME).setValue(meanVal);
    sheet.getRange(rowNum, COL_ANSWER_HEARD).setValue(heard);
  }
}

/**
 * Updates one spreadsheet row from a single `phrases[n]` payload entry.
 * @param {unknown} onePhrase
 * @param {{ index: number }[]} phraseDirectory
 * @param {boolean=} partialApply When true, only update volume/heard cells for clips present; skip Verified and row fill.
 */
function applySinglePhraseVerificationToSheet(onePhrase, phraseDirectory, partialApply) {
  if (!Array.isArray(phraseDirectory) || phraseDirectory.length === 0) {
    return;
  }
  if (
    onePhrase === null ||
    typeof onePhrase !== "object" ||
    typeof onePhrase.phraseIndex !== "number"
  ) {
    return;
  }
  var targetPi = onePhrase.phraseIndex;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var targetCols = LESSON_COLUMNS.length;
  var i;
  var rowNum = null;
  for (i = 0; i < phraseDirectory.length; i++) {
    var ent = phraseDirectory[i];
    if (ent && typeof ent.index === "number" && ent.index === targetPi) {
      rowNum = i + 2;
      break;
    }
  }
  if (rowNum === null) {
    return;
  }
  var verified =
    onePhrase !== null &&
    typeof onePhrase === "object" &&
    typeof onePhrase.verified !== "undefined" &&
    onePhrase.verified === true;
  /** @type {{ clips?: unknown } | null} */
  var op =
    onePhrase !== null && typeof onePhrase === "object"
      ? /** @type {{ clips?: unknown }} */ (onePhrase)
      : null;
  var clipsArr = op && op.clips && op.clips instanceof Array ? op.clips : [];
  if (partialApply === true) {
    var sheetPart = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var idxClip;
    for (idxClip = 0; idxClip < clipsArr.length; idxClip++) {
      applySingleClipVerificationToSheetCells(sheetPart, rowNum, clipsArr[idxClip]);
    }
    return;
  }
  var volSix = volumeSixPackFromPhraseClips(clipsArr);
  sheet.getRange(rowNum, COL_FIRST_INTRO_MAX_VOLUME).setValue(volSix[0]);
  sheet.getRange(rowNum, COL_FIRST_INTRO_AVG_VOLUME).setValue(volSix[1]);
  sheet.getRange(rowNum, COL_SECOND_INTRO_MAX_VOLUME).setValue(volSix[2]);
  sheet.getRange(rowNum, COL_SECOND_INTRO_AVG_VOLUME).setValue(volSix[3]);
  sheet.getRange(rowNum, COL_ANSWER_MAX_VOLUME).setValue(volSix[4]);
  sheet.getRange(rowNum, COL_ANSWER_AVG_VOLUME).setValue(volSix[5]);
  var heardTriple = heardSttTextsFromPhraseClips(clipsArr);
  sheet.getRange(rowNum, COL_FIRST_INTRO_HEARD).setValue(heardTriple[0]);
  sheet.getRange(rowNum, COL_SECOND_INTRO_HEARD).setValue(heardTriple[1]);
  sheet.getRange(rowNum, COL_ANSWER_HEARD).setValue(heardTriple[2]);
  sheet.getRange(rowNum, COL_VERIFIED).setValue(verified === true);
  var bg = verified === true ? null : VERIFY_ROW_FAIL_BG;
  sheet.getRange(rowNum, 1, 1, targetCols).setBackground(bg);
}

/**
 * GET /api/transcript JSON array for duplicate-name checks.
 * @returns {{ ok: true, phrases: unknown[] } | { ok: false, message: string, unauthorized?: boolean }}
 */
function fetchTranscriptPhrasesJson(accessToken, transcriptLessonId) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }
    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;
    var url =
      cfg.webOrigin +
      "/api/transcript?lesson=" +
      encodeURIComponent(lessonId);
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: headersForWebOrigin(token),
    });
    var httpCode = response.getResponseCode();
    var body = response.getContentText();
    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Transcript request unauthorized.",
      };
    }
    if (httpCode < 200 || httpCode >= 300) {
      return {
        ok: false,
        message: "Transcript request failed (HTTP " + httpCode + ").",
      };
    }
    /** @type {unknown} */
    var parsed = JSON.parse(body);
    if (!(parsed instanceof Array)) {
      return { ok: false, message: "Transcript response was not a JSON array." };
    }
    return { ok: true, phrases: parsed };
  } catch (e) {
    return {
      ok: false,
      message: typeof e.message === "string" ? e.message : String(e),
    };
  }
}

/**
 * Lowercase slug keys that appear more than once across phrase `name` fields.
 * @param {unknown[]} phrases
 * @returns {string[]}
 */
function duplicatePhraseNameKeys(phrases) {
  if (!(phrases instanceof Array)) {
    return [];
  }
  var seen = {};
  var dup = {};
  var i;
  for (i = 0; i < phrases.length; i++) {
    var row = phrases[i];
    var raw =
      row !== null &&
      typeof row === "object" &&
      /** @type {{ name?: unknown }} */ (row).name !== undefined &&
      /** @type {{ name?: unknown }} */ (row).name !== null
        ? String(/** @type {{ name?: unknown }} */ (row).name).trim()
        : "";
    var k = raw.toLowerCase();
    if (k === "") {
      continue;
    }
    if (seen[k]) {
      dup[k] = true;
    }
    seen[k] = true;
  }
  var out = [];
  for (var key in dup) {
    if (dup.hasOwnProperty(key)) {
      out.push(key);
    }
  }
  return out;
}

/**
 * POST /api/lesson-audio-synthesize — Deepgram TTS + S3 for one clip.
 * @returns {{ ok: boolean, message?: string, synthDisabled?: boolean, unauthorized?: boolean, payload?: unknown }}
 */
function lessonAudioSynthesize(accessToken, transcriptLessonId, phraseName, segment, text) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }
    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;
    var url = cfg.webOrigin + "/api/lesson-audio-synthesize";
    var payloadObj = {
      phrase: phraseName,
      segment: segment,
      lesson: lessonId,
      text: text,
    };
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify(payloadObj),
      headers: headersForWebOrigin(token),
    });
    var httpCode = response.getResponseCode();
    var body = response.getContentText();
    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Synthesis request unauthorized.",
      };
    }
    if (httpCode === 503) {
      var msg503 = "Synthesis is not enabled on this server.";
      try {
        /** @type {{ message?: string }} */
        var j503 = JSON.parse(body);
        if (typeof j503.message === "string" && j503.message) {
          msg503 = j503.message;
        }
      } catch (e503) {
        if (body && body.length > 0 && body.length < 400) {
          msg503 = body;
        }
      }
      return { ok: false, synthDisabled: true, message: msg503 };
    }
    if (httpCode < 200 || httpCode >= 300) {
      var errSynth = "Synthesis failed (HTTP " + httpCode + ").";
      try {
        /** @type {{ message?: string }} */
        var ej = JSON.parse(body);
        if (typeof ej.message === "string" && ej.message) {
          errSynth = ej.message;
        }
      } catch (ignoreEj) {}
      return { ok: false, message: errSynth };
    }
    /** @type {{ ok?: unknown }} */
    var dataSynth = JSON.parse(body);
    return { ok: dataSynth.ok !== false, message: "", payload: dataSynth };
  } catch (es) {
    return {
      ok: false,
      message: typeof es.message === "string" ? es.message : String(es),
    };
  }
}

/**
 * POST /api/transcript/merge-segment — persist one segment into Supabase-backed transcript.
 * @returns {{ ok: boolean, message?: string, unauthorized?: boolean }}
 */
function mergeTranscriptSegment(accessToken, transcriptLessonId, phraseIndex, segment, text) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }
    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;
    var pi =
      typeof phraseIndex === "number" && !isNaN(phraseIndex)
        ? Math.floor(phraseIndex)
        : parseInt(String(phraseIndex), 10);
    if (isNaN(pi)) {
      return { ok: false, message: "Invalid phrase index." };
    }
    var url = cfg.webOrigin + "/api/transcript/merge-segment";
    var mergePayload = {
      lesson: lessonId,
      phraseIndex: pi,
      segment: segment,
      text: typeof text === "string" ? text : String(text || ""),
    };
    var responseMerge = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify(mergePayload),
      headers: headersForWebOrigin(token),
    });
    var httpMerge = responseMerge.getResponseCode();
    var bodyMerge = responseMerge.getContentText();
    if (httpMerge === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Merge transcript unauthorized.",
      };
    }
    if (httpMerge === 503) {
      return {
        ok: false,
        message: "Transcript storage not configured on server.",
      };
    }
    if (httpMerge < 200 || httpMerge >= 300) {
      var errM = "Merge transcript failed (HTTP " + httpMerge + ").";
      try {
        /** @type {{ error?: string, message?: string }} */
        var mj = JSON.parse(bodyMerge);
        if (typeof mj.error === "string" && mj.error) {
          errM = mj.error;
        } else if (typeof mj.message === "string" && mj.message) {
          errM = mj.message;
        }
      } catch (ignoreMj) {}
      return { ok: false, message: errM };
    }
    return { ok: true };
  } catch (em) {
    return {
      ok: false,
      message: typeof em.message === "string" ? em.message : String(em),
    };
  }
}

/**
 * Activates the spreadsheet row for the given transcript phrase index (sidebar Save flow).
 * @param {{ index: number }[]} phraseDirectory
 * @param {number} phraseIndex
 */
function focusLessonRowForPhraseIndex(phraseDirectory, phraseIndex) {
  try {
    if (!Array.isArray(phraseDirectory)) {
      return;
    }
    var pi =
      typeof phraseIndex === "number" && !isNaN(phraseIndex)
        ? Math.floor(phraseIndex)
        : parseInt(String(phraseIndex), 10);
    if (isNaN(pi)) {
      return;
    }
    var focusRowRecord = findLessonRowNumForPhraseIndex(phraseDirectory, pi);
    if (focusRowRecord !== null) {
      activatePhraseLessonRow(focusRowRecord);
    }
  } catch (ignoreFocus) {}
}

/**
 * Loads transcript JSON and ensures there are no duplicate phrase names (before synthesis).
 * @param {string} accessToken
 * @param {string} transcriptLessonId
 * @returns {{ ok: boolean, message?: string, unauthorized?: boolean }}
 */
function recordPhraseSavePreflight(accessToken, transcriptLessonId) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;
    var tr = fetchTranscriptPhrasesJson(token, lessonId);
    if (!tr || tr.ok !== true) {
      /** @type {{ ok?: boolean, message?: string, unauthorized?: boolean }} */
      var badTr = tr || { ok: false };
      return {
        ok: false,
        message:
          typeof badTr.message === "string"
            ? badTr.message
            : "Could not load transcript.",
        unauthorized: badTr.unauthorized === true,
      };
    }
    var phrasesArr = tr.phrases instanceof Array ? tr.phrases : [];
    var dupKeys = duplicatePhraseNameKeys(phrasesArr);
    if (dupKeys.length > 0) {
      return {
        ok: false,
        message:
          "Duplicate phrase names in lesson transcript (fix in DB): " +
          dupKeys.join(", "),
      };
    }
    return { ok: true };
  } catch (ePre) {
    return {
      ok: false,
      message:
        typeof ePre.message === "string" ? ePre.message : String(ePre),
    };
  }
}

/**
 * Record flow: duplicate-name check → POST synthesize → verify with sheet overrides → merge segment if verified.
 * @param {string} firstIntro
 * @param {string} secondIntro
 * @param {string} answer
 * @returns {{ ok: boolean, verified?: boolean, clips?: unknown[], mergeSaved?: boolean, message?: string, synthDisabled?: boolean, verifyDisabled?: boolean, summary?: unknown, unauthorized?: boolean }}
 */
function recordPhraseSegment(
  accessToken,
  transcriptLessonId,
  phraseDirectory,
  phraseIndex,
  phraseName,
  segment,
  firstIntro,
  secondIntro,
  answer
) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    if (!(phraseDirectory instanceof Array)) {
      return { ok: false, message: "Missing phrase directory." };
    }
    var pi =
      typeof phraseIndex === "number" && !isNaN(phraseIndex)
        ? Math.floor(phraseIndex)
        : parseInt(String(phraseIndex), 10);
    if (isNaN(pi)) {
      return { ok: false, message: "Invalid phrase index." };
    }
    var name = typeof phraseName === "string" ? phraseName.trim() : "";
    var seg = typeof segment === "string" ? segment.trim() : "";
    if (seg !== "first-intro" && seg !== "second-intro" && seg !== "answer") {
      return { ok: false, message: "Invalid segment for save." };
    }
    var fi = firstIntro != null ? String(firstIntro) : "";
    var si = secondIntro != null ? String(secondIntro) : "";
    var ans = answer != null ? String(answer) : "";
    var textBody = fi;
    if (seg === "second-intro") {
      textBody = si;
    }
    if (seg === "answer") {
      textBody = ans;
    }
    if (String(textBody).trim().length === 0) {
      return {
        ok: false,
        message: "Cell text for this segment is empty; nothing to synthesize.",
      };
    }

    var focusRowRecord = findLessonRowNumForPhraseIndex(phraseDirectory, pi);
    if (focusRowRecord !== null) {
      activatePhraseLessonRow(focusRowRecord);
    }

    var pre = recordPhraseSavePreflight(token, transcriptLessonId);
    if (!pre || pre.ok !== true) {
      /** @type {{ ok?: boolean, message?: string, unauthorized?: boolean }} */
      var badPre = pre || { ok: false };
      return {
        ok: false,
        message:
          typeof badPre.message === "string"
            ? badPre.message
            : "Could not load transcript.",
        unauthorized: badPre.unauthorized === true,
      };
    }

    var synth = lessonAudioSynthesize(token, transcriptLessonId, name, seg, textBody);
    if (!synth || synth.ok !== true) {
      /** @type {{ ok?: boolean, message?: string, synthDisabled?: boolean, unauthorized?: boolean }} */
      var badSynth = synth || { ok: false };
      return {
        ok: false,
        message:
          typeof badSynth.message === "string"
            ? badSynth.message
            : "Synthesis failed.",
        synthDisabled: badSynth.synthDisabled === true,
        unauthorized: badSynth.unauthorized === true,
      };
    }

    /** @type {Record<string, string>} */
    var overrides = {};
    overrides[name + "-" + seg] = textBody;

    var vr = verifyLessonAudioPhrase(
      token,
      transcriptLessonId,
      phraseDirectory,
      pi,
      overrides,
      [seg]
    );
    if (!vr || vr.ok !== true) {
      /** @type {{ ok?: boolean, message?: string, verifyDisabled?: boolean, unauthorized?: boolean }} */
      var badV = vr || { ok: false };
      return {
        ok: false,
        message:
          typeof badV.message === "string"
            ? badV.message
            : "Verification failed.",
        verifyDisabled: badV.verifyDisabled === true,
        unauthorized: badV.unauthorized === true,
      };
    }

    var mergedOk = true;
    var mergeMsg = "";
    if (vr.verified === true) {
      var mr = mergeTranscriptSegment(token, transcriptLessonId, pi, seg, textBody);
      mergedOk = mr && mr.ok === true;
      mergeMsg = mr && typeof mr.message === "string" ? mr.message : "";
      if (!mergedOk) {
        return {
          ok: false,
          verified: true,
          clips: vr.clips,
          mergeSaved: false,
          message:
            (mergeMsg || "Could not save transcript to database.") +
            " Audio was verified.",
        };
      }
    }

    return {
      ok: true,
      verified: vr.verified === true,
      clips: vr.clips,
      mergeSaved: vr.verified === true && mergedOk === true,
      message:
        vr.verified === true
          ? mergedOk
            ? ""
            : mergeMsg
          : vr.message || "Some clips failed verification.",
      summary: vr.summary,
    };
  } catch (errRec) {
    return {
      ok: false,
      message:
        typeof errRec.message === "string" ? errRec.message : String(errRec),
    };
  }
}

/**
 * Verifies one transcript phrase (`phraseIndex`) via POST /api/lesson-audio-verify and updates that sheet row.
 * @param {string} accessToken
 * @param {string} transcriptLessonId
 * @param {{ name: string, index: number }[]} phraseDirectory
 * @param {number} phraseIndex transcript canonical index (`Phrase.index`)
 * @param {Record<string, string>=} clipExpectedTextOverrides optional clip id → expected STT text (sheet cells)
 * @param {string[]=} partialSegments when non-empty, verify only these segments (`first-intro`, etc.) and partial sheet apply.
 * @returns {{ ok: boolean, verified?: boolean, clips?: unknown[], message?: string, verifyDisabled?: boolean, summary?: unknown, unauthorized?: boolean }}
 */
function verifyLessonAudioPhrase(
  accessToken,
  transcriptLessonId,
  phraseDirectory,
  phraseIndex,
  clipExpectedTextOverrides,
  partialSegments
) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    if (!Array.isArray(phraseDirectory)) {
      return { ok: false, message: "Missing phrase directory." };
    }
    var pi =
      typeof phraseIndex === "number" && !isNaN(phraseIndex)
        ? Math.floor(phraseIndex)
        : parseInt(String(phraseIndex), 10);
    if (isNaN(pi)) {
      return { ok: false, message: "Invalid phrase index." };
    }

    var focusRowNum = findLessonRowNumForPhraseIndex(phraseDirectory, pi);
    if (focusRowNum !== null) {
      activatePhraseLessonRow(focusRowNum);
    }

    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }

    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;

    var partialApply =
      partialSegments instanceof Array && partialSegments.length > 0;

    var url = cfg.webOrigin + "/api/lesson-audio-verify";
    /** @type {{ lesson: string, phraseIndex: number, clipExpectedTextOverrides?: Record<string, string>, segments?: string[] }} */
    var payloadVerify = {
      lesson: lessonId,
      phraseIndex: pi,
    };
    if (
      clipExpectedTextOverrides !== undefined &&
      clipExpectedTextOverrides !== null &&
      typeof clipExpectedTextOverrides === "object"
    ) {
      payloadVerify.clipExpectedTextOverrides = clipExpectedTextOverrides;
    }
    if (partialApply) {
      payloadVerify.segments = partialSegments;
    }
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify(payloadVerify),
      headers: headersForWebOrigin(token),
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();

    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Verification request unauthorized. Session may have expired.",
      };
    }

    if (httpCode === 503) {
      var msg503b = "Verification is not available on this server.";
      try {
        /** @type {{ message?: string, code?: string }} */
        var j503b = JSON.parse(body);
        if (typeof j503b.message === "string" && j503b.message) {
          msg503b = j503b.message;
        }
      } catch (e503b) {
        if (body && body.length > 0 && body.length < 400) {
          msg503b = body;
        }
      }
      return { ok: false, verifyDisabled: true, message: msg503b };
    }

    if (httpCode < 200 || httpCode >= 300) {
      var errMsgPhrase = "Verification failed (HTTP " + httpCode + ").";
      try {
        /** @type {{ message?: string, error?: string }} */
        var errJsonPhrase = JSON.parse(body);
        if (typeof errJsonPhrase.message === "string" && errJsonPhrase.message) {
          errMsgPhrase = errJsonPhrase.message;
        } else if (typeof errJsonPhrase.error === "string" && errJsonPhrase.error) {
          errMsgPhrase = errJsonPhrase.error;
        }
      } catch (parsePhraseErr) {
        if (body && body.length > 0 && body.length < 280) {
          errMsgPhrase = body;
        }
      }
      return { ok: false, message: errMsgPhrase };
    }

    /** @type {{ ok?: boolean, phrases?: unknown[], summary?: unknown }} */
    var dataPhrase = JSON.parse(body);
    var phrasesPhrase =
      dataPhrase && Array.isArray(dataPhrase.phrases) ? dataPhrase.phrases : [];
    if (phrasesPhrase.length >= 1) {
      /** @type {unknown} */
      var firstPg = phrasesPhrase[0];
      applySinglePhraseVerificationToSheet(firstPg, phraseDirectory, partialApply);
      var phraseVerifiedRow =
        firstPg !== null &&
        typeof firstPg === "object" &&
        /** @type {{ verified?: unknown }} */ (firstPg).verified === true;
      /** @type {unknown[]} */
      var sidebarClips =
        clipsFromPhrasePayload(firstPg);
      return {
        ok: dataPhrase.ok !== false,
        verified: phraseVerifiedRow === true,
        clips: sidebarClips,
        message:
          phraseVerifiedRow === true
            ? ""
            : "Some clips failed for this phrase.",
        summary: dataPhrase.summary,
      };
    }

    return {
      ok: dataPhrase.ok !== false,
      verified: false,
      clips: [],
      message: "No phrase payload returned.",
      summary: dataPhrase.summary,
    };
  } catch (e) {
    return {
      ok: false,
      message: typeof e.message === "string" ? e.message : String(e),
    };
  }
}

/**
 * Runs lesson audio verification against the web API (local Next + ngrok when enabled).
 * @param {string} accessToken
 * @param {string} transcriptLessonId
 * @param {{ name: string, index: number }[]} phraseDirectory
 * @returns {{ ok: boolean, message?: string, verifyDisabled?: boolean, summary?: unknown, unauthorized?: boolean }}
 */
function verifyLessonAudio(accessToken, transcriptLessonId, phraseDirectory) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }
    if (!Array.isArray(phraseDirectory)) {
      return { ok: false, message: "Missing phrase directory." };
    }

    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }

    var lessonId =
      typeof transcriptLessonId === "string" && transcriptLessonId
        ? transcriptLessonId
        : DEFAULT_TRANSCRIPT_LESSON_ID;

    var url = cfg.webOrigin + "/api/lesson-audio-verify";
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify({ lesson: lessonId }),
      headers: headersForWebOrigin(token),
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();

    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Verification request unauthorized. Session may have expired.",
      };
    }

    if (httpCode === 503) {
      var msg503 = "Verification is not available on this server.";
      try {
        /** @type {{ message?: string, code?: string }} */
        var j503 = JSON.parse(body);
        if (typeof j503.message === "string" && j503.message) {
          msg503 = j503.message;
        }
      } catch (e503) {
        if (body && body.length > 0 && body.length < 400) {
          msg503 = body;
        }
      }
      return { ok: false, verifyDisabled: true, message: msg503 };
    }

    if (httpCode < 200 || httpCode >= 300) {
      var errMsg = "Verification failed (HTTP " + httpCode + ").";
      try {
        /** @type {{ message?: string, error?: string }} */
        var errJson = JSON.parse(body);
        if (typeof errJson.message === "string" && errJson.message) {
          errMsg = errJson.message;
        } else if (typeof errJson.error === "string" && errJson.error) {
          errMsg = errJson.error;
        }
      } catch (parseErr) {
        if (body && body.length > 0 && body.length < 280) {
          errMsg = body;
        }
      }
      return { ok: false, message: errMsg };
    }

    /** @type {{ ok?: boolean, phrases?: unknown[], summary?: unknown }} */
    var data = JSON.parse(body);
    if (data && Array.isArray(data.phrases)) {
      applyLessonVerificationToSheet(data.phrases, phraseDirectory);
    }
    return {
      ok: data.ok !== false,
      message: data.ok ? "Verification finished." : "Some clips failed verification.",
      summary: data.summary,
      phrases: Array.isArray(data.phrases) ? data.phrases : [],
    };
  } catch (e) {
    return {
      ok: false,
      message: typeof e.message === "string" ? e.message : String(e),
    };
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
 * Fetches transcript with Bearer token, writes sheet, returns phrase directory (no auth fields).
 * @param {string} accessToken
 * @returns {{ ok: true, message: string, phraseDirectory: { name: string, index: number }[], transcriptLessonId: string } | { ok: false, message: string, unauthorized?: boolean }}
 */
function importLessonTranscriptWithToken(accessToken) {
  try {
    var token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) {
      return { ok: false, message: "Not signed in." };
    }

    var cfg = readTranscriptConfig();
    if (cfg.ok === false) {
      return { ok: false, message: cfg.message };
    }

    var transcriptUrl = cfg.webOrigin + TRANSCRIPT_PATH;
    var response = UrlFetchApp.fetch(transcriptUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: headersForWebOrigin(token),
    });

    var httpCode = response.getResponseCode();
    var body = response.getContentText();
    if (httpCode === 401) {
      return {
        ok: false,
        unauthorized: true,
        message: "Transcript request unauthorized. Session may have expired.",
      };
    }
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
      rows.push(phraseRow(phrase, loopIndex));

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
 * Re-import lesson using an existing access token (no password).
 * @param {string} accessToken
 * @returns {Object}
 */
function reloadLessonWithAccessToken(accessToken) {
  return importLessonTranscriptWithToken(accessToken);
}

/**
 * Signs in with Supabase (email + password), imports lesson 1 transcript into the sheet.
 * Returns tokens + phraseDirectory for the sidebar.
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

    var importResult = importLessonTranscriptWithToken(tokenResult.access_token);
    if (!importResult.ok) {
      return {
        ok: false,
        message: importResult.message,
        unauthorized: importResult.unauthorized === true,
      };
    }

    return {
      ok: true,
      message: importResult.message,
      access_token: tokenResult.access_token,
      refresh_token: tokenResult.refresh_token,
      expires_in: tokenResult.expires_in,
      phraseDirectory: importResult.phraseDirectory,
      transcriptLessonId: importResult.transcriptLessonId,
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
 * @param {number} loopIndex fallback transcript index when phrase.index is missing
 */
function phraseRow(phrase, loopIndex) {
  if (phrase === null || typeof phrase !== "object") {
    throw new Error("Invalid phrase entry (not an object)");
  }
  var indexCell =
    typeof phrase.index === "number" && !isNaN(phrase.index)
      ? Math.floor(phrase.index)
      : loopIndex;
  const en = phrase.English || {};
  const es = phrase.Spanish || {};
  var typeCell = phrase.type === undefined ? "" : phrase.type;
  return [
    indexCell,
    phrase.name ?? "",
    typeCell,
    en["first-intro"] ?? "",
    en["second-intro"] ?? "",
    en.question ?? "",
    es.answer ?? "",
    es.grammar ?? "",
    false,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

/**
 * Build a dense N×M JavaScript matrix for Range#setValues—every row exists and has length M.
 * Fixes "The data has X but the range has Y" when the source array is sparse or jagged.
 * @param {unknown[][]} rows2d
 * @param {number} columnCount
 * @returns {unknown[][]}
 */
function rectangularRowsForSetValues(rows2d, columnCount) {
  var out = [];
  var ri;
  for (ri = 0; ri < rows2d.length; ri++) {
    var src = rows2d[ri];
    if (!src || !(src instanceof Array)) {
      src = [];
    }
    var line = [];
    var verifiedColCi = COL_VERIFIED - 1;
    var ci;
    for (ci = 0; ci < columnCount; ci++) {
      var isDataRow = ri > 0;
      var padVerified = isDataRow ? false : "";
      var val;
      if (ci >= src.length) {
        line.push(ci === verifiedColCi ? padVerified : "");
      } else {
        val = src[ci];
        if (val === undefined || val === null) {
          line.push(ci === verifiedColCi ? padVerified : "");
        } else {
          line.push(val);
        }
      }
    }
    out.push(line);
  }
  return out;
}

function writeRowsToActiveSheet(rows) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var targetCols = LESSON_COLUMNS.length;
  var rectangular = rectangularRowsForSetValues(rows, targetCols);
  var targetRows = rectangular.length;

  var prevLastRow = sheet.getLastRow();
  var prevLastCol = sheet.getLastColumn();
  var clearRows = Math.max(prevLastRow, targetRows);
  var clearCols = Math.max(prevLastCol, targetCols);
  if (clearRows >= 1 && clearCols >= 1) {
    sheet.getRange(1, 1, clearRows, clearCols).clearContent();
  }

  if (targetRows >= 1) {
    // Sheet#getRange(row, col, numRows, numColumns): 3rd/4th are sizes, not end row/col.
    sheet.getRange(1, 1, targetRows, targetCols).setValues(rectangular);
    sheet.getRange(1, 1, 1, targetCols).setFontWeight("bold");
    if (targetRows > 1) {
      var phraseRowCount = targetRows - 1;
      sheet.getRange(2, 1, phraseRowCount, targetCols).setFontWeight("normal");
      var dataRg = sheet.getRange(2, 1, phraseRowCount, targetCols);
      dataRg.setBackground(null);
      if (COL_VERIFIED >= 1) {
        var verifiedCol = sheet.getRange(2, COL_VERIFIED, phraseRowCount, 1);
        var falses = [];
        var r;
        for (r = 0; r < phraseRowCount; r++) {
          falses.push([false]);
        }
        verifiedCol.setValues(falses);
        verifiedCol.insertCheckboxes();
        verifiedCol.setValues(falses);
      }
    }
  }
}
