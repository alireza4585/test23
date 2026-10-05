import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/status_colors.dart';
import '../../auth/application/auth_providers.dart';
import '../../housekeeping/application/housekeeping_providers.dart';
import '../../housekeeping/presentation/task_tile.dart';
import '../application/rooms_providers.dart';
import '../domain/room.dart';
import '../domain/room_status_policy.dart';

/// Room board grouped by floor with status filters. Tap a room to see its
/// details and change status (only transitions the role allows are offered).
class RoomsPage extends ConsumerStatefulWidget {
  const RoomsPage({super.key});

  @override
  ConsumerState<RoomsPage> createState() => _RoomsPageState();
}

class _RoomsPageState extends ConsumerState<RoomsPage> {
  RoomStatus? _filter;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final rooms = ref.watch(roomsProvider);
    final counts = ref.watch(roomStatusCountsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.roomsTitle), actions: const [ShellActions()]),
      body: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Insets.page, vertical: Insets.sm),
              children: [
                ChoiceChip(
                  label: Text('${l10n.filterAll} ${fmt.number(counts.values.fold(0, (a, b) => a + b))}'),
                  selected: _filter == null,
                  onSelected: (_) => setState(() => _filter = null),
                ),
                for (final s in RoomStatus.values) ...[
                  const SizedBox(width: Insets.sm),
                  ChoiceChip(
                    key: Key('rooms.filter.${s.name}'),
                    avatar: Icon(roomStatusIcon(s), size: 16, color: context.roomStatusColor(s)),
                    label: Text('${l10n.roomStatus(s)} ${fmt.number(counts[s] ?? 0)}'),
                    selected: _filter == s,
                    onSelected: (_) => setState(() => _filter = _filter == s ? null : s),
                  ),
                ],
              ],
            ),
          ),
          Expanded(
            child: AsyncValueView<List<Room>>(
              value: rooms,
              onRetry: () => ref.invalidate(roomsProvider),
              data: (all) {
                final visible = _filter == null ? all : all.where((r) => r.status == _filter).toList();
                if (visible.isEmpty) return EmptyState(message: l10n.emptyGeneric);
                final floors = <int, List<Room>>{};
                for (final r in visible) {
                  floors.putIfAbsent(r.floor, () => []).add(r);
                }
                final keys = floors.keys.toList()..sort();
                return PageBody(
                  children: [
                    for (final floor in keys) ...[
                      SectionHeader(
                        title: l10n.floorLabel(fmt.number(floor)),
                        subtitle: l10n.roomsCount(fmt.number(floors[floor]!.length)),
                      ),
                      ResponsiveGrid(
                        minTileWidth: 92,
                        spacing: Insets.sm,
                        maxColumns: 10,
                        children: [for (final r in floors[floor]!) _RoomTile(room: r)],
                      ),
                    ],
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _RoomTile extends StatelessWidget {
  const _RoomTile({required this.room});

  final Room room;

  @override
  Widget build(BuildContext context) {
    final color = context.roomStatusColor(room.status);
    final theme = Theme.of(context);
    return Material(
      key: Key('room.${room.number}'),
      color: color.withValues(alpha: 0.10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        side: BorderSide(color: color.withValues(alpha: 0.45)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(Radii.sm),
        onTap: () => context.push(Routes.room(room.id)),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Insets.md, horizontal: Insets.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                context.fmt.digits(room.number),
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Icon(roomStatusIcon(room.status), size: 16, color: color),
              const SizedBox(height: 2),
              Text(
                context.l10n.roomStatus(room.status),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class RoomDetailPage extends ConsumerWidget {
  const RoomDetailPage({super.key, required this.roomId});

  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final room = ref.watch(roomProvider(roomId));
    final user = ref.watch(sessionUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(room.value == null ? '' : l10n.roomLabel(fmt.digits(room.value!.number))),
      ),
      body: AsyncValueView<Room?>(
        value: room,
        data: (r) {
          if (r == null || user == null) return EmptyState(message: l10n.errorNotFound);
          final targets = RoomStatusPolicy.allowedTargets(user, r.status);
          final color = context.roomStatusColor(r.status);
          final tasks = (ref.watch(todayTasksProvider(false)).value ?? const [])
              .where((t) => t.roomId == r.id)
              .toList();
          final now = ref.watch(clockProvider).now();
          return PageBody(
            maxWidth: 720,
            children: [
              ZCard(
                highlight: color,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(roomStatusIcon(r.status), color: color),
                        const SizedBox(width: Insets.sm),
                        Text(l10n.roomStatus(r.status), style: Theme.of(context).textTheme.titleMedium),
                      ],
                    ),
                    const SizedBox(height: Insets.md),
                    LabeledValue(label: l10n.floorLabel(''), value: fmt.number(r.floor)),
                    LabeledValue(label: l10n.taskTypeLabel, value: l10n.roomType(r.type)),
                    if (r.updatedAt != null)
                      Text(
                        l10n.lastUpdatedBy(fmt.relative(r.updatedAt!, now, l10n), r.updatedByName ?? '—'),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if (r.note != null) ...[
                      const SizedBox(height: Insets.sm),
                      Text(r.note!, style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ],
                ),
              ),
              SectionHeader(title: l10n.changeStatus),
              if (targets.isEmpty)
                Text(l10n.noAllowedTransitions, style: Theme.of(context).textTheme.bodySmall)
              else
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: Insets.sm,
                  children: [
                    for (final t in targets)
                      OutlinedButton.icon(
                        key: Key('room.setStatus.${t.name}'),
                        icon: Icon(roomStatusIcon(t), color: context.roomStatusColor(t)),
                        label: Text(l10n.changeStatusTo(l10n.roomStatus(t))),
                        onPressed: () async {
                          try {
                            await ref.read(roomsActionsProvider).changeStatus(r, t);
                            if (context.mounted) showSuccess(context, l10n.statusUpdated);
                          } catch (e) {
                            if (context.mounted) showFailure(context, e);
                          }
                        },
                      ),
                  ],
                ),
              if (tasks.isNotEmpty) ...[
                SectionHeader(title: l10n.roomTasks),
                for (final t in tasks)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Insets.sm),
                    child: TaskTile(task: t, showAssignee: true),
                  ),
              ],
              if (user.can(AppPermission.maintenanceReport)) ...[
                const SizedBox(height: Insets.xl),
                OutlinedButton.icon(
                  icon: const Icon(Icons.report_gmailerrorred),
                  label: Text(l10n.reportFaultForRoom),
                  onPressed: () => context.push(
                    Uri(path: Routes.maintenanceNew, queryParameters: {'roomId': r.id}).toString(),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
