#!/bin/sh
# Same check as weather_probe.py for terminals without Python (curl or wget).
# Run on the Liara app's terminal:  sh weather-probe.sh   (LAT/LON optional)
LAT="${LAT:-35.69}"; LON="${LON:-51.39}"
probe() {
  name="$1"; url="$2"
  if command -v curl >/dev/null 2>&1; then
    out=$(curl -sS -m 20 -o /tmp/zw.$$ -w "%{http_code} %{time_total}s" "$url" 2>&1)
  elif command -v wget >/dev/null 2>&1; then
    if wget -q -T 20 -O /tmp/zw.$$ "$url" 2>/dev/null; then out="200"; else out="FAILED (wget)"; fi
  else
    echo "neither curl nor wget is installed"; exit 1
  fi
  printf '%-40s %s  %s\n' "$name" "$out" "$(head -c 160 /tmp/zw.$$ 2>/dev/null | tr '\n' ' ')"
  rm -f /tmp/zw.$$
}
probe "open-meteo forecast (no key)" "https://api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&daily=temperature_2m_mean&timezone=Asia%2FTehran&past_days=3&forecast_days=1"
probe "open-meteo archive (no key)" "https://archive-api.open-meteo.com/v1/archive?latitude=$LAT&longitude=$LON&start_date=2026-01-01&end_date=2026-01-03&daily=temperature_2m_mean"
probe "NASA POWER (no key)" "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=RE&longitude=$LON&latitude=$LAT&start=20260101&end=20260103&format=JSON"
echo; echo "Copy these lines back into the chat."
