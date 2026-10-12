import 'energy_reading.dart';

/// Expected vs actual energy use against an occupancy-normalised baseline
/// (server: GET /api/zarin/energy/analysis). Figures are metrics computed
/// from records; the emission factor is an assumption and says so.
class BaselineStats {
  const BaselineStats({
    required this.valid,
    required this.cvrmse,
    required this.nmbe,
    required this.n,
    required this.from,
    required this.to,
    this.r2,
    this.perOccupiedRoom,
    this.fixedPerDay,
  });

  /// CV(RMSE) ≤ 25 % (ASHRAE Guideline 14, whole building).
  final bool valid;
  final double cvrmse;
  final double nmbe;
  final int n;
  final DateTime from;
  final DateTime to;
  final double? r2;

  /// Extra consumption per occupied room and the fixed daily load.
  final double? perOccupiedRoom;
  final double? fixedPerDay;
}

class MeasuredDay {
  const MeasuredDay({required this.day, required this.actual, required this.expected, required this.cusum, required this.occupied});

  final DateTime day;
  final double actual;
  final double expected;

  /// Running sum of actual − expected (positive = more than expected).
  final double cusum;
  final int occupied;
}

class EnergyAnalysis {
  const EnergyAnalysis({
    required this.type,
    required this.from,
    required this.to,
    this.baseline,
    this.days = const [],
    this.savings,
    this.uncertainty,
    this.significant = false,
    this.total,
    this.perOccupiedRoom,
    this.cost,
    this.costPerOccupiedRoom,
    this.carbonKg,
    this.carbonPerOccupiedRoomKg,
    this.emissionFactorSource,
    this.emissionFactorIsDefault = true,
  });

  final EnergyType type;
  final DateTime from;
  final DateTime to;
  final BaselineStats? baseline;
  final List<MeasuredDay> days;

  /// expected − actual over the period (positive = saved), ± 95 % half-width.
  final double? savings;
  final double? uncertainty;
  final bool significant;
  final double? total;
  final double? perOccupiedRoom;
  final double? cost;
  final double? costPerOccupiedRoom;
  final double? carbonKg;
  final double? carbonPerOccupiedRoomKg;
  final String? emissionFactorSource;
  final bool emissionFactorIsDefault;
}

abstract interface class EnergyAnalysisRepository {
  Future<EnergyAnalysis> analyze(String hotelId, EnergyType type, {required DateTime from, required DateTime to});
}
