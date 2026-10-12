import '../core/error/app_failure.dart';
import '../features/calendar/domain/calendar_event.dart';
import '../features/energy/domain/energy_analysis.dart';
import '../features/energy/domain/energy_reading.dart';
import '../features/forecast/domain/forecast.dart';

/// Features that exist only on the PocketBase backend (and the offline demo).
/// The legacy Firebase backend reports them as unsupported instead of
/// showing empty data as if it were real.
const _why = UnsupportedFailure('needs the PocketBase backend');

class UnsupportedForecastRepository implements ForecastRepository {
  const UnsupportedForecastRepository();

  @override
  Stream<Map<ForecastSeries, SeriesForecast>> watchForecasts(String hotelId) => Stream.error(_why);

  @override
  Future<void> refresh(String hotelId) => Future.error(_why);
}

class UnsupportedEnergyAnalysisRepository implements EnergyAnalysisRepository {
  const UnsupportedEnergyAnalysisRepository();

  @override
  Future<EnergyAnalysis> analyze(String hotelId, EnergyType type, {required DateTime from, required DateTime to}) =>
      Future.error(_why);
}

class UnsupportedCalendarRepository implements CalendarRepository {
  const UnsupportedCalendarRepository();

  @override
  Stream<List<CalendarEvent>> watchEvents(String hotelId) => Stream.error(_why);

  @override
  Future<void> addEvent(String hotelId, CalendarEventDraft draft) => Future.error(_why);

  @override
  Future<void> deleteEvent(String hotelId, String eventId) => Future.error(_why);
}
