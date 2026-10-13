import 'energy_reading.dart';

/// The hotel's stored energy model for one meter (AI phase 1, F2).
class EnergyModelInfo {
  const EnergyModelInfo({
    required this.kind,
    required this.valid,
    this.reason,
    this.cvrmseMonthly,
    this.months,
    this.weatherSource,
    this.trainFrom,
    this.trainTo,
    this.rejected = false,
  });

  /// `weather` | `seasonal` | `occupancy`
  final String kind;
  final bool valid;

  /// Why it is not valid (e.g. `insufficient_data: 30 of 90 days`).
  final String? reason;
  final double? cvrmseMonthly;
  final int? months;
  final String? weatherSource;
  final String? trainFrom;
  final String? trainTo;

  /// Not enough data yet to fit any model.
  final bool rejected;
}

/// One scored day: expected with its band, the reading, and the flags.
class ExpectedDay {
  const ExpectedDay({
    required this.day,
    required this.expected,
    required this.lower,
    required this.upper,
    this.actual,
    this.spike = false,
    this.drift = false,
    this.excluded = false,
    this.usedWeather = false,
    this.dataError = false,
    this.lowConfidence = false,
  });

  final DateTime day;
  final double expected;
  final double lower;
  final double upper;
  final double? actual;
  final bool spike;
  final bool drift;
  final bool excluded;
  final bool usedWeather;

  /// The reading looks like an entry error (zero or impossible): never a fault.
  final bool dataError;

  /// A season the model has not seen, or a young model: the alert stays in the app.
  final bool lowConfidence;

  bool get flagged => spike || drift;
}

/// A day kept out of the model fit (adjustBaseline), with who and why.
class EnergyExclusion {
  const EnergyExclusion({required this.day, required this.reason, this.createdByName});

  final DateTime day;
  final String reason;
  final String? createdByName;
}

class EnergyModelView {
  const EnergyModelView({this.model, this.days = const [], this.exclusions = const []});

  final EnergyModelInfo? model;
  final List<ExpectedDay> days;
  final List<EnergyExclusion> exclusions;
}

abstract interface class EnergyModelRepository {
  Stream<EnergyModelView> watchModel(String hotelId, EnergyType type);
}
