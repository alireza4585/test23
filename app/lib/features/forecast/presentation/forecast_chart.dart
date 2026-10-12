import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/charts.dart';
import '../domain/forecast.dart';

/// Recent actuals (solid) followed by the forecast (dashed) with its 80 %
/// range as a shaded band. Time runs left→right in every locale.
class ForecastChart extends StatelessWidget {
  const ForecastChart({
    super.key,
    required this.actual,
    required this.forecast,
    required this.dayLabel,
    required this.valueLabel,
    this.height = 180,
    this.maxY,
  });

  final List<ChartPoint> actual;
  final List<ForecastPoint> forecast;
  final String Function(DateTime day) dayLabel;
  final String Function(double value) valueLabel;
  final double height;
  final double? maxY;

  @override
  Widget build(BuildContext context) {
    if (actual.isEmpty && forecast.isEmpty) return SizedBox(height: height);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final color = context.status.series;
    final axis = theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant);
    final days = [...actual.map((p) => p.day), ...forecast.map((p) => p.day)];
    final top = [...actual.map((p) => p.value), ...forecast.map((p) => p.upper)].fold<double>(0, math.max);
    final (niceMax, step) = niceAxis(maxY ?? top * 1.05);
    final labelEvery = math.max(1, (days.length / 6).ceil());
    final n = actual.length;
    FlSpot spot(int i, double v) => FlSpot(i.toDouble(), v);
    final joint = n > 0 ? [spot(n - 1, actual.last.value)] : <FlSpot>[];
    final lower = LineChartBarData(
      spots: [...joint, for (var k = 0; k < forecast.length; k++) spot(n + k, forecast[k].lower)],
      color: Colors.transparent,
      dotData: const FlDotData(show: false),
      barWidth: 0,
    );
    final upper = LineChartBarData(
      spots: [...joint, for (var k = 0; k < forecast.length; k++) spot(n + k, forecast[k].upper)],
      color: Colors.transparent,
      dotData: const FlDotData(show: false),
      barWidth: 0,
    );
    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        height: height,
        child: LineChart(
          LineChartData(
            minY: 0,
            maxY: maxY ?? niceMax,
            minX: 0,
            maxX: math.max(1, days.length - 1).toDouble(),
            borderData: FlBorderData(show: false),
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: step,
              getDrawingHorizontalLine: (_) => FlLine(color: scheme.outlineVariant, strokeWidth: 1),
            ),
            betweenBarsData: [BetweenBarsData(fromIndex: 2, toIndex: 3, color: color.withValues(alpha: 0.16))],
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 48,
                  interval: step,
                  getTitlesWidget: (v, meta) => SideTitleWidget(meta: meta, child: Text(valueLabel(v), style: axis)),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 24,
                  interval: 1,
                  getTitlesWidget: (v, meta) {
                    final i = v.round();
                    if (i < 0 || i >= days.length || i % labelEvery != 0) return const SizedBox.shrink();
                    return SideTitleWidget(meta: meta, child: Text(dayLabel(days[i]), style: axis));
                  },
                ),
              ),
            ),
            extraLinesData: n > 0 && forecast.isNotEmpty
                ? ExtraLinesData(
                    verticalLines: [VerticalLine(x: n - 0.5, color: scheme.outline, strokeWidth: 1, dashArray: const [3, 3])],
                  )
                : null,
            lineTouchData: const LineTouchData(enabled: false),
            lineBarsData: [
              LineChartBarData(
                spots: [for (var i = 0; i < n; i++) spot(i, actual[i].value)],
                color: color,
                barWidth: 2,
                isCurved: false,
                dotData: const FlDotData(show: false),
              ),
              LineChartBarData(
                spots: [...joint, for (var k = 0; k < forecast.length; k++) spot(n + k, forecast[k].value)],
                color: color,
                barWidth: 2,
                dashArray: const [5, 4],
                dotData: const FlDotData(show: false),
              ),
              lower,
              upper,
            ],
          ),
        ),
      ),
    );
  }
}
