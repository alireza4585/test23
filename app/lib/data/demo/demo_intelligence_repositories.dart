import 'dart:async';

import '../../core/error/app_failure.dart';
import '../../core/utils/day_key.dart';
import '../../features/calendar/domain/calendar_event.dart';
import '../../features/energy/domain/energy_analysis.dart';
import '../../features/energy/domain/energy_baseline.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/forecast/domain/forecast.dart';
import '../../features/forecast/domain/naive_forecaster.dart';
import 'demo_store.dart';

/// Offline demo: forecasts with the benchmark model only ("same weekday last
/// week", with its backtest), computed from the demo store's history. The
/// PocketBase server also tries Holt-Winters and a calendar regression.
class DemoForecastRepository implements ForecastRepository {
  DemoForecastRepository(this._store);

  final DemoStore _store;
  final _refresh = StreamController<void>.broadcast();

  Map<ForecastSeries, SeriesForecast> _compute() {
    final today = DayKey.hotelToday(_store.clock.now());
    final occ = <DateTime, double>{};
    final room = <DateTime, double>{};
    final total = <DateTime, double>{};
    for (final o in _store.operations.all) {
      final d = DayKey.startOfDay(o.day);
      if (!d.isBefore(today)) continue;
      if (o.roomsAvailable > 0) occ[d] = o.roomsOccupied / o.roomsAvailable * 100;
      room[d] = o.roomRevenue;
      total[d] = o.roomRevenue + o.fnbRevenue + o.otherRevenue;
    }
    final energy = {for (final t in EnergyType.values) t: <DateTime, double>{}};
    for (final r in _store.energy.all) {
      final d = DayKey.startOfDay(r.day);
      if (!d.isBefore(today)) continue;
      energy[r.type]![d] = (energy[r.type]![d] ?? 0) + r.consumption;
    }
    return {
      ForecastSeries.occupancy: naiveForecast(ForecastSeries.occupancy, occ, today: today, min: 0, max: 100),
      ForecastSeries.roomRevenue: naiveForecast(ForecastSeries.roomRevenue, room, today: today, min: 0),
      ForecastSeries.totalRevenue: naiveForecast(ForecastSeries.totalRevenue, total, today: today, min: 0),
      ForecastSeries.electricity: naiveForecast(ForecastSeries.electricity, energy[EnergyType.electricity]!, today: today, min: 0),
      ForecastSeries.water: naiveForecast(ForecastSeries.water, energy[EnergyType.water]!, today: today, min: 0),
      ForecastSeries.gas: naiveForecast(ForecastSeries.gas, energy[EnergyType.gas]!, today: today, min: 0),
    };
  }

  @override
  Stream<Map<ForecastSeries, SeriesForecast>> watchForecasts(String hotelId) async* {
    yield _compute();
    await for (final _ in _refresh.stream) {
      yield _compute();
    }
  }

  @override
  Future<void> refresh(String hotelId) async {
    await _store.latency();
    _refresh.add(null);
  }
}

class DemoEnergyAnalysisRepository implements EnergyAnalysisRepository {
  DemoEnergyAnalysisRepository(this._store);

  final DemoStore _store;

  @override
  Future<EnergyAnalysis> analyze(String hotelId, EnergyType type, {required DateTime from, required DateTime to}) async {
    await _store.latency();
    final start = DayKey.startOfDay(from);
    final end = DayKey.startOfDay(to);
    final occupied = {for (final o in _store.operations.all) DayKey.startOfDay(o.day): o.roomsOccupied};
    final byDay = <DateTime, double>{};
    for (final r in _store.energy.all.where((r) => r.type == type)) {
      final d = DayKey.startOfDay(r.day);
      byDay[d] = (byDay[d] ?? 0) + r.consumption;
    }
    List<EnergyDay> rows(bool Function(DateTime d) keep) => [
      for (final e in byDay.entries)
        if (keep(e.key) && occupied[e.key] != null) EnergyDay(e.key, e.value, occupied[e.key]!),
    ];
    final settings = _store.hotels.get(hotelId)?.settings;
    return analyzeEnergyLocally(
      type: type,
      from: start,
      to: end,
      history: rows((d) => d.isBefore(start) && !d.isBefore(start.subtract(const Duration(days: 365)))),
      period: rows((d) => !d.isBefore(start) && !d.isAfter(end)),
      tariff: settings?.energyTariff[type.name] ?? 0,
      emissionKgPerKwh: 0.494,
      emissionSource: 'Ember: Iran grid average 2022 (494 gCO2/kWh)',
    );
  }
}

class DemoCalendarRepository implements CalendarRepository {
  DemoCalendarRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<CalendarEvent>> watchEvents(String hotelId) =>
      _store.calendarEvents.watch(sort: (a, b) => a.day.compareTo(b.day));

  @override
  Future<void> addEvent(String hotelId, CalendarEventDraft draft) async {
    if (draft.title.trim().isEmpty) throw const ValidationFailure('title_required');
    if (draft.endDay != null && draft.endDay!.isBefore(draft.day)) throw const ValidationFailure('invalid_range');
    await _store.latency();
    _store.calendarEvents.put(
      CalendarEvent(id: _store.nextId('cal'), day: draft.day, endDay: draft.endDay, kind: draft.kind, title: draft.title.trim()),
    );
  }

  @override
  Future<void> deleteEvent(String hotelId, String eventId) async {
    await _store.latency();
    _store.calendarEvents.remove(eventId);
  }
}
