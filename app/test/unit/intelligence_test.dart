import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/data/insight_json.dart';
import 'package:zarin_hooshmand/data/pocketbase/pb_intelligence_repositories.dart';
import 'package:zarin_hooshmand/features/ai/domain/ai_models.dart';
import 'package:zarin_hooshmand/features/calendar/domain/calendar_event.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_baseline.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_reading.dart';
import 'package:zarin_hooshmand/features/forecast/domain/forecast.dart';
import 'package:zarin_hooshmand/features/forecast/domain/naive_forecaster.dart';

void main() {
  group('Iran fixed holidays', () {
    test('match the server calendar (Nowruz 1405, 12/13 Farvardin, Khordad, Esfand)', () {
      final days = iranFixedHolidays(DateTime(2026, 3, 1), DateTime(2026, 6, 30)).map((e) => e.day).toList();
      expect(days, [
        DateTime(2026, 3, 20),
        DateTime(2026, 3, 21), DateTime(2026, 3, 22), DateTime(2026, 3, 23), DateTime(2026, 3, 24),
        DateTime(2026, 4, 1), DateTime(2026, 4, 2),
        DateTime(2026, 6, 4), DateTime(2026, 6, 5),
      ]);
      expect(iranFixedHolidays(DateTime(2026, 2, 1), DateTime(2026, 2, 28)).single.day, DateTime(2026, 2, 11));
    });
  });

  group('naive forecaster (demo backend)', () {
    final start = DateTime(2026, 1, 4);
    Map<DateTime, double> history(int days) => {
      for (var i = 0; i < days; i++) DateTime(2026, 1, 4 + i): const [40.0, 42.0, 41.0, 43.0, 55.0, 60.0, 45.0][i % 7],
    };

    test('needs five weeks and recent data', () {
      expect(naiveForecast(ForecastSeries.occupancy, history(20), today: DateTime(2026, 1, 25)).run.reason, 'insufficient_history');
      expect(naiveForecast(ForecastSeries.occupancy, history(40), today: DateTime(2026, 3, 30)).run.reason, 'stale_data');
      expect(naiveForecast(ForecastSeries.occupancy, const {}, today: start).run.reason, 'no_data');
    });

    test('repeats last week with a backtested range', () {
      final f = naiveForecast(ForecastSeries.occupancy, history(60), today: DateTime(2026, 3, 5), min: 0, max: 100);
      expect(f.run.ok, isTrue);
      expect(f.run.model, ForecastModel.seasonalNaive);
      expect(f.points, hasLength(28));
      expect(f.points.first.day, DateTime(2026, 3, 5));
      expect(f.points.first.value, history(60)[DateTime(2026, 2, 26)]);
      expect(f.run.chosen!.mae, 0); // a perfectly weekly series
    });
  });

  group('energy baseline (demo backend)', () {
    final history = [
      for (var i = 0; i < 60; i++)
        EnergyDay(DateTime(2025, 11, 1 + i), 1500 + 18.0 * (30 + (i * 7) % 20) + (i % 3 - 1) * 20, 30 + (i * 7) % 20),
    ];

    test('fits occupancy with Guideline 14 statistics and measures savings', () {
      final period = [for (var i = 0; i < 14; i++) EnergyDay(DateTime(2026, 1, 1 + i), (1500 + 18.0 * 40) * 0.9, 40)];
      final a = analyzeEnergyLocally(
        type: EnergyType.electricity, from: DateTime(2026, 1, 1), to: DateTime(2026, 1, 14),
        history: history, period: period, tariff: 3000, emissionKgPerKwh: 0.494, emissionSource: 'test',
      );
      expect(a.baseline!.valid, isTrue);
      expect(a.baseline!.cvrmse, lessThan(5));
      expect(a.baseline!.perOccupiedRoom, closeTo(18, 1));
      expect(a.savings, greaterThan(0));
      expect(a.significant, isTrue);
      expect(a.days.last.cusum, closeTo(-a.savings!, 1));
      expect(a.carbonKg, closeTo(a.total! * 0.494, 0.01));
    });

    test('has no baseline under 28 days', () {
      final a = analyzeEnergyLocally(
        type: EnergyType.water, from: DateTime(2026, 1, 1), to: DateTime(2026, 1, 2),
        history: history.take(10).toList(), period: const [], tariff: 1,
      );
      expect(a.baseline, isNull);
      expect(a.carbonKg, isNull);
    });
  });

  group('server JSON', () {
    test('expected impact and evaluation', () {
      final impact = expectedImpactFromJson({'metric': 'checkoutCleanMinutes', 'unit': 'min', 'baseline': 44.6, 'expected': 35, 'method': 'durationAvg'});
      expect(impact!.method, 'durationAvg');
      expect(impact.expected, 35);
      final ev = evaluationFromJson({
        'status': 'evaluated', 'method': 'energyBaseline', 'unit': 'kWh', 'baseline': 30000, 'actual': 27000,
        'delta': 3000, 'improved': true, 'monthlyIrr': 19000000, 'limitations': ['x'],
        'window': {'afterFrom': '2026-01-02', 'afterTo': '2026-01-15'},
      });
      expect(ev!.status, EvaluationStatus.evaluated);
      expect(ev.improved, isTrue);
      expect(ev.afterTo, '2026-01-15');
      expect(evaluationFromJson({'status': 'weird'}), isNull);
      expect(expectedImpactFromJson(null), isNull);
    });

    test('energy analysis', () {
      final a = energyAnalysisFromJson(EnergyType.electricity, DateTime(2026, 9, 7), DateTime(2026, 10, 6), {
        'baseline': {'valid': true, 'cvrmse': 8.18, 'nmbe': 0, 'n': 333, 'from': '2025-10-07', 'to': '2026-09-06', 'perOccupiedRoom': 10.6},
        'measurement': {
          'days': [{'day': '2026-09-07', 'actual': 20000, 'expected': 19500, 'cusum': 500, 'occupied': 300}],
          'savings': -500, 'uncertainty': 2700, 'significant': false,
        },
        'kpis': {'total': 20000, 'carbonKg': 9880, 'emissionFactor': {'kind': 'assumption', 'source': 'Ember', 'isDefault': true}},
      });
      expect(a.baseline!.n, 333);
      expect(a.baseline!.from, DateTime(2025, 10, 7));
      expect(a.days.single.cusum, 500);
      expect(a.significant, isFalse);
      expect(a.emissionFactorSource, 'Ember');
    });
  });
}
