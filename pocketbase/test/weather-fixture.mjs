// Synthetic weather for the F2 tests: a deterministic daily temperature and a
// mock HTTP server that answers in the documented Open-Meteo and NASA POWER
// shapes. Nothing here is real weather data.
import { createServer } from "node:http";

const DAY = 864e5;

/** Deterministic pseudo-noise in [-1, 1] for a day key. */
function noise(day) {
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/** Synthetic mean temperature (°C) for a Tehran-like climate. */
export function temperature(day) {
  const doy = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${day.slice(0, 4)}-01-01T00:00:00Z`)) / DAY);
  return Math.round((17 + 13 * Math.sin((2 * Math.PI * (doy - 100)) / 365) + 2.5 * noise(day)) * 10) / 10;
}

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startMockWeather() {
  let requests = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/__requests") return json(200, requests);
    if (u.pathname === "/__reset") {
      requests = [];
      return json(200, {});
    }
    requests.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
    if (u.pathname === "/v1/forecast" || u.pathname === "/v1/archive") {
      const days = daysBetween(u.searchParams.get("start_date"), u.searchParams.get("end_date"));
      const t = days.map(temperature);
      return json(200, {
        latitude: Number(u.searchParams.get("latitude")),
        longitude: Number(u.searchParams.get("longitude")),
        daily: { time: days, temperature_2m_mean: t, temperature_2m_max: t.map((v) => v + 6), temperature_2m_min: t.map((v) => v - 6) },
      });
    }
    if (u.pathname === "/api/temporal/daily/point") {
      const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      const days = daysBetween(iso(u.searchParams.get("start")), iso(u.searchParams.get("end")));
      const T2M = {};
      const T2M_MAX = {};
      const T2M_MIN = {};
      days.forEach((d, i) => {
        const k = d.replace(/-/g, "");
        // The last day is "not yet available", as POWER reports with -999.
        T2M[k] = i === days.length - 1 ? -999 : temperature(d);
        T2M_MAX[k] = i === days.length - 1 ? -999 : temperature(d) + 6;
        T2M_MIN[k] = i === days.length - 1 ? -999 : temperature(d) - 6;
      });
      return json(200, { type: "Feature", properties: { parameter: { T2M, T2M_MAX, T2M_MIN } } });
    }
    json(404, {});
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
