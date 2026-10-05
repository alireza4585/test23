import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../application/staff_providers.dart';
import '../domain/staff.dart';

class StaffPage extends ConsumerStatefulWidget {
  const StaffPage({super.key});

  @override
  ConsumerState<StaffPage> createState() => _StaffPageState();
}

class _StaffPageState extends ConsumerState<StaffPage> {
  int _dayOffset = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(sessionUserProvider)!;
    final canSeeAll = user.can(AppPermission.staffView);
    final today = DayKey.startOfDay(ref.watch(clockProvider).now());
    final day = today.add(Duration(days: _dayOffset));

    final shiftsView = _ShiftsView(day: day, mine: !canSeeAll);
    final daySelector = Padding(
      padding: const EdgeInsets.fromLTRB(Insets.page, Insets.sm, Insets.page, 0),
      child: SegmentedButton<int>(
        segments: [
          ButtonSegment(value: 0, label: Text(l10n.today)),
          ButtonSegment(value: 1, label: Text(l10n.tomorrow)),
        ],
        selected: {_dayOffset},
        onSelectionChanged: (s) => setState(() => _dayOffset = s.first),
      ),
    );

    if (!canSeeAll) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.staffTitle), actions: const [ShellActions()]),
        body: Column(children: [daySelector, Expanded(child: shiftsView)]),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.staffTitle),
          actions: const [ShellActions()],
          bottom: TabBar(tabs: [Tab(text: l10n.shiftsTab), Tab(text: l10n.staffTab)]),
        ),
        floatingActionButton: user.can(AppPermission.staffManage)
            ? FloatingActionButton.extended(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => _AddShiftSheet(day: day),
                ),
                icon: const Icon(Icons.add),
                label: Text(l10n.addShift),
              )
            : null,
        body: TabBarView(
          children: [
            Column(children: [daySelector, Expanded(child: shiftsView)]),
            const _StaffList(),
          ],
        ),
      ),
    );
  }
}

class _ShiftsView extends ConsumerWidget {
  const _ShiftsView({required this.day, required this.mine});

  final DateTime day;
  final bool mine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final shifts = ref.watch(shiftsProvider((day: day, mine: mine)));
    final user = ref.watch(sessionUserProvider)!;
    final canManage = user.can(AppPermission.staffManage);

    return AsyncValueView<List<Shift>>(
      value: shifts,
      data: (list) {
        if (list.isEmpty) return EmptyState(icon: Icons.event_busy, message: l10n.noShifts);
        final onDuty = list.where((s) => s.status == ShiftStatus.checkedIn).length;
        final byType = <ShiftType, List<Shift>>{};
        for (final s in list) {
          byType.putIfAbsent(s.type, () => []).add(s);
        }
        return PageBody(
          maxWidth: 820,
          children: [
            SectionHeader(title: fmt.date(day), subtitle: l10n.onDutyCount(fmt.number(onDuty))),
            for (final type in ShiftType.values)
              if (byType[type] != null) ...[
                Padding(
                  padding: const EdgeInsets.only(top: Insets.md, bottom: Insets.sm),
                  child: Text(
                    '${l10n.shiftType(type)} · ${fmt.digits(byType[type]!.first.startTime)}–${fmt.digits(byType[type]!.first.endTime)}',
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
                ZCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      for (final s in byType[type]!)
                        ListTile(
                          leading: CircleAvatar(
                            radius: 16,
                            backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
                            child: Text(s.staffName.characters.first),
                          ),
                          title: Text(s.staffName),
                          subtitle: Text(l10n.department(s.department)),
                          trailing: canManage
                              ? PopupMenuButton<ShiftStatus>(
                                  tooltip: l10n.changeStatus,
                                  onSelected: (status) async {
                                    try {
                                      await ref.read(staffActionsProvider).setStatus(s, status);
                                    } catch (e) {
                                      if (context.mounted) showFailure(context, e);
                                    }
                                  },
                                  itemBuilder: (_) => [
                                    for (final st in ShiftStatus.values)
                                      PopupMenuItem(value: st, child: Text(l10n.shiftStatus(st))),
                                  ],
                                  child: _ShiftStatusPill(status: s.status),
                                )
                              : _ShiftStatusPill(status: s.status),
                        ),
                    ],
                  ),
                ),
              ],
            const SizedBox(height: 72),
          ],
        );
      },
    );
  }
}

class _ShiftStatusPill extends StatelessWidget {
  const _ShiftStatusPill({required this.status});

  final ShiftStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      ShiftStatus.checkedIn => context.status.success,
      ShiftStatus.absent => context.status.danger,
      ShiftStatus.completed => context.status.neutral,
      ShiftStatus.scheduled => context.status.info,
    };
    return StatusPill(label: context.l10n.shiftStatus(status), color: color);
  }
}

class _StaffList extends ConsumerWidget {
  const _StaffList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final staff = ref.watch(staffListProvider);
    return AsyncValueView<List<StaffMember>>(
      value: staff,
      data: (list) {
        final byDept = <String, List<StaffMember>>{};
        for (final s in list) {
          byDept.putIfAbsent(l10n.department(s.department), () => []).add(s);
        }
        return PageBody(
          maxWidth: 820,
          children: [
            for (final entry in byDept.entries) ...[
              SectionHeader(title: entry.key, subtitle: context.fmt.number(entry.value.length)),
              ZCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    for (final s in entry.value)
                      ListTile(
                        title: Text(s.fullName),
                        subtitle: Text(s.role == null ? l10n.noAppAccount : l10n.role(s.role!)),
                        trailing: s.phone == null ? null : Text(context.fmt.digits(s.phone!), textDirection: TextDirection.ltr),
                      ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _AddShiftSheet extends ConsumerStatefulWidget {
  const _AddShiftSheet({required this.day});

  final DateTime day;

  @override
  ConsumerState<_AddShiftSheet> createState() => _AddShiftSheetState();
}

class _AddShiftSheetState extends ConsumerState<_AddShiftSheet> {
  StaffMember? _staff;
  ShiftType _type = ShiftType.morning;
  bool _busy = false;

  Future<void> _save() async {
    if (_staff == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(staffActionsProvider).addShift(ShiftDraft(staff: _staff!, day: widget.day, type: _type));
      if (!mounted) return;
      showSuccess(context, context.l10n.shiftCreated);
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
    final staff = ref.watch(staffListProvider).value ?? const [];
    return Padding(
      padding: EdgeInsets.fromLTRB(Insets.xl, 0, Insets.xl, MediaQuery.viewInsetsOf(context).bottom + Insets.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('${l10n.addShift} · ${context.fmt.date(widget.day)}', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: Insets.lg),
          DropdownButtonFormField<StaffMember>(
            initialValue: _staff,
            decoration: InputDecoration(labelText: l10n.selectStaff),
            items: [
              for (final s in staff)
                DropdownMenuItem(value: s, child: Text('${s.fullName} · ${l10n.department(s.department)}')),
            ],
            onChanged: (s) => setState(() => _staff = s),
          ),
          const SizedBox(height: Insets.md),
          SegmentedButton<ShiftType>(
            segments: [
              for (final t in ShiftType.values) ButtonSegment(value: t, label: Text(l10n.shiftType(t))),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: Insets.xl),
          FilledButton(onPressed: _busy || _staff == null ? null : _save, child: Text(l10n.save)),
        ],
      ),
    );
  }
}
