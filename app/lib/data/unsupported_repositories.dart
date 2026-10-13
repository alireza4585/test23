import '../core/error/app_failure.dart';
import '../features/actions/domain/ai_action.dart';
import '../features/briefing/domain/briefing.dart';
import '../features/calendar/domain/calendar_event.dart';
import '../features/energy/domain/energy_analysis.dart';
import '../features/energy/domain/energy_model.dart';
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

/// AI phase 1 (Action Center, morning briefing, energy model): PocketBase only;
/// the Firebase backend is frozen for new features (docs/17).
class UnsupportedActionsRepository implements ActionsRepository {
  const UnsupportedActionsRepository();

  @override
  Stream<List<AiAction>> watchActions(String hotelId) => Stream.error(_why);

  @override
  Future<void> decide(String actionId, {required bool approve, String note = '', Map<String, dynamic>? params}) => Future.error(_why);

  @override
  Future<void> proposeBaselineAdjustment(String hotelId, {required String meterType, required List<String> days, required String reason}) =>
      Future.error(_why);
}

class UnsupportedBriefingRepository implements BriefingRepository {
  const UnsupportedBriefingRepository();

  @override
  Stream<Briefing?> watchToday(String hotelId, String day) => Stream.error(_why);

  @override
  Future<void> rate(String briefingId, {required bool useful}) => Future.error(_why);
}

class UnsupportedEnergyModelRepository implements EnergyModelRepository {
  const UnsupportedEnergyModelRepository();

  @override
  Stream<EnergyModelView> watchModel(String hotelId, EnergyType type) => Stream.error(_why);
}
