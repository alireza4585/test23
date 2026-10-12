import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/charts.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../../dashboard/presentation/dashboard_widgets.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../application/energy_providers.dart';
import '../domain/energy_analysis.dart';
import '../domain/energy_analytics.dart';
import '../domain/energy_reading.dart';

class EnergyPage extends ConsumerStatefulWidget {
  const EnergyPage({super.key});

  @override
  ConsumerState<EnergyPage> createState() => _EnergyPageState();
}

class _EnergyPageState extends ConsumerState<EnergyPage> {
  EnergyType _type = EnergyType.electricity;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final user = ref.watch(sessionUserProvider)!;
    final readings = ref.watch(energyReadingsProvider);
    final summary = ref.watch(energySummaryProvider(_type));
    final threshold = ref.watch(hotelSettingsProvider).energyAlertThresholdPct;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.energyTitle), actions: const [ShellActions()]),
      floatingActionButton: user.can(AppPermission.energyRecord)
          ? FloatingActionButton.extended(
              key: const Key('energy.record'),
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => RecordReadingSheet(initialType: _type),
              ),
              icon: const Icon(Icons.add),
              label: Text(l10n.recordReading),
            )
          : null,
      body: AsyncValueView<List<EnergyReading>>(
        value: readings,
        data: (_) {
          final s = summary;
          return PageBody(
            maxWidth: 960,
            children: [
              SegmentedButton<EnergyType>(
                segments: [
                  for (final t in EnergyType.values)
                    ButtonSegment(
                      value: t,
                      label: Text(l10n.energyType(t)),
                      icon: Icon(switch (t) {
                        EnergyType.electricity => Icons.bolt,
                        EnergyType.water => Icons.water_drop_outlined,
                        EnergyType.gas => Icons.local_fire_department_outlined,
                      }),
                    ),
                ],
                selected: {_type},
                onSelectionChanged: (v) => setState(() => _type = v.first),
              ),
              if (s == null || s.total == 0)
                EmptyState(icon: Icons.bolt_outlined, message: l10n.noReadings)
              else ...[
                SectionHeader(title: l10n.last30Days),
                _SummaryGrid(summary: s),
                SectionHeader(
                  title: '${l10n.energyType(_type)} (${_type.unit})',
                  subtitle: l10n.last30Days,
                ),
                ZCard(
                  padding: const EdgeInsets.fromLTRB(Insets.sm, Insets.lg, Insets.lg, Insets.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DailyBarChart(
                        points: [
                          for (final p in s.series)
                            ChartPoint(
                              p.day,
                              p.value,
                              flagged: s.anomalies.any((a) => DayKey.of(a.day) == DayKey.of(p.day)),
                            ),
                        ],
                        dayLabel: fmt.dayOfMonth,
                        valueLabel: (v) => fmt.number(v),
                        baseline: s.baseline,
                      ),
                      const SizedBox(height: Insets.md),
                      Wrap(
                        spacing: Insets.lg,
                        runSpacing: Insets.sm,
                        children: [
                          LegendKey(color: context.status.series, label: l10n.energyType(_type)),
                          BaselineKey(label: l10n.baselineLegend),
                          LegendKey(
                            color: context.status.warning,
                            icon: Icons.warning_amber_rounded,
                            label: '${l10n.anomalyDays(fmt.number(s.anomalies.length))} (+${fmt.percent(threshold)})',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (s.anomalies.isNotEmpty && user.can(AppPermission.aiAssistantUse)) ...[
                  const SizedBox(height: Insets.md),
                  AssistantCta(label: l10n.energyInsightCta),
                ],
                if (ref.watch(hotelSettingsProvider).has(HotelFeature.energyBaseline)) _BaselineSection(type: _type),
                SectionHeader(title: l10n.recentReadings),
                ZCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      for (final p in s.series.reversed.take(7))
                        ListTile(
                          dense: true,
                          title: Text('${fmt.weekday(p.day)} ${fmt.date(p.day)}'),
                          trailing: Text(
                            '${fmt.number(p.value, decimals: _type == EnergyType.water ? 1 : 0)} ${_type.unit}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 72),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.summary});

  final EnergySummary summary;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final s = summary;
    final unit = s.type.unit;
    final vsBase = s.vsBaselinePct;
    final change = s.changePct;
    return ResponsiveGrid(
      minTileWidth: 150,
      children: [
        KpiCard(
          label: l10n.dailyAverage,
          value: fmt.number(s.dailyAverage, decimals: s.type == EnergyType.water ? 1 : 0),
          unit: unit,
          emphasis: true,
          caption: vsBase == null ? null : l10n.vsBaselineShort(fmt.percent(vsBase, signed: true)),
          captionColor: vsBase == null ? null : (vsBase > 10 ? context.status.danger : context.status.success),
        ),
        KpiCard(
          label: l10n.totalConsumption,
          value: fmt.number(s.total),
          unit: unit,
          caption: change == null ? null : l10n.vsPreviousPeriod(fmt.percent(change, signed: true)),
          captionColor: change == null ? null : (change > 10 ? context.status.danger : null),
        ),
        KpiCard(label: l10n.baseline, value: fmt.number(s.baseline), unit: unit),
        if (s.perOccupiedRoom != null)
          KpiCard(
            label: l10n.energyIntensity,
            value: fmt.number(s.perOccupiedRoom!, decimals: 1),
            unit: unit,
            caption: l10n.kpiEnergyIntensityUnit,
          ),
        if (s.estimatedCost != null)
          KpiCard(label: l10n.estimatedCost, value: fmt.money(s.estimatedCost!), unit: l10n.currencyRial),
      ],
    );
  }
}

class RecordReadingSheet extends ConsumerStatefulWidget {
  const RecordReadingSheet({super.key, required this.initialType});

  final EnergyType initialType;

  @override
  ConsumerState<RecordReadingSheet> createState() => _RecordReadingSheetState();
}

class _RecordReadingSheetState extends ConsumerState<RecordReadingSheet> {
  final _formKey = GlobalKey<FormState>();
  final _consumption = TextEditingController();
  final _meter = TextEditingController();
  late EnergyType _type = widget.initialType;
  late DateTime _day;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _day = DayKey.hotelToday(ref.read(clockProvider).now()).subtract(const Duration(days: 1));
  }

  @override
  void dispose() {
    _consumption.dispose();
    _meter.dispose();
    super.dispose();
  }

  double? _parse(String v) => double.tryParse(
    v.trim().replaceAll(',', '').replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}'),
  );

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(energyActionsProvider).save(
        EnergyReadingDraft(
          type: _type,
          day: _day,
          consumption: _parse(_consumption.text)!,
          meterValue: _parse(_meter.text),
        ),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.readingSaved);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final today = DayKey.hotelToday(ref.read(clockProvider).now());
    return Padding(
      padding: EdgeInsets.fromLTRB(
        Insets.xl,
        0,
        Insets.xl,
        MediaQuery.viewInsetsOf(context).bottom + Insets.xl,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.recordReading, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: Insets.lg),
            SegmentedButton<EnergyType>(
              segments: [
                for (final t in EnergyType.values) ButtonSegment(value: t, label: Text(l10n.energyType(t))),
              ],
              selected: {_type},
              onSelectionChanged: (v) => setState(() => _type = v.first),
            ),
            const SizedBox(height: Insets.md),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.calendar_today_outlined),
              title: Text(l10n.dateLabel),
              trailing: Text(fmt.date(_day)),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _day,
                  firstDate: today.subtract(const Duration(days: 60)),
                  lastDate: today,
                );
                if (picked != null) setState(() => _day = picked);
              },
            ),
            TextFormField(
              key: const Key('energy.consumption'),
              controller: _consumption,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: l10n.consumptionLabel(_type.unit)),
              validator: (v) {
                final value = _parse(v ?? '');
                return value == null || value < 0 ? l10n.invalidNumber : null;
              },
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _meter,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: '${l10n.meterValueLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(
              key: const Key('energy.save'),
              onPressed: _busy ? null : _save,
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}


/// Expected vs actual against the occupancy-normalised baseline, CUSUM,
/// savings with uncertainty, cost and carbon per occupied room.
class _BaselineSection extends ConsumerWidget {
  const _BaselineSection({required this.type});

  final EnergyType type;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final analysis = ref.watch(energyAnalysisProvider(type));
    return Column(
      key: const Key('energy.baseline'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: l10n.baselineSection, subtitle: l10n.baselineExplain),
        AsyncValueView<EnergyAnalysis?>(
          value: analysis,
          data: (a) {
            if (a == null) return const SizedBox.shrink();
            final b = a.baseline;
            final decimals = type == EnergyType.water ? 1 : 0;
            String qty(double v) => '${fmt.number(v, decimals: decimals)} ${type.unit}';
            return ZCard(
              padding: const EdgeInsets.fromLTRB(Insets.sm, Insets.lg, Insets.lg, Insets.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (b == null)
                    Text(l10n.baselineMissing, style: theme.textTheme.bodySmall)
                  else ...[
                    Text(
                      l10n.baselineFit(fmt.percent(b.cvrmse, decimals: 1), fmt.percent(b.nmbe, decimals: 1)),
                      style: theme.textTheme.labelMedium,
                    ),
                    if (!b.valid)
                      Text(l10n.baselineInvalid, style: theme.textTheme.bodySmall?.copyWith(color: context.status.warning)),
                    if (a.days.isNotEmpty) ...[
                      const SizedBox(height: Insets.md),
                      TrendLineChart(
                        points: [for (final d in a.days) ChartPoint(d.day, d.actual)],
                        dayLabel: fmt.dayOfMonth,
                        valueLabel: (v) => fmt.number(v),
                      ),
                      Wrap(
                        spacing: Insets.lg,
                        children: [
                          LegendKey(color: context.status.series, label: l10n.actualLabel),
                          Text(
                            '${l10n.expectedLabel}: ${qty(a.days.fold(0.0, (s, d) => s + d.expected))}',
                            style: theme.textTheme.labelSmall,
                          ),
                        ],
                      ),
                      const SizedBox(height: Insets.md),
                      Text(l10n.cusumTitle, style: theme.textTheme.labelLarge),
                      const SizedBox(height: Insets.sm),
                      _CusumBar(days: a.days),
                      if (a.savings != null && a.uncertainty != null) ...[
                        const SizedBox(height: Insets.sm),
                        Text(
                          !a.significant
                              ? '${l10n.withinNormalVariation} (${l10n.savingsResult(qty(a.savings!), qty(a.uncertainty!))})'
                              : a.savings! >= 0
                              ? l10n.savingsResult(qty(a.savings!), qty(a.uncertainty!))
                              : l10n.overuseResult(qty(-a.savings!), qty(a.uncertainty!)),
                          key: const Key('energy.savings'),
                          style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ],
                  ],
                  const SizedBox(height: Insets.md),
                  if (a.costPerOccupiedRoom != null)
                    Text(l10n.costPerOccupiedRoom('${fmt.money(a.costPerOccupiedRoom!)} ${l10n.currencyRial}'), style: theme.textTheme.bodySmall),
                  if (a.carbonPerOccupiedRoomKg != null) ...[
                    Text(l10n.carbonPerOccupiedRoom(fmt.number(a.carbonPerOccupiedRoomKg!, decimals: 1)), style: theme.textTheme.bodySmall),
                    Text(l10n.carbonTotal(fmt.number(a.carbonKg ?? 0)), style: theme.textTheme.bodySmall),
                    Text(
                      l10n.emissionFactorNote(l10n.assumptionLabel, a.emissionFactorSource ?? ''),
                      style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Daily CUSUM as bars around zero (above: more than expected).
class _CusumBar extends StatelessWidget {
  const _CusumBar({required this.days});

  final List<MeasuredDay> days;

  @override
  Widget build(BuildContext context) {
    final maxAbs = days.fold<double>(1, (m, d) => d.cusum.abs() > m ? d.cusum.abs() : m);
    final over = context.status.warning;
    final under = context.status.success;
    return Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        height: 64,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final d in days)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 1),
                  child: Column(
                    children: [
                      Expanded(
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: FractionallySizedBox(
                            heightFactor: d.cusum > 0 ? d.cusum / maxAbs : 0,
                            child: Container(color: over),
                          ),
                        ),
                      ),
                      Container(height: 1, color: Theme.of(context).colorScheme.outline),
                      Expanded(
                        child: Align(
                          alignment: Alignment.topCenter,
                          child: FractionallySizedBox(
                            heightFactor: d.cusum < 0 ? -d.cusum / maxAbs : 0,
                            child: Container(color: under),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
