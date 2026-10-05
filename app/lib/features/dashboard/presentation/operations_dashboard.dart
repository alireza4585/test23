import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../../housekeeping/application/housekeeping_providers.dart';
import '../../housekeeping/presentation/task_tile.dart';
import '../../inventory/application/inventory_providers.dart';
import '../../notifications/presentation/alert_card.dart';
import '../../staff/application/staff_providers.dart';
import '../../staff/domain/staff.dart';
import '../application/dashboard_providers.dart';
import '../domain/dashboard_metrics.dart';
import 'dashboard_widgets.dart';

/// Department console for managers. Shows only the KPIs, quick actions and
/// work lists relevant to the manager's permissions.
class OperationsDashboard extends ConsumerWidget {
  const OperationsDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionUserProvider)!;
    final l10n = context.l10n;
    final fmt = context.fmt;
    final metrics = ref.watch(dashboardMetricsProvider);

    final actions = <(IconData, String, String)>[
      if (user.can(AppPermission.housekeepingAssign))
        (Icons.add_task, l10n.newTask, Routes.housekeepingNew),
      if (user.can(AppPermission.maintenanceReport))
        (Icons.report_gmailerrorred, l10n.actionReportFault, Routes.maintenanceNew),
      if (user.can(AppPermission.energyRecord))
        (Icons.bolt, l10n.recordReading, Routes.energy),
      if (user.can(AppPermission.inventoryMove))
        (Icons.swap_vert, l10n.recordMovement, Routes.inventory),
      if (user.can(AppPermission.staffManage))
        (Icons.calendar_month, l10n.addShift, Routes.staff),
      if (user.can(AppPermission.operationsRecordDaily))
        (Icons.edit_calendar, l10n.actionRecordDaily, Routes.dailyOps),
      if (user.can(AppPermission.usersManage))
        (Icons.person_add_alt, l10n.newUser, Routes.usersNew),
    ];

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: GreetingTitle(
          user: user,
          subtitle: l10n.opsDashboardSubtitle(l10n.department(user.role.department)),
        ),
        actions: const [ShellActions()],
      ),
      body: AsyncValueView<DashboardMetrics>(
        value: metrics,
        data: (m) => PageBody(
          children: [
            KpiGrid(metrics: m, user: user),
            if (actions.isNotEmpty) ...[
              SectionHeader(title: l10n.quickActions),
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  for (final (icon, label, route) in actions)
                    ActionChip(
                      avatar: Icon(icon, size: 18),
                      label: Text(label),
                      onPressed: () => context.push(route),
                    ),
                ],
              ),
            ],
            SectionHeader(title: l10n.sectionAlerts, action: const SeeAllButton(route: Routes.notifications)),
            const AlertsSection(),
            if (user.can(AppPermission.housekeepingViewAll)) ...[
              SectionHeader(
                title: l10n.hkAllTasks,
                subtitle: fmt.digits('${m.tasksDone}/${m.tasksTotal}'),
                action: const SeeAllButton(route: Routes.housekeeping),
              ),
              const _OpenTasks(),
            ],
            if (user.can(AppPermission.maintenanceViewAll)) ...[
              SectionHeader(title: l10n.sectionRequests, action: const SeeAllButton(route: Routes.maintenance)),
              OpenRequestsList(metrics: m),
            ],
            if (user.can(AppPermission.energyView)) ...[
              SectionHeader(title: l10n.sectionEnergyTrend, action: const SeeAllButton(route: Routes.energy)),
              TrendCard(
                points: m.electricityTrend,
                valueLabel: (v) => fmt.number(v),
                baseline: m.electricityBaseline,
              ),
            ],
            if (user.can(AppPermission.roomsView)) ...[
              SectionHeader(title: l10n.sectionRoomStatus, action: const SeeAllButton(route: Routes.rooms)),
              RoomStatusCard(byStatus: m.roomsByStatus),
            ],
            if (user.can(AppPermission.inventoryView)) ...[
              SectionHeader(title: l10n.kpiLowStock, action: const SeeAllButton(route: Routes.inventory)),
              const _LowStockList(),
            ],
            if (user.can(AppPermission.staffView)) ...[
              SectionHeader(title: l10n.kpiStaffOnDuty, action: const SeeAllButton(route: Routes.staff)),
              const _OnDutyList(),
            ],
            if (user.can(AppPermission.aiInsightsView)) ...[
              SectionHeader(title: l10n.sectionInsights, action: const SeeAllButton(route: Routes.insights)),
              const InsightsPreview(),
            ],
          ],
        ),
      ),
    );
  }
}

class _OpenTasks extends ConsumerWidget {
  const _OpenTasks();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = (ref.watch(todayTasksProvider(false)).value ?? const [])
        .where((t) => t.isOpen)
        .take(4)
        .toList();
    if (tasks.isEmpty) {
      return Text(context.l10n.allTasksDone, style: Theme.of(context).textTheme.bodySmall);
    }
    return Column(
      children: [
        for (final t in tasks)
          Padding(
            padding: const EdgeInsets.only(bottom: Insets.sm),
            child: TaskTile(task: t, showAssignee: true),
          ),
      ],
    );
  }
}

class _LowStockList extends ConsumerWidget {
  const _LowStockList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(lowStockItemsProvider);
    final fmt = context.fmt;
    if (items.isEmpty) {
      return Text(context.l10n.emptyGeneric, style: Theme.of(context).textTheme.bodySmall);
    }
    return ZCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (final i in items.take(5))
            ListTile(
              dense: true,
              leading: const Icon(Icons.inventory_2_outlined),
              title: Text(i.name),
              trailing: Text('${fmt.number(i.quantity)} / ${fmt.number(i.reorderLevel)} ${i.unit}'),
              onTap: () => context.push(Routes.item(i.id)),
            ),
        ],
      ),
    );
  }
}

class _OnDutyList extends ConsumerWidget {
  const _OnDutyList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final today = DayKey.startOfDay(ref.watch(clockProvider).now());
    final shifts = ref.watch(shiftsProvider((day: today, mine: false))).value ?? const [];
    final onDuty = shifts.where((s) => s.status == ShiftStatus.checkedIn).toList();
    if (onDuty.isEmpty) {
      return Text(l10n.noShifts, style: Theme.of(context).textTheme.bodySmall);
    }
    return Wrap(
      spacing: Insets.sm,
      runSpacing: Insets.sm,
      children: [
        for (final s in onDuty)
          Chip(
            avatar: const Icon(Icons.person, size: 16),
            label: Text('${s.staffName} · ${l10n.department(s.department)}'),
          ),
      ],
    );
  }
}
