import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/charts.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/status_colors.dart';
import '../../ai/application/ai_providers.dart';
import '../../ai/presentation/insight_card.dart';
import '../../auth/domain/app_user.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../maintenance/presentation/ticket_tile.dart';
import '../../rooms/domain/room.dart';
import '../domain/dashboard_metrics.dart';

/// "Good morning, Arash" + hotel subtitle for app bars.
class GreetingTitle extends ConsumerWidget {
  const GreetingTitle({super.key, required this.user, this.subtitle});

  final AppUser user;
  final String? subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final hour = ref.watch(clockProvider).now().hour;
    final greeting = hour < 12
        ? l10n.greetingMorning(user.firstName)
        : hour < 17
        ? l10n.greetingAfternoon(user.firstName)
        : l10n.greetingEvening(user.firstName);
    final hotel = ref.watch(hotelProvider).value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(greeting, style: Theme.of(context).textTheme.titleLarge),
        Text(
          subtitle ?? l10n.dashboardSubtitle(hotel?.name ?? ''),
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// KPI tiles, filtered by what the user may see (finance figures only for
/// roles with `finance.view`, energy only with `energy.view`, …).
class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.metrics, required this.user});

  final DashboardMetrics metrics;
  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final status = context.status;
    final m = metrics;

    String? wow(double? pct) => pct == null ? null : l10n.vsLastWeek(fmt.percent(pct, signed: true, decimals: 1));
    Color? wowColor(double? pct) => pct == null ? null : (pct >= 0 ? status.success : status.danger);

    final elecDelta = m.electricityVsBaselinePct;
    final tiles = <Widget>[
      if (user.can(AppPermission.roomsView))
        KpiCard(
          key: const Key('kpi.occupancy'),
          label: l10n.kpiOccupancy,
          value: fmt.percent(m.liveOccupancyPct, decimals: 1),
          icon: Icons.hotel_outlined,
          emphasis: true,
          caption: m.yesterday == null ? null : '${l10n.yesterday}: ${fmt.percent(m.yesterday!.occupancyRate, decimals: 1)}',
          onTap: () => context.go(Routes.rooms),
        ),
      if (user.can(AppPermission.financeView) && m.yesterday != null) ...[
        KpiCard(
          label: l10n.kpiRevpar,
          value: fmt.money(m.yesterday!.revpar),
          unit: l10n.currencyRial,
          icon: Icons.trending_up,
          caption: wow(m.revparWowPct),
          captionColor: wowColor(m.revparWowPct),
        ),
        KpiCard(
          label: l10n.kpiAdr,
          value: fmt.money(m.yesterday!.adr),
          unit: l10n.currencyRial,
          icon: Icons.sell_outlined,
          caption: wow(m.adrWowPct),
          captionColor: wowColor(m.adrWowPct),
        ),
        KpiCard(
          label: l10n.kpiRevenue,
          value: fmt.money(m.yesterday!.totalRevenue),
          unit: l10n.currencyRial,
          icon: Icons.account_balance_wallet_outlined,
          caption: wow(m.revenueWowPct),
          captionColor: wowColor(m.revenueWowPct),
        ),
      ],
      if (user.can(AppPermission.energyView) && m.electricityYesterday != null) ...[
        KpiCard(
          key: const Key('kpi.electricity'),
          label: l10n.kpiElectricity,
          value: fmt.number(m.electricityYesterday!),
          unit: 'kWh',
          icon: Icons.bolt_outlined,
          caption: elecDelta == null ? null : l10n.vsBaselineShort(fmt.percent(elecDelta, signed: true)),
          captionColor: elecDelta == null ? null : (elecDelta > 10 ? status.danger : status.success),
          onTap: () => context.go(Routes.energy),
        ),
        if (m.electricityIntensity != null)
          KpiCard(
            label: l10n.kpiEnergyIntensity,
            value: fmt.number(m.electricityIntensity!, decimals: 1),
            unit: 'kWh',
            icon: Icons.speed_outlined,
            caption: l10n.kpiEnergyIntensityUnit,
          ),
      ],
      if (user.canAny(const {AppPermission.maintenanceViewAll, AppPermission.maintenanceManage}))
        KpiCard(
          key: const Key('kpi.tickets'),
          label: l10n.kpiOpenTickets,
          value: fmt.number(m.openTickets),
          icon: Icons.handyman_outlined,
          caption: l10n.kpiOverdueTickets(fmt.number(m.overdueTickets)),
          captionColor: m.overdueTickets > 0 ? status.danger : null,
          onTap: () => context.go(Routes.maintenance),
        ),
      if (user.can(AppPermission.roomsView))
        KpiCard(
          label: l10n.kpiRoomsReady,
          value: fmt.number(m.roomsReady),
          icon: Icons.check_circle_outline,
          caption: l10n.kpiRoomsToClean(fmt.number(m.roomsToClean)),
          onTap: () => context.go(Routes.rooms),
        ),
      if (user.canAny(const {AppPermission.housekeepingViewAll}))
        KpiCard(
          label: l10n.kpiHousekeeping,
          value: fmt.digits('${m.tasksDone}/${m.tasksTotal}'),
          icon: Icons.cleaning_services_outlined,
          onTap: () => context.go(Routes.housekeeping),
        ),
      if (user.can(AppPermission.staffView))
        KpiCard(
          label: l10n.kpiStaffOnDuty,
          value: fmt.number(m.staffOnDuty),
          icon: Icons.badge_outlined,
          onTap: () => context.go(Routes.staff),
        ),
      if (user.can(AppPermission.inventoryView))
        KpiCard(
          label: l10n.kpiLowStock,
          value: fmt.number(m.lowStockCount),
          icon: Icons.inventory_2_outlined,
          captionColor: m.lowStockCount > 0 ? status.warning : null,
          onTap: () => context.go(Routes.inventory),
        ),
    ];
    return ResponsiveGrid(minTileWidth: 150, children: tiles);
  }
}

class RoomStatusCard extends StatelessWidget {
  const RoomStatusCard({super.key, required this.byStatus});

  final Map<RoomStatus, int> byStatus;

  // Stacked order validated for colour-vision separation (see AppColors).
  static const _order = [
    RoomStatus.vacantClean,
    RoomStatus.cleaningInProgress,
    RoomStatus.vacantDirty,
    RoomStatus.occupied,
    RoomStatus.outOfOrder,
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    return ZCard(
      onTap: () => context.go(Routes.rooms),
      child: StackedStatusBar(
        formatCount: fmt.number,
        segments: [
          for (final s in _order)
            StackSegment(
              label: l10n.roomStatus(s),
              value: byStatus[s] ?? 0,
              color: context.roomStatusColor(s),
            ),
        ],
      ),
    );
  }
}

class TrendCard extends StatelessWidget {
  const TrendCard({
    super.key,
    required this.points,
    required this.valueLabel,
    this.baseline,
  });

  final List<DayValue> points;
  final String Function(double) valueLabel;
  final double? baseline;

  @override
  Widget build(BuildContext context) {
    final fmt = context.fmt;
    return ZCard(
      padding: const EdgeInsets.fromLTRB(Insets.sm, Insets.lg, Insets.lg, Insets.sm),
      child: points.length < 2
          ? SizedBox(height: 120, child: Center(child: Text(context.l10n.noReadings)))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TrendLineChart(
                  points: [for (final p in points) ChartPoint(p.day, p.value)],
                  dayLabel: fmt.dayOfMonth,
                  valueLabel: valueLabel,
                  baseline: baseline,
                ),
                if (baseline != null)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(start: Insets.lg, top: Insets.sm),
                    child: BaselineKey(label: context.l10n.baselineLegend),
                  ),
              ],
            ),
    );
  }
}

class InsightsPreview extends ConsumerWidget {
  const InsightsPreview({super.key, this.limit = 2});

  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final insights = ref.watch(insightsProvider).value ?? const [];
    if (insights.isEmpty) {
      return Text(context.l10n.noInsights, style: Theme.of(context).textTheme.bodySmall);
    }
    return Column(
      children: [
        for (final i in insights.take(limit))
          Padding(
            padding: const EdgeInsets.only(bottom: Insets.sm),
            child: InsightCard(insight: i),
          ),
      ],
    );
  }
}

class OpenRequestsList extends StatelessWidget {
  const OpenRequestsList({super.key, required this.metrics});

  final DashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    if (metrics.topTickets.isEmpty) {
      return Text(context.l10n.noTickets, style: Theme.of(context).textTheme.bodySmall);
    }
    return Column(
      children: [
        for (final t in metrics.topTickets)
          Padding(
            padding: const EdgeInsets.only(bottom: Insets.sm),
            child: TicketTile(ticket: t),
          ),
      ],
    );
  }
}

class SeeAllButton extends StatelessWidget {
  const SeeAllButton({super.key, required this.route});

  final String route;

  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: () => context.go(route), child: Text(context.l10n.seeAll));
}

/// Gold "ask the assistant" call-to-action used on dashboards.
class AssistantCta extends StatelessWidget {
  const AssistantCta({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ZCard(
      onTap: () => context.push(Routes.assistant),
      child: Row(
        children: [
          const Icon(Icons.auto_awesome, color: AppColors.gold),
          const SizedBox(width: Insets.md),
          Expanded(child: Text(label, style: theme.textTheme.titleSmall)),
          Icon(Icons.arrow_forward, color: theme.colorScheme.onSurfaceVariant, textDirection: Directionality.of(context)),
        ],
      ),
    );
  }
}
