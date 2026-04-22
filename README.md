# GPS Bag Tracker (NEO-M8N + SIM800L)

මෙම project එක bag tracker embedded system project එකටම හදා ඇති dashboard එකක්.

## මේකෙන් මොනවා වෙන්නේද

- SMS message parse කරලා map එකේ location පෙන්වනවා.
- Bag ගිය path (route line) පෙන්වනවා.
- 20m radius reference එකෙන් එළියට ගියොත් ALERT පෙන්වනවා.
- SMS history log එක තියාගන්නවා.

## Google key නැත්තං?

කිසිම problem එකක් නෑ.

- `GOOGLE_MAPS_API_KEY` තියෙනවා නම් Google Maps use වෙනවා.
- key නැත්තං auto fallback වෙලා OpenStreetMap use වෙනවා.
- ඒකට paid service එකක් හෝ account එකක් අවශ්ය නැහැ.

## Quick Start (No External Service)

1. Project folder එකේ install/run:

```bash
npm install
cp .env.example .env
npm start
```

2. Browser open කරන්න:

- http://localhost:3000

3. Dashboard එකේ `Quick SMS Paste` box එකට message paste කරලා `Send To Dashboard` click කරන්න.

## Supported SMS Formats

### 1) New structured format (recommended)

```text
LAT:6.927100,LON:79.861200,STATUS:SAFE,REFLAT:6.927000,REFLON:79.861000
```

### 2) Existing legacy format (ඔයා දීපු එක)

```text
ref loc - "80.593018","7.253505"
Your bag is missing!
```

`bag is missing` text එක තිබ්බොත් status = ALERT වෙයි.

## Existing Embedded System එක්ක connect කරන්නේ කොහොමද

### Option A (fastest, no Twilio)

- SMS යන phone එකේ `SMS Forwarder` app එකක් install කරලා local webhook එකට forward කරන්න.
- Same Wi-Fi එකේ laptop local IP එක use කරන්න:
  - `http://<LAPTOP_IP>:3000/api/mock`
- Request body JSON format:
  - `{ "message": "<incoming_sms_text>" }`

### Option B (manual during demo)

- Phone එකෙන් SMS copy කරලා dashboard `Quick SMS Paste` box එකට paste කරන්න.

### Option C (production cloud)

- Twilio webhook: `POST /sms`
- Public HTTPS URL එකකට deploy කරලා webhook set කරන්න.

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

Google map key නැත්තං field එක empty තියාගන්න.
