import 'dart:math' as math;

import '../../../core/utils/day_key.dart';
import 'forecast.dart';

/// "Same weekday last week" forecast with a rolling backtest — the benchmark
/// model of the server, used by the offline demo backend. Needs 5 weeks of
/// history, like the server.
SeriesForecast naiveForecast(
  ForecastSeries series,
  Map<DateTime, double> history, {
  required DateTime today,
  int horizon = 28,
  double? min,
  double? max,
}) {
  final days = history.keys.toList()..sort();
  if (days.isEmpty) return SeriesForecast(run: ForecastRun(series: series, ok: false, reason: 'no_data'));
  final first = days.first;
  final last = days.last;
  final values = <double>[];
  for (final d in DayKey.range(first, last)) {
    values.add(history[d] ?? (values.length >= 7 ? values[values.length - 7] : 0));
  }
  if (values.length < 35) {
    return SeriesForecast(run: ForecastRun(series: series, ok: false, reason: 'insufficient_history', trainedTo: last));
  }
  if (DayKey.startOfDay(today).difference(last).inDays > 8) {
    return SeriesForecast(run: ForecastRun(series: series, ok: false, reason: 'stale_data', trainedTo: last));
  }
  double clamp(double v) => v.clamp(min ?? double.negativeInfinity, max ?? double.infinity).toDouble();
  // Backtest: 8 origins a week apart, 14 days ahead.
  final errors = <double>[];
  final pct = <double>[];
  for (var o = values.length - 14, n = 0; o >= 28 && n < 8; o -= 7, n++) {
    for (var k = 0; k < 14; k++) {
      final f = values[o - 7 + (k % 7)];
      final a = values[o + k];
      errors.add((a - f).abs());
      if (a != 0) pct.add((a - f).abs() / a.abs());
    }
  }
  errors.sort();
  final q80 = errors.isEmpty ? 0.0 : errors[math.min(errors.length - 1, (errors.length * 0.8).floor())];
  final mae = errors.isEmpty ? null : errors.reduce((a, b) => a + b) / errors.length;
  final mape = pct.isEmpty ? null : pct.reduce((a, b) => a + b) / pct.length * 100;
  final points = [
    for (var k = 1; k <= horizon; k++)
      () {
        final v = clamp(values[values.length - 7 + ((k - 1) % 7)]);
        final w = k <= 14 ? q80 : q80 * math.sqrt(k / 14);
        return ForecastPoint(day: DateTime(last.year, last.month, last.day + k), value: v, lower: clamp(v - w), upper: clamp(v + w));
      }(),
  ];
  final score = ModelScore(model: ForecastModel.seasonalNaive, mae: mae, mape: mape);
  return SeriesForecast(
    run: ForecastRun(series: series, ok: true, model: ForecastModel.seasonalNaive, scores: [score], trainedTo: last, generatedAt: today),
    points: points,
  );
}
