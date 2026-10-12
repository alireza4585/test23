import 'dart:math' as math;

import 'energy_analysis.dart';
import 'energy_reading.dart';

/// Occupancy-normalised baseline for the offline demo backend — the same
/// method as the server's (consumption ≈ b0 + b1·occupied + b2·Friday,
/// Guideline 14 statistics, 3·RMSE outliers dropped once) without the annual
/// season terms, which need a year of history.
class EnergyDay {
  const EnergyDay(this.day, this.consumption, this.occupied);

  final DateTime day;
  final double consumption;
  final int occupied;
}

List<double> _x(EnergyDay d) => [1, d.occupied.toDouble(), d.day.weekday == DateTime.friday ? 1 : 0];

List<double>? _solve(List<EnergyDay> rows) {
  const p = 3;
  final a = List.generate(p, (_) => List<double>.filled(p + 1, 0));
  for (final r in rows) {
    final x = _x(r);
    for (var i = 0; i < p; i++) {
      for (var j = 0; j < p; j++) {
        a[i][j] += x[i] * x[j];
      }
      a[i][p] += x[i] * r.consumption;
    }
  }
  for (var i = 1; i < p; i++) {
    a[i][i] += 1e-6;
  }
  for (var c = 0; c < p; c++) {
    var piv = c;
    for (var r = c + 1; r < p; r++) {
      if (a[r][c].abs() > a[piv][c].abs()) piv = r;
    }
    if (a[piv][c].abs() < 1e-12) return null;
    final t = a[c];
    a[c] = a[piv];
    a[piv] = t;
    for (var r = 0; r < p; r++) {
      if (r == c) continue;
      final f = a[r][c] / a[c][c];
      for (var k = c; k <= p; k++) {
        a[r][k] -= f * a[c][k];
      }
    }
  }
  return [for (var i = 0; i < p; i++) a[i][p] / a[i][i]];
}

double _predict(List<double> coef, EnergyDay d) {
  final x = _x(d);
  return math.max(0, coef[0] * x[0] + coef[1] * x[1] + coef[2] * x[2]);
}

/// Fits on [history] and measures [period]; null baseline under 28 days.
EnergyAnalysis analyzeEnergyLocally({
  required EnergyType type,
  required DateTime from,
  required DateTime to,
  required List<EnergyDay> history,
  required List<EnergyDay> period,
  required double tariff,
  double? emissionKgPerKwh,
  String? emissionSource,
}) {
  final total = period.fold<double>(0, (s, d) => s + d.consumption);
  final occupied = period.fold<int>(0, (s, d) => s + d.occupied);
  final carbon = type == EnergyType.electricity && emissionKgPerKwh != null ? total * emissionKgPerKwh : null;
  final base = EnergyAnalysis(
    type: type,
    from: from,
    to: to,
    total: total,
    perOccupiedRoom: occupied > 0 ? total / occupied : null,
    cost: total * tariff,
    costPerOccupiedRoom: occupied > 0 ? total * tariff / occupied : null,
    carbonKg: carbon,
    carbonPerOccupiedRoomKg: carbon != null && occupied > 0 ? carbon / occupied : null,
    emissionFactorSource: carbon != null ? emissionSource : null,
  );
  if (history.length < 28) return base;
  var rows = [...history];
  var coef = _solve(rows);
  if (coef == null) return base;
  double rmseOf(List<double> c, List<EnergyDay> rs) =>
      math.sqrt(rs.fold<double>(0, (s, r) => s + math.pow(r.consumption - _predict(c, r), 2)) / math.max(1, rs.length - 3));
  final rmse0 = rmseOf(coef, rows);
  final kept = rows.where((r) => (r.consumption - _predict(coef!, r)).abs() <= 3 * rmse0).toList();
  if (kept.length >= 28 && kept.length < rows.length) {
    final c2 = _solve(kept);
    if (c2 != null) {
      coef = c2;
      rows = kept;
    }
  }
  final c = coef;
  final mean = rows.fold<double>(0, (s, r) => s + r.consumption) / rows.length;
  final rmse = rmseOf(c, rows);
  final bias = rows.fold<double>(0, (s, r) => s + r.consumption - _predict(c, r));
  final cvrmse = mean > 0 ? rmse / mean * 100 : double.infinity;
  final valid = cvrmse <= 25;
  rows.sort((a, b) => a.day.compareTo(b.day));
  var cusum = 0.0;
  var expectedTotal = 0.0;
  final measured = <MeasuredDay>[];
  for (final d in [...period]..sort((a, b) => a.day.compareTo(b.day))) {
    final e = _predict(c, d);
    cusum += d.consumption - e;
    expectedTotal += e;
    measured.add(MeasuredDay(day: d.day, actual: d.consumption, expected: e, cusum: cusum, occupied: d.occupied));
  }
  final savings = expectedTotal - total;
  final uncertainty = 1.96 * rmse * math.sqrt(math.max(1, measured.length));
  return EnergyAnalysis(
    type: type,
    from: from,
    to: to,
    baseline: BaselineStats(
      valid: valid,
      cvrmse: cvrmse,
      nmbe: mean > 0 ? bias / (math.max(1, rows.length - 3) * mean) * 100 : 0,
      n: rows.length,
      from: rows.first.day,
      to: rows.last.day,
      perOccupiedRoom: c[1],
      fixedPerDay: c[0],
    ),
    days: measured,
    savings: measured.isEmpty ? null : savings,
    uncertainty: measured.isEmpty ? null : uncertainty,
    significant: valid && measured.isNotEmpty && savings.abs() > uncertainty,
    total: base.total,
    perOccupiedRoom: base.perOccupiedRoom,
    cost: base.cost,
    costPerOccupiedRoom: base.costPerOccupiedRoom,
    carbonKg: base.carbonKg,
    carbonPerOccupiedRoomKg: base.carbonPerOccupiedRoomKg,
    emissionFactorSource: base.emissionFactorSource,
  );
}
