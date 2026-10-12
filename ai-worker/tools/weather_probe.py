"""Which daily-weather APIs can this server reach? (F2 needs daily temperature.)

Run it from a terminal on the Liara app (not from your laptop) — what matters
is what Liara's network can reach. Standard library only; no data is sent
anywhere except the weather APIs. Keys are optional, read from the
environment and never printed:
    OPENWEATHER_API_KEY, WEATHERAPI_KEY, METEOSTAT_RAPIDAPI_KEY

    python3 weather_probe.py                  # Tehran
    LAT=35.73 LON=51.39 python3 weather_probe.py
"""

from __future__ import annotations

import datetime as dt
import json
import os
import ssl
import time
import urllib.error
import urllib.request

LAT = os.environ.get("LAT", "35.69")
LON = os.environ.get("LON", "51.39")
TODAY = dt.date.today()
D7 = (TODAY - dt.timedelta(days=7)).isoformat()
D1 = (TODAY - dt.timedelta(days=1)).isoformat()
YEAR_AGO = (TODAY - dt.timedelta(days=365)).isoformat()


def probe(name: str, url: str, headers: dict | None = None, pick=None, secret: str | None = None) -> dict:
    shown = url.replace(secret, "***") if secret else url
    started = time.time()
    try:
        req = urllib.request.Request(url, headers={"user-agent": "zarin-weather-probe/1", **(headers or {})})
        with urllib.request.urlopen(req, timeout=20, context=ssl.create_default_context()) as res:
            body = res.read()
            status = res.status
    except urllib.error.HTTPError as err:
        return {"source": name, "ok": False, "status": err.code, "ms": int((time.time() - started) * 1000), "url": shown}
    except Exception as err:  # noqa: BLE001 — DNS, TLS, timeout, refused: all mean "not reachable"
        return {"source": name, "ok": False, "error": f"{type(err).__name__}: {str(err)[:120]}",
                "ms": int((time.time() - started) * 1000), "url": shown}
    out = {"source": name, "ok": status == 200, "status": status, "ms": int((time.time() - started) * 1000),
           "bytes": len(body), "url": shown}
    try:
        out["sample"] = pick(json.loads(body)) if pick else None
    except Exception as err:  # noqa: BLE001
        out["sample"] = f"unparsed ({type(err).__name__})"
    return out


def main() -> None:
    results = [
        probe("open-meteo forecast (last 7 days, no key)",
              f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
              "&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTehran&past_days=7&forecast_days=1",
              pick=lambda j: dict(zip(j["daily"]["time"][-3:], j["daily"]["temperature_2m_mean"][-3:]))),
        probe("open-meteo archive (365-day backfill, no key)",
              f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}"
              f"&start_date={YEAR_AGO}&end_date={D7}&daily=temperature_2m_mean&timezone=Asia%2FTehran",
              pick=lambda j: {"days": len(j["daily"]["time"]), "first": j["daily"]["time"][0]}),
        probe("NASA POWER (daily, no key)",
              f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN&community=RE"
              f"&longitude={LON}&latitude={LAT}&start={D7.replace('-', '')}&end={D1.replace('-', '')}&format=JSON",
              pick=lambda j: dict(list(j["properties"]["parameter"]["T2M"].items())[-3:])),
    ]
    key = os.environ.get("OPENWEATHER_API_KEY")
    if key:
        results.append(probe("OpenWeatherMap current (key)",
                             f"https://api.openweathermap.org/data/2.5/weather?lat={LAT}&lon={LON}&units=metric&appid={key}",
                             pick=lambda j: {"temp": j["main"]["temp"]}, secret=key))
    key = os.environ.get("WEATHERAPI_KEY")
    if key:
        results.append(probe("WeatherAPI.com history (key)",
                             f"https://api.weatherapi.com/v1/history.json?key={key}&q={LAT},{LON}&dt={D1}",
                             pick=lambda j: {"avgtemp_c": j["forecast"]["forecastday"][0]["day"]["avgtemp_c"]}, secret=key))
    key = os.environ.get("METEOSTAT_RAPIDAPI_KEY")
    if key:
        results.append(probe("Meteostat daily via RapidAPI (key)",
                             f"https://meteostat.p.rapidapi.com/point/daily?lat={LAT}&lon={LON}&start={D7}&end={D1}",
                             headers={"x-rapidapi-key": key, "x-rapidapi-host": "meteostat.p.rapidapi.com"},
                             pick=lambda j: [(d["date"], d["tavg"]) for d in j["data"][-3:]]))
    for r in results:
        mark = "OK  " if r["ok"] else "FAIL"
        detail = r.get("sample") if r["ok"] else (r.get("error") or f"HTTP {r.get('status')}")
        print(f"{mark} {r['source']:<46} {r['ms']:>6} ms  {detail}")
    print("\nCopy these lines back into the chat (no keys are printed).")


if __name__ == "__main__":
    main()
