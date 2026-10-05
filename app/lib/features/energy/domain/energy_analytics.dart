import '../../../core/utils/day_key.dart';
import '../../operations/domain/daily_operations.dart';
import 'energy_reading.dart';

class EnergyPoint {
  const EnergyPoint(this.day, this.value);

  final DateTime day;
  final double value;
}

class EnergySummary {
  const EnergySummary({
    required this.type,
    required this.total,
    required this.previousTotal,
    required this.previousDailyAverage,
    required this.dailyAverage,
    required this.baseline,
    required this.series,
    required this.anomalies,
    this.perOccupiedRoom,
    this.estimatedCost,
  });

  final EnergyType type;
  final double total;
  final double previousTotal;

  /// Average over the days actually recorded in the previous period.
  final double previousDailyAverage;
  final double dailyAverage;
  final double baseline;
  final List<EnergyPoint> series;

  /// Days whose consumption exceeded the baseline by more than the threshold.
  final List<EnergyPoint> anomalies;

  /// Energy intensity: consumption per occupied room-night (hospitality KPI).
  final double? perOccupiedRoom;
  final double? estimatedCost;

  /// Change of the daily average vs the previous period of equal length, in
  /// percent. Averages (not totals) keep partially recorded periods honest.
  double? get changePct => previousDailyAverage <= 0
      ? null
      : (dailyAverage - previousDailyAverage) / previousDailyAverage * 100;

  /// Deviation of the daily average from baseline, in percent.
  double? get vsBaselinePct =>
      baseline <= 0 ? null : (dailyAverage - baseline) / baseline * 100;
}

/// Pure analytics over energy readings. Shared by the energy screen,
/// executive dashboard, reports and the demo AI analyst — and mirrored by the
/// server-side analytics engine (`functions/src/analytics`).
abstract final class EnergyAnalytics {
  static EnergySummary summarize({
    required EnergyType type,
    required List<EnergyReading> readings,
    required DateTime from,
    required DateTime to,
    required double baseline,
    required double alertThresholdPct,
    double? tariff,
    List<DailyOperations> operations = const [],
  }) {
    final days = DayKey.range(from, to);
    final byDay = <String, double>{};
    final prevByDay = <String, double>{};
    final periodLength = days.length;
    final prevFrom = DayKey.startOfDay(from).subtract(Duration(days: periodLength));

    for (final r in readings.where((r) => r.type == type)) {
      final d = DayKey.startOfDay(r.day);
      if (!d.isBefore(DayKey.startOfDay(from)) && !d.isAfter(DayKey.startOfDay(to))) {
        byDay.update(DayKey.of(d), (v) => v + r.consumption, ifAbsent: () => r.consumption);
      } else if (!d.isBefore(prevFrom) && d.isBefore(DayKey.startOfDay(from))) {
        prevByDay.update(DayKey.of(d), (v) => v + r.consumption, ifAbsent: () => r.consumption);
      }
    }

    final series = [
      for (final d in days) EnergyPoint(d, byDay[DayKey.of(d)] ?? 0),
    ];
    final recorded = series.where((p) => byDay.containsKey(DayKey.of(p.day)));
    final total = recorded.fold<double>(0, (s, p) => s + p.value);
    final previousTotal = prevByDay.values.fold<double>(0, (s, v) => s + v);
    final previousDailyAverage =
        prevByDay.isEmpty ? 0.0 : previousTotal / prevByDay.length;
    final dailyAverage = recorded.isEmpty ? 0.0 : total / recorded.length;

    final limit = baseline * (1 + alertThresholdPct / 100);
    final anomalies = [
      for (final p in recorded)
        if (baseline > 0 && p.value > limit) p,
    ];

    final occupiedNights = operations
        .where((o) => byDay.containsKey(DayKey.of(o.day)))
        .fold<int>(0, (s, o) => s + o.roomsOccupied);

    return EnergySummary(
      type: type,
      total: total,
      previousTotal: previousTotal,
      previousDailyAverage: previousDailyAverage,
      dailyAverage: dailyAverage,
      baseline: baseline,
      series: series,
      anomalies: anomalies,
      perOccupiedRoom: occupiedNights > 0 ? total / occupiedNights : null,
      estimatedCost: tariff == null ? null : total * tariff,
    );
  }
}
