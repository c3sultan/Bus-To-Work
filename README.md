# Bus to Work — Version 2

A small mobile-first PWA for choosing a DART Route 5 Love Link trip from Inwood/Love Field Station to Dallas Love Field Airport.

## What Version 2 adds

- Defaults the work date to **tomorrow** every time the app opens.
- Defaults check-in to **06:00 AM**.
- Retrieves DART's latest official static GTFS schedule from `https://www.dart.org/transitdata/latest/google_transit.zip`.
- Uses GTFS calendar/calendar_dates data, including date-specific service exceptions.
- Finds Route 5 trips from Inwood/Love Field Station to Love Field Airport (Baggage Claims).
- Selects the **second-latest scheduled arrival before check-in**.
- Shows departure, airport arrival, buffer, and DART GTFS feed effective date range directly in the app.
- Remains installable as a PWA on Android.

## Netlify

This repository is ready for Netlify. Netlify reads `netlify.toml`, publishes the `public` folder, and deploys the serverless function in `netlify/functions`.

No DART API key is required for the static GTFS schedule feed used by this version.

## Important

Scheduled transit times can change and delays happen. The app displays scheduled GTFS data, not a guarantee of actual arrival. DART recommends arriving at the stop at least 5 minutes before the scheduled departure.
