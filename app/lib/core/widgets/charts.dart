import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

/// Chart conventions (see docs/06-ui-ux.md → Data visualisation):
/// single series → one data colour, no legend box (the title names it);
/// 2px lines, ≤24px bars with 4px rounded data-ends, hairline solid grid,
/// labelled dashed reference line for baselines, tooltip on touch, and time
/// always runs left→right (also in RTL locales).
class ChartPoint {
  const ChartPoint(this.day, this.value, {this.flagged = false});

  final DateTime day;
  final double value;

  /// Rendered in the warning colour (e.g. above alert threshold).
  final bool flagged;
}

/// Rounds an axis maximum up to a "nice" value and returns (max, interval).
(double, double) niceAxis(double rawMax, {int ticks = 4}) {
  if (rawMax <= 0) return (1, 0.25);
  final roughStep = rawMax / ticks;
  final magnitude = math.pow(10, (math.log(roughStep) / math.ln10).floor()).toDouble();
  final residual = roughStep / magnitude;
  final step = (residual > 5
          ? 10
          : residual > 2
          ? 5
          : residual > 1
          ? 2
          : 1) *
      magnitude;
  return ((rawMax / step).ceil() * step, step);
}

class TrendLineChart extends StatelessWidget {
  const TrendLineChart({
    super.key,
    required this.points,
    required this.dayLabel,
    required this.valueLabel,
    this.baseline,
    this.baselineLabel,
    this.height = 180,
    this.minY,
  });

  final List<ChartPoint> points;
  final String Function(DateTime day) dayLabel;
  final String Function(double value) valueLabel;
  final double? baseline;
  final String? baselineLabel;
  final double height;
  final double? minY;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return SizedBox(height: height);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final palette = context.status;
    final series = palette.series;
    final axisStyle = theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant);
    final rawMax = [
      ...points.map((p) => p.value),
      ?baseline,
    ].reduce(math.max);
    final (maxY, step) = niceAxis(rawMax * 1.05);
    final labelEvery = math.max(1, (points.length / 6).ceil());

    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        height: height,
        child: LineChart(
          LineChartData(
            minY: minY ?? 0,
            maxY: maxY,
            minX: 0,
            maxX: (points.length - 1).toDouble(),
            borderData: FlBorderData(show: false),
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: step,
              getDrawingHorizontalLine: (_) =>
                  FlLine(color: scheme.outlineVariant, strokeWidth: 1),
            ),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 44,
                  interval: step,
                  getTitlesWidget: (value, meta) => SideTitleWidget(
                    meta: meta,
                    child: Text(valueLabel(value), style: axisStyle),
                  ),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 24,
                  interval: 1,
                  getTitlesWidget: (value, meta) {
                    final i = value.round();
                    if (i < 0 || i >= points.length || i % labelEvery != 0) {
                      return const SizedBox.shrink();
                    }
                    return SideTitleWidget(
                      meta: meta,
                      child: Text(dayLabel(points[i].day), style: axisStyle),
                    );
                  },
                ),
              ),
            ),
            extraLinesData: baseline == null
                ? null
                : ExtraLinesData(
                    horizontalLines: [
                      HorizontalLine(
                        y: baseline!,
                        color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                        strokeWidth: 1,
                        dashArray: const [4, 4],
                        label: HorizontalLineLabel(
                          show: baselineLabel != null,
                          alignment: Alignment.topRight,
                          style: axisStyle,
                          labelResolver: (_) => baselineLabel ?? '',
                        ),
                      ),
                    ],
                  ),
            lineTouchData: LineTouchData(
              touchTooltipData: LineTouchTooltipData(
                getTooltipColor: (_) => scheme.inverseSurface,
                getTooltipItems: (spots) => [
                  for (final s in spots)
                    LineTooltipItem(
                      '${dayLabel(points[s.x.round()].day)}\n${valueLabel(s.y)}',
                      TextStyle(
                        color: scheme.onInverseSurface,
                        fontFamily: AppTheme.fontFamily,
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            lineBarsData: [
              LineChartBarData(
                spots: [
                  for (var i = 0; i < points.length; i++)
                    FlSpot(i.toDouble(), points[i].value),
                ],
                color: series,
                barWidth: 2,
                isStrokeCapRound: true,
                isStrokeJoinRound: true,
                belowBarData: BarAreaData(
                  show: true,
                  color: series.withValues(alpha: 0.10),
                ),
                dotData: FlDotData(
                  checkToShowDot: (spot, _) => spot.x == points.length - 1,
                  getDotPainter: (_, _, _, _) => FlDotCirclePainter(
                    radius: 4,
                    color: series,
                    strokeWidth: 2,
                    strokeColor: scheme.surface,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Daily columns; [ChartPoint.flagged] columns use the warning colour and the
/// caller shows a legend entry explaining it.
class DailyBarChart extends StatelessWidget {
  const DailyBarChart({
    super.key,
    required this.points,
    required this.dayLabel,
    required this.valueLabel,
    this.baseline,
    this.baselineLabel,
    this.height = 200,
  });

  final List<ChartPoint> points;
  final String Function(DateTime day) dayLabel;
  final String Function(double value) valueLabel;
  final double? baseline;
  final String? baselineLabel;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return SizedBox(height: height);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final palette = context.status;
    final axisStyle = theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant);
    final rawMax = [...points.map((p) => p.value), ?baseline].reduce(math.max);
    final (maxY, step) = niceAxis(rawMax * 1.05);
    final labelEvery = math.max(1, (points.length / 6).ceil());

    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        height: height,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final slot = (constraints.maxWidth - 48) / points.length;
            final barWidth = (slot - 2).clamp(2.0, 24.0);
            return BarChart(
              BarChartData(
                maxY: maxY,
                minY: 0,
                alignment: BarChartAlignment.spaceBetween,
                borderData: FlBorderData(show: false),
                gridData: FlGridData(
                  drawVerticalLine: false,
                  horizontalInterval: step,
                  getDrawingHorizontalLine: (_) =>
                      FlLine(color: scheme.outlineVariant, strokeWidth: 1),
                ),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(),
                  rightTitles: const AxisTitles(),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 44,
                      interval: step,
                      getTitlesWidget: (value, meta) => SideTitleWidget(
                        meta: meta,
                        child: Text(valueLabel(value), style: axisStyle),
                      ),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 24,
                      getTitlesWidget: (value, meta) {
                        final i = value.round();
                        if (i < 0 || i >= points.length || i % labelEvery != 0) {
                          return const SizedBox.shrink();
                        }
                        return SideTitleWidget(
                          meta: meta,
                          child: Text(dayLabel(points[i].day), style: axisStyle),
                        );
                      },
                    ),
                  ),
                ),
                extraLinesData: baseline == null
                    ? null
                    : ExtraLinesData(
                        horizontalLines: [
                          HorizontalLine(
                            y: baseline!,
                            color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                            strokeWidth: 1,
                            dashArray: const [4, 4],
                            label: HorizontalLineLabel(
                              show: baselineLabel != null,
                              alignment: Alignment.topRight,
                              style: axisStyle,
                              labelResolver: (_) => baselineLabel ?? '',
                            ),
                          ),
                        ],
                      ),
                barTouchData: BarTouchData(
                  touchTooltipData: BarTouchTooltipData(
                    getTooltipColor: (_) => scheme.inverseSurface,
                    getTooltipItem: (group, _, rod, _) => BarTooltipItem(
                      '${dayLabel(points[group.x].day)}\n${valueLabel(rod.toY)}',
                      TextStyle(
                        color: scheme.onInverseSurface,
                        fontFamily: AppTheme.fontFamily,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
                barGroups: [
                  for (var i = 0; i < points.length; i++)
                    BarChartGroupData(
                      x: i,
                      barRods: [
                        BarChartRodData(
                          toY: points[i].value,
                          width: barWidth,
                          color: points[i].flagged ? palette.warning : palette.series,
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(4),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class StackSegment {
  const StackSegment({required this.label, required this.value, required this.color});

  final String label;
  final int value;
  final Color color;
}

/// Part-to-whole bar (e.g. rooms by status) with a 2px surface gap between
/// segments and an always-visible legend carrying label + count.
class StackedStatusBar extends StatelessWidget {
  const StackedStatusBar({
    super.key,
    required this.segments,
    required this.formatCount,
    this.onSegmentTap,
  });

  final List<StackSegment> segments;
  final String Function(int count) formatCount;
  final void Function(int index)? onSegmentTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = segments.fold<int>(0, (s, e) => s + e.value);
    final visible = [for (final s in segments) if (s.value > 0) s];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            height: 14,
            child: Row(
              children: [
                for (var i = 0; i < visible.length; i++) ...[
                  if (i > 0) const SizedBox(width: 2),
                  Expanded(
                    flex: (visible[i].value * 1000 / math.max(1, total)).round(),
                    child: ColoredBox(color: visible[i].color),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: Insets.md),
        Wrap(
          spacing: Insets.lg,
          runSpacing: Insets.sm,
          children: [
            for (var i = 0; i < segments.length; i++)
              InkWell(
                onTap: onSegmentTap == null ? null : () => onSegmentTap!(i),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: segments[i].color,
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(segments[i].label, style: theme.textTheme.bodySmall),
                      const SizedBox(width: 4),
                      Text(
                        formatCount(segments[i].value),
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Legend entry for a single flagged state (e.g. "above alert threshold").
class LegendKey extends StatelessWidget {
  const LegendKey({super.key, required this.color, required this.label, this.icon});

  final Color color;
  final String label;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
        ),
        const SizedBox(width: 6),
        if (icon != null) ...[
          Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 4),
        ],
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
  }
}

/// Legend entry for the dashed baseline reference line.
class BaselineKey extends StatelessWidget {
  const BaselineKey({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = theme.colorScheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 3; i++)
          Container(
            width: 4,
            height: 1.5,
            margin: const EdgeInsets.only(right: 2),
            color: color,
          ),
        const SizedBox(width: 6),
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
  }
}
