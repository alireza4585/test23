import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/calendar_providers.dart';
import '../domain/calendar_event.dart';

/// Holidays and events that drive demand: Iran's fixed public holidays are
/// built in; the hotel adds lunar holidays (from the official calendar) and
/// local events. The server's forecasts treat all of them as special days.
class CalendarPage extends ConsumerWidget {
  const CalendarPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final actions = ref.watch(calendarActionsProvider);
    final today = DayKey.hotelToday(ref.watch(clockProvider).now());
    final builtIn = iranFixedHolidays(today, DateTime(today.year + 1, today.month, today.day));
    final events = ref.watch(calendarEventsProvider);

    String span(CalendarEvent e) =>
        e.endDay == null || DayKey.of(e.endDay!) == DayKey.of(e.day) ? fmt.date(e.day) : '${fmt.date(e.day)} – ${fmt.date(e.endDay!)}';

    Future<void> delete(CalendarEvent e) async {
      try {
        await ref.read(calendarActionsProvider).delete(e);
        if (context.mounted) showSuccess(context, l10n.eventDeleted);
      } catch (err) {
        if (context.mounted) showFailure(context, err);
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.calendarTitle), actions: const [ShellActions()]),
      floatingActionButton: actions.canManage
          ? FloatingActionButton.extended(
              key: const Key('calendar.add'),
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => const _EventSheet(),
              ),
              icon: const Icon(Icons.add),
              label: Text(l10n.calendarAdd),
            )
          : null,
      body: AsyncValueView<List<CalendarEvent>>(
        value: events,
        data: (list) => PageBody(
          maxWidth: 820,
          children: [
            Text(l10n.calendarSubtitle, style: theme.textTheme.bodySmall),
            const SizedBox(height: Insets.md),
            SectionHeader(title: l10n.hotelEvents),
            if (list.isEmpty) EmptyState(icon: Icons.event_outlined, message: l10n.noEvents),
            for (final e in list)
              ZCard(
                key: Key('calendar.event.${e.id}'),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(e.title, style: theme.textTheme.titleSmall),
                          Text('${l10n.calendarKind(e.kind)} · ${span(e)}', style: theme.textTheme.bodySmall),
                        ],
                      ),
                    ),
                    if (actions.canManage)
                      IconButton(tooltip: l10n.deleteAction, onPressed: () => delete(e), icon: const Icon(Icons.delete_outline)),
                  ],
                ),
              ),
            const SizedBox(height: Insets.lg),
            SectionHeader(title: l10n.builtInHolidays),
            for (final h in builtIn)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    const Icon(Icons.flag_outlined, size: 16),
                    const SizedBox(width: Insets.sm),
                    Expanded(child: Text(h.title, style: theme.textTheme.bodyMedium)),
                    Text(fmt.date(h.day), style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EventSheet extends ConsumerStatefulWidget {
  const _EventSheet();

  @override
  ConsumerState<_EventSheet> createState() => _EventSheetState();
}

class _EventSheetState extends ConsumerState<_EventSheet> {
  final _title = TextEditingController();
  CalendarEventKind _kind = CalendarEventKind.religious;
  DateTime? _from;
  DateTime? _to;
  bool _saving = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<DateTime?> _pick(DateTime? initial) {
    final now = DateTime.now();
    return showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 3),
    );
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    if (_from == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(calendarActionsProvider).add(CalendarEventDraft(day: _from!, endDay: _to, kind: _kind, title: _title.text));
      if (!mounted) return;
      Navigator.of(context).pop();
      showSuccess(context, l10n.eventSaved);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    return Padding(
      padding: EdgeInsets.only(left: Insets.lg, right: Insets.lg, bottom: MediaQuery.viewInsetsOf(context).bottom + Insets.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.calendarAdd, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Insets.md),
          TextField(
            key: const Key('calendar.title'),
            controller: _title,
            maxLength: 120,
            decoration: InputDecoration(labelText: l10n.eventTitleLabel),
          ),
          DropdownButtonFormField<CalendarEventKind>(
            key: const Key('calendar.kind'),
            initialValue: _kind,
            decoration: InputDecoration(labelText: l10n.eventKindLabel),
            items: [for (final k in CalendarEventKind.values) DropdownMenuItem(value: k, child: Text(l10n.calendarKind(k)))],
            onChanged: (k) => setState(() => _kind = k ?? _kind),
          ),
          const SizedBox(height: Insets.sm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('calendar.from'),
                  onPressed: () async {
                    final d = await _pick(_from);
                    if (d != null) setState(() => _from = d);
                  },
                  child: Text(_from == null ? l10n.eventFromLabel : fmt.date(_from!)),
                ),
              ),
              const SizedBox(width: Insets.sm),
              Expanded(
                child: OutlinedButton(
                  key: const Key('calendar.to'),
                  onPressed: () async {
                    final d = await _pick(_to ?? _from);
                    if (d != null) setState(() => _to = d);
                  },
                  child: Text(_to == null ? l10n.eventToLabel : fmt.date(_to!)),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.md),
          FilledButton(
            key: const Key('calendar.save'),
            onPressed: _saving || _from == null ? null : _save,
            child: Text(l10n.save),
          ),
        ],
      ),
    );
  }
}
