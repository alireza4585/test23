import '../../../core/domain/actor.dart';

enum EnergyType {
  electricity('kWh'),
  water('m³'),
  gas('m³');

  const EnergyType(this.unit);

  final String unit;
}

/// Where a reading came from. MVP uses [manual]; the same document shape is
/// written by smart meters / IoT gateways later, so analytics never change.
enum ReadingSource { manual, smartMeter, iot, import }

/// Daily consumption for one energy type. Document id = `{yyyy-MM-dd}_{type}`
/// which makes a day's entry idempotent (re-entering corrects it).
class EnergyReading {
  const EnergyReading({
    required this.id,
    required this.type,
    required this.day,
    required this.consumption,
    required this.source,
    required this.recordedByName,
    required this.createdAt,
    this.meterValue,
    this.cost,
    this.note,
  });

  final String id;
  final EnergyType type;
  final DateTime day;

  /// Consumption for the day in [EnergyType.unit].
  final double consumption;
  final ReadingSource source;
  final String recordedByName;
  final DateTime createdAt;

  /// Cumulative meter value at the time of reading (optional).
  final double? meterValue;
  final double? cost;
  final String? note;
}

class EnergyReadingDraft {
  const EnergyReadingDraft({
    required this.type,
    required this.day,
    required this.consumption,
    this.meterValue,
    this.cost,
    this.note,
  });

  final EnergyType type;
  final DateTime day;
  final double consumption;
  final double? meterValue;
  final double? cost;
  final String? note;
}

abstract interface class EnergyRepository {
  Stream<List<EnergyReading>> watchReadings(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  });

  Future<void> saveReading(
    String hotelId,
    EnergyReadingDraft draft,
    Actor actor,
  );
}
