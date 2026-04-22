# GPS Bag Tracker (NEO-M8N + SIM800L)

This project is a dashboard built for a bag tracker embedded system.

## What This Dashboard Does

- Parses incoming SMS messages and shows the location on a map.
- Draws the bag travel path as a route line.
- Shows an ALERT when the device moves outside the 20m safe reference radius.
- Keeps an SMS history log.

## No Google Key?

No problem.

- If `GOOGLE_MAPS_API_KEY` is available, the app uses Google Maps.
- If the key is empty, it automatically falls back to OpenStreetMap.
- No paid service or account is required for the fallback mode.

## Quick Start (No External Service)

1. Install and run in the project folder:

```bash
npm install
cp .env.example .env
npm start
```

2. Open in browser:

- http://localhost:3000

3. Paste an SMS into the `Quick SMS Paste` box and click `Send To Dashboard`.

## Supported SMS Formats

### 1) New Structured Format (Recommended)

```text
LAT:6.927100,LON:79.861200,STATUS:SAFE,REFLAT:6.927000,REFLON:79.861000
```

### 2) Existing Legacy Format

```text
ref loc - "80.593018","7.253505"
Your bag is missing!
```

If the message contains `bag is missing`, the status is set to ALERT.

## How To Connect With Your Existing Embedded System

### Option A (Fastest, No Twilio)

- Install an `SMS Forwarder` app on the phone receiving SMS.
- Forward incoming SMS to your local webhook using your laptop IP on the same Wi-Fi:
  - `http://<LAPTOP_IP>:3000/api/mock`
- Request body JSON format:
  - `{ "message": "<incoming_sms_text>" }`

### Option B (Manual Demo)

- Copy SMS from phone and paste it into the dashboard `Quick SMS Paste` box.

### Option C (Production Cloud)

- Twilio webhook endpoint: `POST /sms`
- Deploy to a public HTTPS URL and configure the webhook.

## Useful Endpoints

- `GET /health`
- `GET /api/status`
- `POST /api/mock` (JSON: `{ "message": "..." }`)
- `POST /sms` (Twilio form webhook)

## .env

```env
PORT=3000
SAFE_RADIUS_METERS=20
GOOGLE_MAPS_API_KEY=
```

If you do not have a Google Maps key, leave `GOOGLE_MAPS_API_KEY` empty.
