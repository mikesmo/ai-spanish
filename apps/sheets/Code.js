/**
 * Script Properties (Project settings → Script properties in the Apps Script editor):
 * - WEB_ORIGIN — e.g. https://ai-spanish-web.vercel.app (no trailing slash)
 * - SUPABASE_URL — https://<project-ref>.supabase.co
 * - SUPABASE_ANON_KEY — Supabase anon (public) key
 *
 * Flow: Supabase password or refresh grant → GET /api/transcript, GET /api/audio, POST /api/lesson-audio-verify with Bearer token;
 * sidebar stores access + refresh in memory and refreshes before expiry.
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
  "Verified",
  "Max volume",
  "Avg volume",
];

/** 1-based column indexes; must stay aligned with LESSON_COLUMNS. */
var COL_NAME = LESSON_COLUMNS.indexOf("Name") + 1;
var COL_FIRST_INTRO = LESSON_COLUMNS.indexOf("First Intro") + 1;
var COL_SECOND_INTRO = LESSON_COLUMNS.indexOf("Second Intro") + 1;
var COL_ANSWER = LESSON_COLUMNS.indexOf("Answer") + 1;
var COL_VERIFIED = LESSON_COLUMNS.indexOf("Verified") + 1;
var COL_MAX_VOLUME = LESSON_COLUMNS.indexOf("Max volume") + 1;
var COL_AVG_VOLUME = LESSON_COLUMNS.indexOf("Avg volume") + 1;

/** Light yellow background for rows that fail audio verification. */
var VERIFY_ROW_FAIL_BG = "#fff9c4";

/** Must match apps/web/src/app/api/audio/route.ts ALLOWED_SEGMENTS. */
var ALLOWED_AUDIO_SEGMENTS = [
  "en-first-intro",
  "en-second-intro",
  "en-question",
  "es-answer",
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
    /** @type {{ maxVolumeDb?: unknown, avgVolumeDb?: unknown } | null} */
    var vol =
      vr && typeof vr === "object"
        ? /** @type {{ maxVolumeDb?: unknown, avgVolumeDb?: unknown }} */ (
            vr
          )
        : null;
    var maxVolCell = "";
    var avgVolCell = "";
    if (vol !== null) {
      if (
        typeof vol.maxVolumeDb === "number" &&
        !isNaN(vol.maxVolumeDb)
      ) {
        maxVolCell = vol.maxVolumeDb;
      }
      if (
        typeof vol.avgVolumeDb === "number" &&
        !isNaN(vol.avgVolumeDb)
      ) {
        avgVolCell = vol.avgVolumeDb;
      }
    }
    sheet.getRange(row, COL_MAX_VOLUME).setValue(maxVolCell);
    sheet.getRange(row, COL_AVG_VOLUME).setValue(avgVolCell);
    sheet.getRange(row, COL_VERIFIED).setValue(verified === true);
    var bg = verified === true ? null : VERIFY_ROW_FAIL_BG;
    // getRange(r,c,numRows,numColumns) — count form, not (r1,c1,r2,c2).
    sheet.getRange(row, 1, 1, targetCols).setBackground(bg);
  }
}

/**
 * Updates one spreadsheet row from a single `phrases[n]` payload entry.
 * @param {unknown} onePhrase
 * @param {{ index: number }[]} phraseDirectory
 */
function applySinglePhraseVerificationToSheet(onePhrase, phraseDirectory) {
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
  /** @type {{ maxVolumeDb?: unknown, avgVolumeDb?: unknown }} */
  var op = /** @type {{ maxVolumeDb?: unknown, avgVolumeDb?: unknown }} */ (
    onePhrase
  );
  var maxVolCell = "";
  var avgVolCell = "";
  if (typeof op.maxVolumeDb === "number" && !isNaN(op.maxVolumeDb)) {
    maxVolCell = op.maxVolumeDb;
  }
  if (typeof op.avgVolumeDb === "number" && !isNaN(op.avgVolumeDb)) {
    avgVolCell = op.avgVolumeDb;
  }
  sheet.getRange(rowNum, COL_MAX_VOLUME).setValue(maxVolCell);
  sheet.getRange(rowNum, COL_AVG_VOLUME).setValue(avgVolCell);
  sheet.getRange(rowNum, COL_VERIFIED).setValue(verified === true);
  var bg = verified === true ? null : VERIFY_ROW_FAIL_BG;
  sheet.getRange(rowNum, 1, 1, targetCols).setBackground(bg);
}

/**
 * Verifies one transcript phrase (`phraseIndex`) via POST /api/lesson-audio-verify and updates that sheet row.
 * @param {string} accessToken
 * @param {string} transcriptLessonId
 * @param {{ name: string, index: number }[]} phraseDirectory
 * @param {number} phraseIndex transcript canonical index (`Phrase.index`)
 * @returns {{ ok: boolean, verified?: boolean, clips?: unknown[], message?: string, verifyDisabled?: boolean, summary?: unknown, unauthorized?: boolean }}
 */
function verifyLessonAudioPhrase(accessToken, transcriptLessonId, phraseDirectory, phraseIndex) {
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

    var url = cfg.webOrigin + "/api/lesson-audio-verify";
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify({ lesson: lessonId, phraseIndex: pi }),
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
      applySinglePhraseVerificationToSheet(firstPg, phraseDirectory);
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
    false,
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
