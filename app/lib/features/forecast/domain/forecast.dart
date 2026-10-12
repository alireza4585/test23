/// KPI forecasts computed on the server (pocketbase/pb_hooks/lib/forecasting.js):
/// the model with the lowest backtest error is published, and only if it is
/// at least as good as the "same weekday last week" benchmark.
library;

enum ForecastSeries { occupancy, roomRevenue, totalRevenue, electricity, water, gas }

enum ForecastModel { seasonalNaive, holtWinters, calendarRegression }

class ForecastPoint {
  const ForecastPoint({required this.day, required this.value, required this.lower, required this.upper});

  final DateTime day;
  final double value;

  /// 80 % range from the model's own backtest errors.
  final double lower;
  final double upper;
}

class ModelScore {
  const ModelScore({required this.model, this.mae, this.mape, this.mase});

  final ForecastModel model;
  final double? mae;

  /// Percent.
  final double? mape;
  final double? mase;
}

class ForecastRun {
  const ForecastRun({
    required this.series,
    required this.ok,
    this.reason,
    this.model,
    this.scores = const [],
    this.liveMape,
    this.liveDays = 0,
    this.trainedTo,
    this.generatedAt,
  });

  final ForecastSeries series;
  final bool ok;

  /// Why no forecast was published (`no_data`, `insufficient_history`,
  /// `too_many_gaps`, `stale_data`).
  final String? reason;
  final ForecastModel? model;
  final List<ModelScore> scores;

  /// Error of earlier next-day forecasts against what then happened.
  final double? liveMape;
  final int liveDays;
  final DateTime? trainedTo;
  final DateTime? generatedAt;

  ModelScore? get chosen => scores.where((s) => s.model == model).firstOrNull;

  ModelScore? get benchmark => scores.where((s) => s.model == ForecastModel.seasonalNaive).firstOrNull;
}

class SeriesForecast {
  const SeriesForecast({required this.run, this.points = const []});

  final ForecastRun run;
  final List<ForecastPoint> points;
}

abstract interface class ForecastRepository {
  /// Latest run and its points for every series (absent series: never run).
  Stream<Map<ForecastSeries, SeriesForecast>> watchForecasts(String hotelId);

  /// Recomputes now (executives / hotel settings only; the server checks).
  Future<void> refresh(String hotelId);
}
