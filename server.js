const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SAFE_RADIUS_METERS = Number(process.env.SAFE_RADIUS_METERS || 20);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const MAX_HISTORY_POINTS = 2000;
const MAX_SMS_LOGS = 50;

let referencePoint = null;
let latestState = null;
const pathHistory = [];
const smsLogs = [];

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseNumberByKey(message, key) {
  const regex = new RegExp(`${key}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
  const match = message.match(regex);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatus(message) {
  const match = message.match(/STATUS\s*[:=]\s*([A-Z_]+)/i);
  if (!match) return null;
  return String(match[1]).toUpperCase();
}

function parseLegacyAlertStatus(message) {
  return /bag\s+is\s+missing|missing/i.test(message) ? "ALERT" : null;
}

function parseLegacyRefLoc(message) {
  const match = message.match(
    /ref\s*loc\s*-\s*"?(-?\d+(?:\.\d+)?)"?\s*[, ]+\s*"?(-?\d+(?:\.\d+)?)"?/i
  );
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  // Legacy REF LOC payload is usually "longitude,latitude".
  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
    return { lat: second, lon: first };
  }

  if (Math.abs(second) <= 180 && Math.abs(first) <= 90) {
    return { lat: first, lon: second };
  }

  return { lat: second, lon: first };
}

function parseReferenceCompact(message) {
  const match = message.match(/REF\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const refLat = Number(match[1]);
  const refLon = Number(match[2]);
  if (!Number.isFinite(refLat) || !Number.isFinite(refLon)) return null;

  return { refLat, refLon };
}

function parseSmsBody(message) {
  const body = String(message || "").trim();
  if (!body) return null;

  const lat = parseNumberByKey(body, "LAT");
  const lon = parseNumberByKey(body, "LON");
  const refLat = parseNumberByKey(body, "REFLAT");
  const refLon = parseNumberByKey(body, "REFLON");
  const status = parseStatus(body) || parseLegacyAlertStatus(body);
  const compactRef = parseReferenceCompact(body);
  const legacyRefLoc = parseLegacyRefLoc(body);

  const finalLat = Number.isFinite(lat) ? lat : legacyRefLoc?.lat ?? null;
  const finalLon = Number.isFinite(lon) ? lon : legacyRefLoc?.lon ?? null;

  const finalRefLat = refLat ?? compactRef?.refLat ?? null;
  const finalRefLon = refLon ?? compactRef?.refLon ?? null;

  if (!Number.isFinite(finalLat) || !Number.isFinite(finalLon)) {
    return null;
  }

  return {
    lat: finalLat,
    lon: finalLon,
    status,
    refLat: finalRefLat,
    refLon: finalRefLon,
    raw: body,
  };
}

function isPlaceholderOnlyText(text) {
  const normalized = String(text || "").trim();
  return /^(%mb%|%message%|%body%|\{messageBody\}|\{message\}|\{body\})$/i.test(normalized);
}

function extractMockIncomingText(req) {
  const candidateKeys = ["message", "messageBody", "Body", "body", "text", "sms", "content", "payload"];

  if (typeof req.body === "string") {
    return req.body;
  }

  if (req.body && typeof req.body === "object") {
    for (const key of candidateKeys) {
      const value = req.body[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    const allStringValues = Object.values(req.body).filter(
      (value) => typeof value === "string" && value.trim()
    );

    const likelySms = allStringValues.find((value) => /ref\s*loc|lat\s*[:=]|lon\s*[:=]|missing/i.test(value));
    if (likelySms) {
      return likelySms;
    }

    if (allStringValues.length === 1) {
      return allStringValues[0];
    }
  }

  if (typeof req.query?.message === "string" && req.query.message.trim()) {
    return req.query.message;
  }

  return "";
}

function extractTwilioIncomingText(req) {
  if (typeof req.body?.Body === "string" && req.body.Body.trim()) return req.body.Body;
  if (typeof req.body?.body === "string" && req.body.body.trim()) return req.body.body;
  if (typeof req.body?.message === "string" && req.body.message.trim()) return req.body.message;
  if (typeof req.body?.messageBody === "string" && req.body.messageBody.trim()) return req.body.messageBody;
  return "";
}

function updateAlertSignalState(message, source) {
  const normalizedStatus = parseStatus(message) || parseLegacyAlertStatus(message);
  if (normalizedStatus !== "ALERT") {
    return { recognized: false, updated: false, state: null };
  }

  const latestPoint = pathHistory.length ? pathHistory[pathHistory.length - 1] : null;

  const fallbackLat = Number.isFinite(latestState?.lat)
    ? latestState.lat
    : Number.isFinite(latestPoint?.lat)
      ? latestPoint.lat
      : Number.isFinite(referencePoint?.lat)
        ? referencePoint.lat
        : null;

  const fallbackLon = Number.isFinite(latestState?.lon)
    ? latestState.lon
    : Number.isFinite(latestPoint?.lon)
      ? latestPoint.lon
      : Number.isFinite(referencePoint?.lon)
        ? referencePoint.lon
        : null;

  if (!Number.isFinite(fallbackLat) || !Number.isFinite(fallbackLon)) {
    return { recognized: true, updated: false, state: latestState };
  }

  latestState = {
    source,
    lat: fallbackLat,
    lon: fallbackLon,
    reportedStatus: "ALERT",
    status: "ALERT",
    outOfRange: latestState?.outOfRange ?? null,
    safeRadiusMeters: SAFE_RADIUS_METERS,
    distanceFromReferenceMeters: latestState?.distanceFromReferenceMeters ?? null,
    referencePoint,
    updatedAt: new Date().toISOString(),
    totalPathPoints: pathHistory.length,
    rawMessage: String(message || ""),
    signalOnly: true,
  };

  return { recognized: true, updated: true, state: latestState };
}

function upsertSmsLog(entry) {
  smsLogs.unshift(entry);
  if (smsLogs.length > MAX_SMS_LOGS) {
    smsLogs.length = MAX_SMS_LOGS;
  }
}

function updateTrackerState(parsedData, source) {
  if (Number.isFinite(parsedData.refLat) && Number.isFinite(parsedData.refLon)) {
    referencePoint = { lat: parsedData.refLat, lon: parsedData.refLon };
  }

  const point = {
    lat: parsedData.lat,
    lon: parsedData.lon,
    timestamp: new Date().toISOString(),
  };

  pathHistory.push(point);
  if (pathHistory.length > MAX_HISTORY_POINTS) {
    pathHistory.shift();
  }

  let distanceFromReferenceMeters = null;
  let outOfRange = null;

  if (referencePoint) {
    distanceFromReferenceMeters = haversineMeters(
      parsedData.lat,
      parsedData.lon,
      referencePoint.lat,
      referencePoint.lon
    );
    outOfRange = distanceFromReferenceMeters > SAFE_RADIUS_METERS;
  }

  const computedStatus = outOfRange == null ? "UNKNOWN" : outOfRange ? "ALERT" : "SAFE";

  latestState = {
    source,
    lat: parsedData.lat,
    lon: parsedData.lon,
    reportedStatus: parsedData.status || null,
    status: computedStatus === "UNKNOWN" ? parsedData.status || computedStatus : computedStatus,
    outOfRange,
    safeRadiusMeters: SAFE_RADIUS_METERS,
    distanceFromReferenceMeters,
    referencePoint,
    updatedAt: point.timestamp,
    totalPathPoints: pathHistory.length,
    rawMessage: parsedData.raw,
  };

  return latestState;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/config", (req, res) => {
  res.json({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    safeRadiusMeters: SAFE_RADIUS_METERS,
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    latestState,
    history: pathHistory,
    smsLogs,
  });
});

app.post("/api/mock", (req, res) => {
  const incomingText = extractMockIncomingText(req);

  if (isPlaceholderOnlyText(incomingText)) {
    upsertSmsLog({
      source: "api-mock",
      receivedAt: new Date().toISOString(),
      parsed: false,
      body: String(incomingText || ""),
      reason: "placeholder-not-expanded",
    });

    return res.status(400).json({
      ok: false,
      error:
        "Received placeholder text only (%mb% / {messageBody}). Configure SMS forwarder to send the actual SMS content.",
    });
  }

  const parsed = parseSmsBody(incomingText);
  const alertSignal = updateAlertSignalState(incomingText, "api-mock");

  if (!parsed) {
    if (alertSignal.recognized) {
      upsertSmsLog({
        source: "api-mock",
        receivedAt: new Date().toISOString(),
        parsed: true,
        body: String(incomingText || ""),
        reason: alertSignal.updated ? "alert-signal-only" : "alert-signal-no-location",
      });

      return res.json({
        ok: true,
        latestState: alertSignal.state,
        note: alertSignal.updated
          ? "Alert signal recognized without coordinates. Last known location kept."
          : "Alert signal recognized but no known location available yet.",
      });
    }

    upsertSmsLog({
      source: "api-mock",
      receivedAt: new Date().toISOString(),
      parsed: false,
      body: String(incomingText || ""),
      reason: "unrecognized-format",
    });

    return res.status(400).json({
      ok: false,
      error: "Invalid message format. Send LAT/LON data or an ALERT text such as 'Your bag is missing!'.",
    });
  }

  const state = updateTrackerState(parsed, "api-mock");
  upsertSmsLog({
    source: "api-mock",
    receivedAt: new Date().toISOString(),
    parsed: true,
    body: parsed.raw,
  });

  return res.json({ ok: true, latestState: state });
});

app.post("/sms", (req, res) => {
  const incomingText = extractTwilioIncomingText(req);
  const parsed = parseSmsBody(incomingText);
  const alertSignal = updateAlertSignalState(incomingText, "twilio");

  if (!parsed) {
    if (alertSignal.recognized) {
      upsertSmsLog({
        source: "twilio",
        receivedAt: new Date().toISOString(),
        parsed: true,
        body: String(incomingText || ""),
        reason: alertSignal.updated ? "alert-signal-only" : "alert-signal-no-location",
      });

      return res.type("text/xml").send("<Response></Response>");
    }

    upsertSmsLog({
      source: "twilio",
      receivedAt: new Date().toISOString(),
      parsed: false,
      body: String(incomingText),
      reason: "unrecognized-format",
    });

    return res.type("text/xml").send("<Response></Response>");
  }

  updateTrackerState(parsed, "twilio");
  upsertSmsLog({
    source: "twilio",
    receivedAt: new Date().toISOString(),
    parsed: true,
    body: parsed.raw,
  });

  return res.type("text/xml").send("<Response></Response>");
});

app.listen(PORT, () => {
  console.log(`GPS tracker server running on http://localhost:${PORT}`);
});
