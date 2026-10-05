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
import 'alert_card.dart';

class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final inbox = ref.watch(inboxProvider);
    final user = ref.watch(sessionUserProvider)!;
    final now = ref.watch(clockProvider).now();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.notificationsTitle),
        actions: [
          IconButton(
            tooltip: l10n.markAllRead,
            icon: const Icon(Icons.done_all),
            onPressed: () => ref.read(notificationsRepositoryProvider).markAllRead(user.uid),
          ),
        ],
      ),
      body: AsyncValueView<List<InboxNotification>>(
        value: inbox,
        data: (list) => PageBody(
          maxWidth: 720,
          children: [
            SectionHeader(title: l10n.sectionAlerts),
            const AlertsSection(limit: 10),
            SectionHeader(title: l10n.notificationsTitle),
            if (list.isEmpty) EmptyState(icon: Icons.notifications_none, message: l10n.noNotifications),
            for (final n in list)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: ZCard(
                  key: Key('notification.${n.id}'),
                  padding: const EdgeInsets.symmetric(horizontal: Insets.lg, vertical: Insets.md),
                  onTap: () {
                    ref.read(notificationsRepositoryProvider).markRead(user.uid, n.id);
                    if (n.route != null) context.push(n.route!);
                  },
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(severityIcon(n.severity), color: context.severityColor(n.severity), size: 20),
                      const SizedBox(width: Insets.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              n.title,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: n.isUnread ? FontWeight.w700 : FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              n.body,
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              context.fmt.relative(n.createdAt, now, l10n),
                              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                      if (n.isUnread)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(top: 6),
                          decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle),
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
