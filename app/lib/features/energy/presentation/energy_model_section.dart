import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../actions/application/action_providers.dart';
import '../domain/energy_reading.dart';

/// F2 on the energy page: the stored model (weather and occupancy), the last
/// scored days with their expected band and flags, and the days kept out of
/// the fit (with who and why). The GM and the energy manager can propose
/// more (≤ 5 a month, reason required; approval in the Action Center).
class EnergyModelSection extends ConsumerWidget {
  const EnergyModelSection({super.key, required this.type});

  final EnergyType type;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(energyModelProvider(type)).value;
    if (view == null) return const SizedBox.shrink();
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final status = context.status;
    final m = view.model;
    final canAdjust = ref.watch(actionCenterProvider).canAdjustBaseline;
    final decimals = type == EnergyType.water ? 1 : 0;
    String n(double v) => fmt.number(v, decimals: decimals);
    return Column(
      key: const Key('energy.model'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: l10n.energyModelSection, subtitle: l10n.energyModelExplain),
        ZCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                m == null
                    ? l10n.energyModelNone
                    : m.rejected
                    ? l10n.energyModelInsufficient(m.reason ?? '')
                    : m.valid
                    ? l10n.energyModelValid(
                        m.kind == 'weather' ? l10n.energyModelWeather : l10n.energyModelNoWeather,
                        m.cvrmseMonthly == null ? '—' : fmt.number(m.cvrmseMonthly!, decimals: 1),
                      )
                    : l10n.energyModelInvalid(m.reason ?? ''),
                key: const Key('energy.model.status'),
                style: theme.textTheme.bodyMedium,
              ),
              if (m?.weatherSource != null && m!.weatherSource!.isNotEmpty)
                Text(l10n.energyModelWeatherSource(m.weatherSource!), style: theme.textTheme.labelSmall),
              for (final d in view.days.reversed.where((d) => d.actual != null).take(7))
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${fmt.weekday(d.day)} ${fmt.date(d.day)}'),
                  subtitle: Text(l10n.energyExpectedRange(n(d.expected), n(d.lower), n(d.upper))),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (d.dataError) StatusPill(key: Key('energy.dataError.${DayKey.of(d.day)}'), label: l10n.flagDataError, color: theme.colorScheme.outline)
                      else if (d.drift) StatusPill(label: l10n.flagDrift, color: status.danger)
                      else if (d.spike) StatusPill(label: l10n.flagSpike, color: status.warning),
                      if (d.flagged && d.lowConfidence) ...[const SizedBox(width: 4), StatusPill(label: l10n.flagLowConfidence, color: theme.colorScheme.outline)],
                      if (d.excluded) ...[const SizedBox(width: 4), StatusPill(label: l10n.flagExcluded, color: theme.colorScheme.outline)],
                      const SizedBox(width: Insets.sm),
                      Text('${n(d.actual!)} ${type.unit}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
            ],
          ),
        ),
        SectionHeader(
          title: l10n.energyExclusionsTitle,
          action: canAdjust
              ? TextButton.icon(
                  key: const Key('energy.excludeDays'),
                  onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => _ExcludeDaysSheet(type: type),
                  ),
                  icon: const Icon(Icons.event_busy, size: 18),
                  label: Text(l10n.energyExcludeDays),
                )
              : null,
        ),
        ZCard(
          key: const Key('energy.exclusions'),
          child: view.exclusions.isEmpty
              ? Text(l10n.energyNoExclusions, style: theme.textTheme.bodySmall)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final x in view.exclusions)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(fmt.date(x.day)),
                        subtitle: Text(x.createdByName == null ? x.reason : '${x.reason} — ${x.createdByName}'),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _ExcludeDaysSheet extends ConsumerStatefulWidget {
  const _ExcludeDaysSheet({required this.type});

  final EnergyType type;

  @override
  ConsumerState<_ExcludeDaysSheet> createState() => _ExcludeDaysSheetState();
}

class _ExcludeDaysSheetState extends ConsumerState<_ExcludeDaysSheet> {
  final _reason = TextEditingController();
  final Set<DateTime> _days = {};
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = context.l10n;
    // The sheet closes on success: show the message on the page's messenger.
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(actionCenterProvider).proposeBaselineAdjustment(widget.type, _days.toList(), _reason.text);
      if (mounted) {
        Navigator.of(context).pop();
        messenger
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(l10n.energyExcludeSent)));
      }
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
    final candidates = [for (var i = 1; i <= 21; i++) today.subtract(Duration(days: i))];
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(Insets.lg, Insets.lg, Insets.lg, MediaQuery.of(context).viewInsets.bottom + Insets.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.energyExcludeDays, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Insets.xs),
          Text(l10n.energyExcludeHint, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: Insets.md),
          Wrap(
            spacing: Insets.xs,
            runSpacing: Insets.xs,
            children: [
              for (final d in candidates)
                FilterChip(
                  key: Key('energy.excludeDay.${DayKey.of(d)}'),
                  label: Text(fmt.dateShort(d)),
                  selected: _days.contains(d),
                  onSelected: (on) => setState(() => on ? _days.add(d) : _days.remove(d)),
                ),
            ],
          ),
          const SizedBox(height: Insets.md),
          TextField(
            key: const Key('energy.excludeReason'),
            controller: _reason,
            decoration: InputDecoration(labelText: l10n.energyExcludeReason),
            maxLines: 2,
          ),
          const SizedBox(height: Insets.md),
          FilledButton(
            key: const Key('energy.excludeSubmit'),
            onPressed: _busy || _days.isEmpty ? null : _submit,
            child: Text(l10n.energyExcludeSubmit),
          ),
        ],
      ),
    );
  }
}
