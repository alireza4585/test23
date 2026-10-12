import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/charts.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../energy/application/energy_providers.dart';
import '../../energy/domain/energy_reading.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../../operations/application/operations_providers.dart';
import '../application/forecast_providers.dart';
import '../domain/forecast.dart';
import 'forecast_chart.dart';

bool _isRevenue(ForecastSeries s) => s == ForecastSeries.roomRevenue || s == ForecastSeries.totalRevenue;

/// Last 28 days of actuals for [series] from the data the app already has.
List<ChartPoint> _history(WidgetRef ref, ForecastSeries series) {
  final out = <ChartPoint>[];
  switch (series) {
    case ForecastSeries.occupancy || ForecastSeries.roomRevenue || ForecastSeries.totalRevenue:
      final ops = [...ref.watch(operationsRangeProvider).value ?? const []]..sort((a, b) => a.day.compareTo(b.day));
      for (final o in ops) {
        final v = switch (series) {
          ForecastSeries.occupancy => o.roomsAvailable > 0 ? o.roomsOccupied / o.roomsAvailable * 100 : null,
          ForecastSeries.roomRevenue => o.roomRevenue,
          _ => o.roomRevenue + o.fnbRevenue + o.otherRevenue,
        };
        if (v != null) out.add(ChartPoint(DayKey.startOfDay(o.day), v));
      }
    case ForecastSeries.electricity || ForecastSeries.water || ForecastSeries.gas:
      final type = EnergyType.values.byName(series.name);
      final byDay = <DateTime, double>{};
      for (final r in ref.watch(energyReadingsProvider).value ?? const <EnergyReading>[]) {
        if (r.type != type) continue;
        final d = DayKey.startOfDay(r.day);
        byDay[d] = (byDay[d] ?? 0) + r.consumption;
      }
      out.addAll([for (final e in byDay.entries) ChartPoint(e.key, e.value)]..sort((a, b) => a.day.compareTo(b.day)));
  }
  return out.length > 28 ? out.sublist(out.length - 28) : out;
}

class ForecastsPage extends ConsumerWidget {
  const ForecastsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final actions = ref.watch(forecastActionsProvider);
    final forecasts = ref.watch(forecastsProvider);

    Future<void> refresh() async {
      try {
        await ref.read(forecastActionsProvider).refresh();
        if (context.mounted) showSuccess(context, l10n.forecastsRefreshed);
      } catch (e) {
        if (context.mounted) showFailure(context, e);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.forecastsTitle),
        actions: [
          if (actions.canRefresh)
            IconButton(key: const Key('forecasts.refresh'), tooltip: l10n.refreshForecasts, onPressed: refresh, icon: const Icon(Icons.refresh)),
          const ShellActions(),
        ],
      ),
      body: AsyncValueView<Map<ForecastSeries, SeriesForecast>>(
        value: forecasts,
        data: (map) => PageBody(
          maxWidth: 900,
          children: [
            Text(l10n.forecastsSubtitle, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: Insets.xs),
            Text(l10n.forecastIsEstimate, style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(height: Insets.md),
            for (final s in ForecastSeries.values)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.md),
                child: _SeriesCard(series: s, forecast: map[s]),
              ),
          ],
        ),
      ),
    );
  }
}

class _SeriesCard extends ConsumerWidget {
  const _SeriesCard({required this.series, required this.forecast});

  final ForecastSeries series;
  final SeriesForecast? forecast;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final f = forecast;
    final revenue = _isRevenue(series);
    String value(double v) => series == ForecastSeries.occupancy
        ? fmt.percent(v)
        : revenue
        ? fmt.number(v / 1e9, decimals: 1)
        : fmt.number(v);
    final unit = series == ForecastSeries.occupancy
        ? ''
        : revenue
        ? l10n.billionRialUnit
        : EnergyType.values.byName(series.name).unit;
    return ZCard(
      key: Key('forecast.${series.name}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(l10n.forecastSeries(series), style: theme.textTheme.titleSmall)),
              if (unit.isNotEmpty) Text(unit, style: theme.textTheme.labelSmall),
            ],
          ),
          const SizedBox(height: Insets.xs),
          if (f == null || !f.run.ok)
            Text(l10n.forecastReason(f?.run.reason), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))
          else ...[
            Text(l10n.forecastModelLine(l10n.forecastModel(f.run.model!)), style: theme.textTheme.labelMedium),
            if (f.run.chosen?.mape != null)
              Text(
                l10n.forecastAccuracy(
                  fmt.percent(f.run.chosen!.mape!, decimals: 1),
                  f.run.benchmark?.mape == null ? '—' : fmt.percent(f.run.benchmark!.mape!, decimals: 1),
                ),
                style: theme.textTheme.labelSmall,
              ),
            if (f.run.liveDays > 0 && f.run.liveMape != null)
              Text(l10n.forecastLive(fmt.percent(f.run.liveMape!, decimals: 1), fmt.number(f.run.liveDays)), style: theme.textTheme.labelSmall),
            const SizedBox(height: Insets.md),
            ForecastChart(
              actual: _history(ref, series),
              forecast: f.points,
              dayLabel: fmt.dayOfMonth,
              valueLabel: value,
              maxY: series == ForecastSeries.occupancy ? 100 : null,
            ),
            const SizedBox(height: Insets.sm),
            if (f.points.isNotEmpty)
              Text(
                () {
                  final next = f.points.take(7).toList();
                  if (revenue) {
                    return '${l10n.forecastNext7Total}: ${value(next.fold(0.0, (s, p) => s + p.value))} $unit';
                  }
                  final avg = next.fold(0.0, (s, p) => s + p.value) / next.length;
                  return '${l10n.forecastNext7}: ${value(avg)} $unit · ${l10n.forecastRange}: ${value(next.first.lower)}–${value(next.first.upper)}';
                }(),
                style: theme.textTheme.bodySmall,
              ),
          ],
        ],
      ),
    );
  }
}

/// Dashboard preview: occupancy and room revenue for the next 7 days.
class ForecastSummaryCard extends ConsumerWidget {
  const ForecastSummaryCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    if (!ref.watch(hotelSettingsProvider).has(HotelFeature.forecasts)) return const SizedBox.shrink();
    final map = ref.watch(forecastsProvider).value ?? const {};
    final occ = map[ForecastSeries.occupancy];
    final rev = map[ForecastSeries.roomRevenue];
    if ((occ == null || !occ.run.ok) && (rev == null || !rev.run.ok)) return const SizedBox.shrink();
    final theme = Theme.of(context);
    double avg(List<ForecastPoint> p) => p.take(7).fold(0.0, (s, x) => s + x.value) / p.take(7).length;
    return ZCard(
      key: const Key('dashboard.forecast'),
      onTap: () => context.push(Routes.forecasts),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.insights_outlined, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: Insets.sm),
              Expanded(child: Text(l10n.forecastCardTitle, style: theme.textTheme.titleSmall)),
              Text(l10n.forecastOpenAll, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.primary)),
            ],
          ),
          const SizedBox(height: Insets.sm),
          if (occ != null && occ.run.ok && occ.points.isNotEmpty)
            Text(l10n.forecastOccupancyNext7(fmt.percent(avg(occ.points))), style: theme.textTheme.bodyMedium),
          if (rev != null && rev.run.ok && rev.points.isNotEmpty)
            Text(
              l10n.forecastRevenueNext7(
                '${fmt.number(rev.points.take(7).fold(0.0, (s, x) => s + x.value) / 1e9, decimals: 1)} ${l10n.billionRialUnit}',
              ),
              style: theme.textTheme.bodyMedium,
            ),
          const SizedBox(height: Insets.xs),
          Text(l10n.forecastIsEstimate, style: theme.textTheme.labelSmall),
        ],
      ),
    );
  }
}
