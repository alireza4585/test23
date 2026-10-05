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
import '../domain/housekeeping_task.dart';

class TaskTile extends ConsumerWidget {
  const TaskTile({super.key, required this.task, this.showAssignee = false});

  final HousekeepingTask task;
  final bool showAssignee;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final now = ref.watch(clockProvider).now();
    final overdue = task.isOverdue(now);
    final subtitle = [
      l10n.taskType(task.type),
      if (showAssignee) task.assigneeName ?? l10n.unassigned,
      if (task.status == TaskStatus.done && task.duration != null)
        l10n.taskDuration(fmt.number(task.duration!.inMinutes))
      else if (task.dueAt != null)
        l10n.dueBy(fmt.time(task.dueAt!)),
    ].join(' · ');

    return ZCard(
      key: Key('task.${task.id}'),
      padding: const EdgeInsets.symmetric(horizontal: Insets.lg, vertical: Insets.md),
      highlight: task.priority.index >= TaskPriority.high.index && task.isOpen
          ? context.taskPriorityColor(task.priority)
          : null,
      onTap: () => context.push(Routes.task(task.id)),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Text(
              fmt.digits(task.roomNumber),
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    StatusPill(
                      label: l10n.taskStatus(task.status),
                      color: context.taskStatusColor(task.status),
                    ),
                    const SizedBox(width: Insets.sm),
                    if (task.priority.index >= TaskPriority.high.index)
                      StatusPill(
                        label: l10n.taskPriority(task.priority),
                        color: context.taskPriorityColor(task.priority),
                      ),
                    if (overdue) ...[
                      const SizedBox(width: Insets.sm),
                      StatusPill(label: l10n.overdue, color: context.status.danger, icon: Icons.schedule),
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}
