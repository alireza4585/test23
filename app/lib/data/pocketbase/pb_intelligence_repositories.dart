import 'package:pocketbase/pocketbase.dart';

import '../../core/utils/day_key.dart';
import '../../features/calendar/domain/calendar_event.dart';
import '../../features/energy/domain/energy_analysis.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/forecast/domain/forecast.dart';
import 'pb_support.dart';

double? _num(Object? v) => v is num ? v.toDouble() : null;

DateTime? _day(Object? v) => v is String && v.length == 10 ? DayKey.parse(v) : null;

// --------------------------------------------------------------- forecasts

/// `forecastRuns` (one per series) + `forecasts` (one per series and day),
/// written nightly by the server; re-read whenever a run changes.
class PocketBaseForecastRepository implements ForecastRepository {
  PocketBaseForecastRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<Map<ForecastSeries, SeriesForecast>> watchForecasts(String hotelId) => _live
      .list('forecastRuns', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), limit: 20)
      .asyncMap((runs) async {
        final today = DayKey.of(DateTime.now());
        final points = await pbGuard(
          () => _pb.collection('forecasts').getFullList(
            filter: _pb.filter('hotel = {:h} && day >= {:d}', {'h': hotelId, 'd': today}),
            sort: 'day',
            batch: 500,
          ),
        );
        final out = <ForecastSeries, SeriesForecast>{};
        for (final r in runs) {
          final series = r.enumValue('series', ForecastSeries.values, ForecastSeries.occupancy);
          final run = _run(series, r);
          out[series] = SeriesForecast(
            run: run,
            points: run.ok
                ? [
                    for (final p in points)
                      if (p.str('series') == series.name)
                        ForecastPoint(day: DayKey.parse(p.str('day')), value: p.dbl('value'), lower: p.dbl('lower'), upper: p.dbl('upper')),
                  ]
                : const [],
          );
        }
        return out;
      });

  ForecastRun _run(ForecastSeries series, RecordModel r) {
    final scores = r.data['scores'];
    final live = r.obj('live');
    return ForecastRun(
      series: series,
      ok: r.boolean('ok'),
      reason: r.strOrNull('reason'),
      model: ForecastModel.values.where((m) => m.name == r.str('model')).firstOrNull,
      scores: [
        if (scores is List)
          for (final s in scores)
            if (s is Map && ForecastModel.values.any((m) => m.name == s['model']))
              ModelScore(
                model: ForecastModel.values.byName(s['model'] as String),
                mae: _num(s['mae']),
                mape: _num(s['mape']),
                mase: _num(s['mase']),
              ),
      ],
      liveMape: _num(live['mape']),
      liveDays: (live['days'] as num?)?.toInt() ?? 0,
      trainedTo: _day(r.data['trainedTo']),
      generatedAt: r.date('generatedAt'),
    );
  }

  @override
  Future<void> refresh(String hotelId) =>
      pbGuard(() => _pb.send('/api/zarin/hotels/$hotelId/forecasts/run', method: 'POST'));
}

// ----------------------------------------------------------------- energy

class PocketBaseEnergyAnalysisRepository implements EnergyAnalysisRepository {
  PocketBaseEnergyAnalysisRepository(this._pb);

  final PocketBase _pb;

  @override
  Future<EnergyAnalysis> analyze(String hotelId, EnergyType type, {required DateTime from, required DateTime to}) async {
    final json = await pbGuard(
      () => _pb.send<Map<String, dynamic>>(
        '/api/zarin/energy/analysis',
        query: {'hotelId': hotelId, 'type': type.name, 'from': DayKey.of(from), 'to': DayKey.of(to)},
      ),
    );
    return energyAnalysisFromJson(type, from, to, json);
  }
}

EnergyAnalysis energyAnalysisFromJson(EnergyType type, DateTime from, DateTime to, Map<String, dynamic> json) {
  final b = json['baseline'];
  final m = json['measurement'];
  final k = json['kpis'] is Map ? json['kpis'] as Map : const {};
  final factor = k['emissionFactor'] is Map ? k['emissionFactor'] as Map : null;
  return EnergyAnalysis(
    type: type,
    from: from,
    to: to,
    baseline: b is Map
        ? BaselineStats(
            valid: b['valid'] == true,
            cvrmse: _num(b['cvrmse']) ?? 0,
            nmbe: _num(b['nmbe']) ?? 0,
            n: (b['n'] as num?)?.toInt() ?? 0,
            from: _day(b['from']) ?? from,
            to: _day(b['to']) ?? from,
            r2: _num(b['r2']),
            perOccupiedRoom: _num(b['perOccupiedRoom']),
            fixedPerDay: _num(b['fixedPerDay']),
          )
        : null,
    days: [
      if (m is Map && m['days'] is List)
        for (final d in m['days'] as List)
          if (d is Map)
            MeasuredDay(
              day: _day(d['day']) ?? from,
              actual: _num(d['actual']) ?? 0,
              expected: _num(d['expected']) ?? 0,
              cusum: _num(d['cusum']) ?? 0,
              occupied: (d['occupied'] as num?)?.toInt() ?? 0,
            ),
    ],
    savings: m is Map ? _num(m['savings']) : null,
    uncertainty: m is Map ? _num(m['uncertainty']) : null,
    significant: m is Map && m['significant'] == true,
    total: _num(k['total']),
    perOccupiedRoom: _num(k['perOccupiedRoom']),
    cost: _num(k['cost']),
    costPerOccupiedRoom: _num(k['costPerOccupiedRoom']),
    carbonKg: _num(k['carbonKg']),
    carbonPerOccupiedRoomKg: _num(k['carbonPerOccupiedRoomKg']),
    emissionFactorSource: factor?['source'] as String?,
    emissionFactorIsDefault: factor?['isDefault'] != false,
  );
}

// --------------------------------------------------------------- calendar

class PocketBaseCalendarRepository implements CalendarRepository {
  PocketBaseCalendarRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<List<CalendarEvent>> watchEvents(String hotelId) => _live
      .list('calendarEvents', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), sort: 'day', limit: 500)
      .map(
        (records) => [
          for (final r in records)
            CalendarEvent(
              id: r.id,
              day: DayKey.parse(r.str('day')),
              endDay: _day(r.data['endDay']),
              kind: r.enumValue('kind', CalendarEventKind.values, CalendarEventKind.other),
              title: r.str('title'),
            ),
        ],
      );

  @override
  Future<void> addEvent(String hotelId, CalendarEventDraft draft) => pbGuard(
    () => _pb.collection('calendarEvents').create(
      body: {
        'hotel': hotelId,
        'day': DayKey.of(draft.day),
        'endDay': draft.endDay == null ? '' : DayKey.of(draft.endDay!),
        'kind': draft.kind.name,
        'title': draft.title.trim(),
        'createdBy': _pb.authStore.record?.id ?? '',
      },
    ),
  );

  @override
  Future<void> deleteEvent(String hotelId, String eventId) =>
      pbGuard(() => _pb.collection('calendarEvents').delete(eventId));
}
