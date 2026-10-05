import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/domain/app_user.dart';
import '../../notifications/presentation/alert_card.dart';
import '../application/dashboard_providers.dart';
import '../domain/dashboard_metrics.dart';
import 'dashboard_widgets.dart';

/// Executive dashboard: KPIs → alerts → AI insights → operations status →
/// trends. Two columns on large screens, one on phones.
class ExecutiveDashboard extends ConsumerWidget {
  const ExecutiveDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionUserProvider)!;
    final metrics = ref.watch(dashboardMetricsProvider);
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: GreetingTitle(user: user),
        actions: const [ShellActions()],
      ),
      body: AsyncValueView<DashboardMetrics>(
        value: metrics,
        data: (m) => LayoutBuilder(
          builder: (context, constraints) {
            final primary = _primary(context, user, m);
            final secondary = _secondary(context, user, m);
            if (constraints.maxWidth < 1000) {
              // Phone order: KPIs → alerts → AI insights → operations → trends.
              return PageBody(children: [primary.first, ...secondary, ...primary.skip(1)]);
            }
            return Align(
              alignment: AlignmentDirectional.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1400),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: PageBody(children: primary)),
                    Expanded(flex: 2, child: PageBody(children: secondary)),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  List<Widget> _primary(BuildContext context, AppUser user, DashboardMetrics m) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    return [
      KpiGrid(metrics: m, user: user),
      if (user.can(AppPermission.roomsView)) ...[
        SectionHeader(title: l10n.sectionRoomStatus, action: const SeeAllButton(route: Routes.rooms)),
        RoomStatusCard(byStatus: m.roomsByStatus),
      ],
      if (m.occupancyTrend.isNotEmpty) ...[
        SectionHeader(title: l10n.sectionOccupancyTrend),
        TrendCard(
          points: m.occupancyTrend,
          valueLabel: (v) => fmt.percent(v),
        ),
      ],
      if (user.can(AppPermission.energyView)) ...[
        SectionHeader(title: l10n.sectionEnergyTrend, action: const SeeAllButton(route: Routes.energy)),
        TrendCard(
          points: m.electricityTrend,
          valueLabel: (v) => fmt.number(v),
          baseline: m.electricityBaseline,
        ),
      ],
    ];
  }

  List<Widget> _secondary(BuildContext context, AppUser user, DashboardMetrics m) {
    final l10n = context.l10n;
    return [
      SectionHeader(title: l10n.sectionAlerts, action: const SeeAllButton(route: Routes.notifications)),
      const AlertsSection(),
      if (user.can(AppPermission.aiInsightsView)) ...[
        SectionHeader(title: l10n.sectionInsights, action: const SeeAllButton(route: Routes.insights)),
        const InsightsPreview(),
      ],
      if (user.can(AppPermission.aiAssistantUse)) ...[
        const SizedBox(height: Insets.sm),
        AssistantCta(label: l10n.assistantSuggestion2),
      ],
      if (user.canAny(const {AppPermission.maintenanceViewAll})) ...[
        SectionHeader(title: l10n.sectionRequests, action: const SeeAllButton(route: Routes.maintenance)),
        OpenRequestsList(metrics: m),
      ],
    ];
  }
}
