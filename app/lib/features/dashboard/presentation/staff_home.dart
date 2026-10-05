import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/status_colors.dart';
import '../../auth/application/auth_providers.dart';
import '../../housekeeping/application/housekeeping_providers.dart';
import '../../housekeeping/domain/housekeeping_task.dart';
import '../../housekeeping/presentation/task_tile.dart';
import '../../maintenance/application/maintenance_providers.dart';
import '../../maintenance/presentation/ticket_tile.dart';
import '../../rooms/application/rooms_providers.dart';
import '../../rooms/domain/room.dart';
import '../../staff/application/staff_providers.dart';
import 'dashboard_widgets.dart';

/// "My work": the front-line experience. Built for one-handed use during a
/// shift — the next job and its primary action are always above the fold.
class StaffHome extends ConsumerWidget {
  const StaffHome({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionUserProvider)!;
    final l10n = context.l10n;
    final fmt = context.fmt;
    final today = DayKey.startOfDay(ref.watch(clockProvider).now());
    final shifts = ref.watch(shiftsProvider((day: today, mine: true))).value ?? const [];
    final shift = shifts.isEmpty ? null : shifts.first;
    final hasTasks = user.can(AppPermission.housekeepingViewOwn);
    final tasks = hasTasks ? (ref.watch(todayTasksProvider(true)).value ?? const <HousekeepingTask>[]) : const <HousekeepingTask>[];
    final done = tasks.where((t) => t.status == TaskStatus.done).length;
    final open = tasks.where((t) => t.isOpen).toList()
      ..sort((a, b) {
        // In-progress first, then by priority.
        final s = b.status.index.compareTo(a.status.index);
        return s != 0 ? s : b.priority.index.compareTo(a.priority.index);
      });

    final quickActions = <(IconData, String, String)>[
      if (user.can(AppPermission.maintenanceReport))
        (Icons.report_gmailerrorred, l10n.actionReportFault, Routes.maintenanceNew),
      if (user.can(AppPermission.roomsView))
        (Icons.meeting_room_outlined, l10n.actionRooms, Routes.rooms),
      if (user.can(AppPermission.operationsRecordDaily))
        (Icons.edit_calendar_outlined, l10n.actionRecordDaily, Routes.dailyOps),
      (Icons.handyman_outlined, l10n.actionMyTickets, Routes.maintenance),
      if (user.can(AppPermission.inventoryView))
        (Icons.inventory_2_outlined, l10n.navInventory, Routes.inventory),
    ];

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: GreetingTitle(user: user, subtitle: l10n.role(user.role)),
        actions: const [ShellActions()],
      ),
      body: PageBody(
        maxWidth: 720,
        children: [
          ZCard(
            child: Row(
              children: [
                Icon(Icons.schedule, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: Insets.md),
                Expanded(
                  child: Text(
                    shift == null
                        ? l10n.noShiftToday
                        : l10n.shiftToday(fmt.digits(shift.startTime), fmt.digits(shift.endTime)),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                if (shift != null)
                  StatusPill(label: l10n.shiftStatus(shift.status), color: context.status.info),
              ],
            ),
          ),
          if (hasTasks) ...[
            const SizedBox(height: Insets.md),
            _ProgressCard(done: done, total: tasks.length),
            if (open.isNotEmpty) ...[
              SectionHeader(title: l10n.nextTask),
              _NextTaskCard(task: open.first),
            ] else if (tasks.isNotEmpty) ...[
              const SizedBox(height: Insets.lg),
              EmptyState(icon: Icons.task_alt, message: l10n.allTasksDone),
            ],
          ],
          if (user.can(AppPermission.maintenanceWork)) ...[
            SectionHeader(title: l10n.actionMyTickets, action: const SeeAllButton(route: Routes.maintenance)),
            const _MyTickets(),
          ],
          if (user.role.department == Department.frontOffice) ...[
            SectionHeader(title: l10n.sectionRoomStatus, action: const SeeAllButton(route: Routes.rooms)),
            const _FrontDeskRooms(),
          ],
          SectionHeader(title: l10n.quickActions),
          ResponsiveGrid(
            minTileWidth: 140,
            children: [
              for (final (icon, label, route) in quickActions)
                ZCard(
                  onTap: () => context.push(route),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(icon, size: 28, color: Theme.of(context).colorScheme.primary),
                      const SizedBox(height: Insets.sm),
                      Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.labelLarge),
                    ],
                  ),
                ),
            ],
          ),
          if (hasTasks && open.length > 1) ...[
            SectionHeader(title: l10n.hkMyTasks, action: const SeeAllButton(route: Routes.housekeeping)),
            for (final t in open.skip(1).take(5))
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: TaskTile(task: t),
              ),
          ],
        ],
      ),
    );
  }
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.done, required this.total});

  final int done;
  final int total;

  @override
  Widget build(BuildContext context) {
    final fmt = context.fmt;
    final theme = Theme.of(context);
    return ZCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.l10n.myWorkProgress(fmt.number(done), fmt.number(total)),
            style: theme.textTheme.titleSmall,
          ),
          const SizedBox(height: Insets.md),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : done / total,
              minHeight: 8,
              backgroundColor: theme.colorScheme.surfaceContainerHigh,
              color: context.status.success,
            ),
          ),
        ],
      ),
    );
  }
}

/// Big, thumb-friendly card: room number, task, and one primary action.
class _NextTaskCard extends ConsumerStatefulWidget {
  const _NextTaskCard({required this.task});

  final HousekeepingTask task;

  @override
  ConsumerState<_NextTaskCard> createState() => _NextTaskCardState();
}

class _NextTaskCardState extends ConsumerState<_NextTaskCard> {
  bool _busy = false;

  Future<void> _act() async {
    setState(() => _busy = true);
    final actions = ref.read(housekeepingActionsProvider);
    final l10n = context.l10n;
    try {
      if (widget.task.status == TaskStatus.pending) {
        await actions.start(widget.task);
        if (mounted) showSuccess(context, l10n.taskStarted);
      } else {
        await actions.complete(widget.task);
        if (mounted) showSuccess(context, l10n.taskCompleted);
      }
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final now = ref.watch(clockProvider).now();
    final elapsed = task.startedAt == null ? null : now.difference(task.startedAt!).inMinutes;
    final pending = task.status == TaskStatus.pending;

    return ZCard(
      key: const Key('staff.nextTask'),
      highlight: context.taskPriorityColor(task.priority),
      onTap: () => context.push(Routes.task(task.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                l10n.roomLabel(fmt.digits(task.roomNumber)),
                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              StatusPill(label: l10n.taskPriority(task.priority), color: context.taskPriorityColor(task.priority)),
            ],
          ),
          const SizedBox(height: Insets.xs),
          Text(l10n.taskType(task.type), style: theme.textTheme.bodyLarge),
          const SizedBox(height: Insets.xs),
          Text(
            [
              if (task.dueAt != null) l10n.dueBy(fmt.time(task.dueAt!)),
              if (elapsed != null) l10n.taskElapsed(fmt.number(elapsed)),
            ].join(' · '),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: Insets.lg),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              key: const Key('staff.nextTask.action'),
              onPressed: _busy ? null : _act,
              icon: Icon(pending ? Icons.play_arrow_rounded : Icons.check_rounded),
              label: Text(pending ? l10n.startTask : l10n.completeTask),
            ),
          ),
        ],
      ),
    );
  }
}

class _MyTickets extends ConsumerWidget {
  const _MyTickets();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(ticketsProvider((mine: true, activeOnly: true))).value ?? const [];
    if (tickets.isEmpty) {
      return Text(context.l10n.noTickets, style: Theme.of(context).textTheme.bodySmall);
    }
    return Column(
      children: [
        for (final t in tickets.take(4))
          Padding(padding: const EdgeInsets.only(bottom: Insets.sm), child: TicketTile(ticket: t)),
      ],
    );
  }
}

class _FrontDeskRooms extends ConsumerWidget {
  const _FrontDeskRooms();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = ref.watch(roomStatusCountsProvider);
    final l10n = context.l10n;
    final fmt = context.fmt;
    return ResponsiveGrid(
      minTileWidth: 140,
      children: [
        for (final s in [RoomStatus.vacantClean, RoomStatus.vacantDirty, RoomStatus.occupied])
          KpiCard(
            label: l10n.roomStatus(s),
            value: fmt.number(counts[s] ?? 0),
            icon: roomStatusIcon(s),
            onTap: () => context.go(Routes.rooms),
          ),
      ],
    );
  }
}
