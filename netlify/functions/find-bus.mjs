import AdmZip from 'adm-zip';

const GTFS_URL = 'https://www.dart.org/transitdata/latest/google_transit.zip';
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null;

export default async (request) => {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const checkin = url.searchParams.get('checkin');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(checkin || '')) {
      return json({ error: 'Choose a valid work date and check-in time.' }, 400);
    }

    const gtfs = await getGtfs();
    const ymd = date.replaceAll('-', '');
    const activeServices = servicesForDate(gtfs.calendar, gtfs.calendarDates, ymd);
    if (!activeServices.size) return json({ error: 'DART has no scheduled service in the current feed for that date.' }, 404);

    const routeIds = new Set(gtfs.routes.filter(r => normalizeRoute(r.route_short_name) === '5').map(r => r.route_id));
    if (!routeIds.size) throw new Error('Route 5 was not found in DART’s current GTFS feed.');

    const tripIds = new Set(gtfs.trips.filter(t => routeIds.has(t.route_id) && activeServices.has(t.service_id)).map(t => t.trip_id));
    if (!tripIds.size) return json({ error: 'No Route 5 trips are scheduled for that date.' }, 404);

    const originIds = new Set(rankStops(gtfs.stops, 'origin').map(s => s.stop_id));
    const destinationIds = new Set(rankStops(gtfs.stops, 'destination').map(s => s.stop_id));
    if (!originIds.size || !destinationIds.size) throw new Error('Could not locate the Love Field stops in DART’s current GTFS feed.');

    const byTrip = new Map();
    for (const st of gtfs.stopTimes) {
      if (!tripIds.has(st.trip_id)) continue;
      if (!originIds.has(st.stop_id) && !destinationIds.has(st.stop_id)) continue;
      if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
      byTrip.get(st.trip_id).push(st);
    }

    const options = [];
    for (const [tripId, rows] of byTrip) {
      rows.sort((a,b) => Number(a.stop_sequence) - Number(b.stop_sequence));
      for (let i=0;i<rows.length;i++) {
        if (!originIds.has(rows[i].stop_id)) continue;
        const dest = rows.slice(i+1).find(r => destinationIds.has(r.stop_id));
        if (!dest) continue;
        const departure = rows[i].departure_time || rows[i].arrival_time;
        const arrival = dest.arrival_time || dest.departure_time;
        if (!departure || !arrival) continue;
        options.push({tripId, departure, arrival, arrMinutes: gtfsMinutes(arrival)});
        break;
      }
    }

    const checkinMinutes = clockMinutes(checkin);
    const qualifying = options.filter(x => x.arrMinutes < checkinMinutes).sort((a,b) => b.arrMinutes - a.arrMinutes);
    if (qualifying.length < 2) {
      return json({ error: qualifying.length === 1 ? 'Only one Route 5 arrival is scheduled before that check-in; your second-latest safety-margin trip does not exist.' : 'No Route 5 arrivals are scheduled before that check-in.' }, 404);
    }

    const chosen = qualifying[1];
    const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',timeZone:'America/Chicago'});
    return json({
      departure: toClock(chosen.departure),
      arrival: toClock(chosen.arrival),
      bufferMinutes: checkinMinutes - chosen.arrMinutes,
      serviceLabel: `${dayName} service`,
      feedStart: gtfs.feedStart,
      feedEnd: gtfs.feedEnd,
      source: GTFS_URL
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'I could not read DART’s current schedule just now. Try again in a moment or use the official DART schedule link.' }, 502);
  }
};

async function getGtfs() {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache;
  const response = await fetch(GTFS_URL, { headers: { 'User-Agent': 'Bus-to-Work/2.0' } });
  if (!response.ok) throw new Error(`DART GTFS download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = new AdmZip(buffer);
  const read = name => {
    const entry = zip.getEntry(name);
    if (!entry) return [];
    return parseCsv(entry.getData().toString('utf8'));
  };
  const feedInfo = read('feed_info.txt')[0] || {};
  const calendar = read('calendar.txt');
  const ranges = calendar.map(x => [x.start_date,x.end_date]).filter(x => x[0] && x[1]);
  const rawStart = feedInfo.feed_start_date || ranges.map(x=>x[0]).sort()[0] || '';
  const rawEnd = feedInfo.feed_end_date || ranges.map(x=>x[1]).sort().at(-1) || '';
  cache = {
    loadedAt: Date.now(), routes: read('routes.txt'), trips: read('trips.txt'), stops: read('stops.txt'),
    stopTimes: read('stop_times.txt'), calendar, calendarDates: read('calendar_dates.txt'),
    feedStart: prettyYmd(rawStart), feedEnd: prettyYmd(rawEnd)
  };
  return cache;
}

function servicesForDate(calendar, calendarDates, ymd) {
  const d = new Date(`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}T12:00:00-05:00`);
  const key = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
  const active = new Set(calendar.filter(r => r.start_date <= ymd && r.end_date >= ymd && r[key] === '1').map(r => r.service_id));
  for (const ex of calendarDates.filter(r => r.date === ymd)) {
    if (ex.exception_type === '1') active.add(ex.service_id);
    if (ex.exception_type === '2') active.delete(ex.service_id);
  }
  return active;
}

function rankStops(stops, kind) {
  const scored = stops.map(s => {
    const n = (s.stop_name || '').toLowerCase().replace(/[^a-z0-9]+/g,' ');
    let score = 0;
    if (kind === 'origin') {
      if (n.includes('inwood')) score += 4;
      if (n.includes('love field')) score += 4;
      if (n.includes('station')) score += 2;
    } else {
      if (n.includes('love field')) score += 4;
      if (n.includes('airport')) score += 4;
      if (n.includes('baggage')) score += 3;
      if (n.includes('claim')) score += 2;
    }
    return { ...s, score };
  });
  const threshold = kind === 'origin' ? 8 : 8;
  return scored.filter(s => s.score >= threshold);
}

function normalizeRoute(v='') { const n=String(v).trim(); return /^0*5$/.test(n)?'5':n; }
function clockMinutes(v) { const [h,m]=v.split(':').map(Number); return h*60+m; }
function gtfsMinutes(v) { const [h,m]=v.split(':').map(Number); return h*60+m; }
function toClock(v) { const [h,m]=v.split(':').map(Number); return `${String(h%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function prettyYmd(v='') { return /^\d{8}$/.test(v) ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : ''; }
function json(body,status=200){ return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}); }

function parseCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  const pushField=()=>{row.push(field);field=''};
  const pushRow=()=>{if(row.length||field){pushField();rows.push(row)}row=[]};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){ if(c==='"'&&text[i+1]==='"'){field+='"';i++} else if(c==='"'){quoted=false} else field+=c; }
    else { if(c==='"')quoted=true; else if(c===',')pushField(); else if(c==='\n')pushRow(); else if(c!=='\r')field+=c; }
  }
  if(row.length||field)pushRow();
  if(!rows.length)return[];
  const headers=rows.shift().map((h,i)=>i===0?h.replace(/^\uFEFF/,''):h);
  return rows.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
