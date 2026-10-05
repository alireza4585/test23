import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/status_colors.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../application/notifications_providers.dart';
import '../domain/notification_models.dart';

class AlertCard extends ConsumerWidget {
  const AlertCard({super.key, required this.alert});

  final HotelAlert alert;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final color = context.severityColor(alert.severity);
    final now = ref.watch(clockProvider).now();

    return ZCard(
      key: Key('alert.${alert.id}'),
      highlight: color,
      padding: const EdgeInsets.fromLTRB(Insets.md, Insets.md, Insets.lg, Insets.sm),
      onTap: alert.route == null ? null : () => context.push(alert.route!),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(severityIcon(alert.severity), size: 18, color: color),
              const SizedBox(width: Insets.sm),
              Expanded(child: Text(alert.title, style: theme.textTheme.titleSmall)),
              Text(
                context.fmt.relative(alert.createdAt, now, l10n),
                style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            alert.message,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: alert.status == AlertStatus.open
                ? TextButton(
                    onPressed: () async {
                      final user = ref.read(sessionUserProvider);
                      if (user == null) return;
                      try {
                        await ref
                            .read(notificationsRepositoryProvider)
                            .acknowledgeAlert(user.hotelId, alert.id, user.asActor);
                      } catch (e) {
                        if (context.mounted) showFailure(context, e);
                      }
                    },
                    child: Text(l10n.acknowledge),
                  )
                : Padding(
                    padding: const EdgeInsets.symmetric(vertical: Insets.sm),
                    child: Text(
                      l10n.acknowledgedBy(alert.acknowledgedByName ?? '—'),
                      style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Up to [limit] alerts, or an empty-state line.
class AlertsSection extends ConsumerWidget {
  const AlertsSection({super.key, this.limit = 3});

  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alerts = ref.watch(alertsProvider);
    return AsyncValueView<List<HotelAlert>>(
      value: alerts,
      data: (list) {
        if (list.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: Insets.md),
            child: Text(
              context.l10n.noAlerts,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          );
        }
        return Column(
          children: [
            for (final a in list.take(limit))
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: AlertCard(alert: a),
              ),
          ],
        );
      },
    );
  }
}
