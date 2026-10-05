import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/status_colors.dart';
import '../domain/maintenance_ticket.dart';

class TicketTile extends ConsumerWidget {
  const TicketTile({super.key, required this.ticket});

  final MaintenanceTicket ticket;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final now = ref.watch(clockProvider).now();
    final overdue = ticket.isOverdue(now);
    final location = ticket.roomNumber != null
        ? l10n.roomLabel(fmt.digits(ticket.roomNumber!))
        : (ticket.area ?? '—');

    return ZCard(
      key: Key('ticket.${ticket.id}'),
      padding: const EdgeInsets.symmetric(horizontal: Insets.lg, vertical: Insets.md),
      highlight: ticket.status.isActive ? context.ticketPriorityColor(ticket.priority) : null,
      onTap: () => context.push(Routes.ticket(ticket.id)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(ticketCategoryIcon(ticket.category), color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ticket.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall,
                ),
                const SizedBox(height: 4),
                Text(
                  '$location · ${fmt.relative(ticket.createdAt, now, l10n)}',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: Insets.sm),
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: 4,
                  children: [
                    StatusPill(
                      label: l10n.ticketStatus(ticket.status),
                      color: context.ticketStatusColor(ticket.status),
                    ),
                    StatusPill(
                      label: l10n.ticketPriority(ticket.priority),
                      color: context.ticketPriorityColor(ticket.priority),
                    ),
                    if (overdue)
                      StatusPill(
                        label: l10n.slaOverdue,
                        color: context.status.danger,
                        icon: Icons.schedule,
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
