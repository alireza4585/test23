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
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/status_colors.dart';
import '../../auth/application/auth_providers.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../rooms/application/rooms_providers.dart';
import '../../rooms/domain/room.dart';
import '../../staff/application/staff_providers.dart';
import '../../staff/domain/staff.dart';
import '../application/housekeeping_providers.dart';
import '../domain/housekeeping_task.dart';
import 'task_tile.dart';

class HousekeepingPage extends ConsumerStatefulWidget {
  const HousekeepingPage({super.key});

  @override
  ConsumerState<HousekeepingPage> createState() => _HousekeepingPageState();
}

class _HousekeepingPageState extends ConsumerState<HousekeepingPage> {
  bool _mine = false;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(sessionUserProvider)!;
    final canSeeAll = user.can(AppPermission.housekeepingViewAll);
    final mineOnly = !canSeeAll || _mine;
    final tasks = ref.watch(todayTasksProvider(mineOnly));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.hkTitle), actions: const [ShellActions()]),
      floatingActionButton: user.can(AppPermission.housekeepingAssign)
          ? FloatingActionButton.extended(
              onPressed: () => context.push(Routes.housekeepingNew),
              icon: const Icon(Icons.add),
              label: Text(l10n.newTask),
            )
          : null,
      body: Column(
        children: [
          if (canSeeAll)
            Padding(
              padding: const EdgeInsets.fromLTRB(Insets.page, Insets.sm, Insets.page, 0),
              child: SegmentedButton<bool>(
                segments: [
                  ButtonSegment(value: false, label: Text(l10n.hkAllTasks)),
                  ButtonSegment(value: true, label: Text(l10n.hkMyTasks)),
                ],
                selected: {_mine},
                onSelectionChanged: (s) => setState(() => _mine = s.first),
              ),
            ),
          Expanded(
            child: AsyncValueView<List<HousekeepingTask>>(
              value: tasks,
              data: (list) {
                if (list.isEmpty) {
                  return EmptyState(icon: Icons.task_alt, message: l10n.noTasksToday);
                }
                final done = list.where((t) => t.status == TaskStatus.done).length;
                return PageBody(
                  maxWidth: 820,
                  children: [
                    SectionHeader(
                      title: l10n.sectionToday,
                      subtitle: l10n.myWorkProgress(context.fmt.number(done), context.fmt.number(list.length)),
                    ),
                    for (final t in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: Insets.sm),
                        child: TaskTile(task: t, showAssignee: !mineOnly),
                      ),
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

/// Task detail: start → (timer) → complete. Completing a checkout clean
/// releases the room as "ready" in the same atomic write.
class TaskDetailPage extends ConsumerStatefulWidget {
  const TaskDetailPage({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<TaskDetailPage> createState() => _TaskDetailPageState();
}

class _TaskDetailPageState extends ConsumerState<TaskDetailPage> {
  final _notes = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action, String success) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) showSuccess(context, success);
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final task = ref.watch(taskProvider(widget.taskId));
    final user = ref.watch(sessionUserProvider)!;
    final settings = ref.watch(hotelSettingsProvider);
    final now = ref.watch(clockProvider).now();
    final actions = ref.read(housekeepingActionsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.hkTitle)),
      body: AsyncValueView<HousekeepingTask?>(
        value: task,
        data: (t) {
          if (t == null) return EmptyState(message: l10n.errorNotFound);
          final canWork = t.assigneeId == user.uid || user.can(AppPermission.housekeepingAssign);
          final target = settings.targetCleanMinutes[t.type.name];
          final elapsed = t.startedAt == null ? null : now.difference(t.startedAt!).inMinutes;
          return PageBody(
            maxWidth: 640,
            children: [
              ZCard(
                highlight: context.taskStatusColor(t.status),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          l10n.roomLabel(fmt.digits(t.roomNumber)),
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const Spacer(),
                        StatusPill(label: l10n.taskStatus(t.status), color: context.taskStatusColor(t.status)),
                      ],
                    ),
                    const SizedBox(height: Insets.sm),
                    Text(l10n.taskType(t.type), style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: Insets.md),
                    LabeledValue(label: l10n.priorityLabel, value: l10n.taskPriority(t.priority)),
                    LabeledValue(label: l10n.assignee, value: t.assigneeName ?? l10n.unassigned),
                    if (t.dueAt != null) LabeledValue(label: l10n.dueBy(''), value: fmt.time(t.dueAt!)),
                    if (target != null) LabeledValue(label: l10n.taskTarget(''), value: l10n.minutesValue(fmt.number(target))),
                    if (t.status == TaskStatus.inProgress && elapsed != null)
                      LabeledValue(label: l10n.taskElapsed(''), value: l10n.minutesValue(fmt.number(elapsed))),
                    if (t.duration != null)
                      LabeledValue(label: l10n.taskDuration(''), value: l10n.minutesValue(fmt.number(t.duration!.inMinutes))),
                    if (t.notes != null) ...[
                      const Divider(height: Insets.xl),
                      Text(t.notes!),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: Insets.xl),
              if (canWork && t.status == TaskStatus.pending)
                FilledButton.icon(
                  key: const Key('task.start'),
                  onPressed: _busy ? null : () => _run(() => actions.start(t), l10n.taskStarted),
                  icon: const Icon(Icons.play_arrow_rounded),
                  label: Text(l10n.startTask),
                ),
              if (canWork && t.status == TaskStatus.inProgress) ...[
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: InputDecoration(labelText: l10n.completionNotesHint),
                ),
                const SizedBox(height: Insets.md),
                FilledButton.icon(
                  key: const Key('task.complete'),
                  onPressed: _busy
                      ? null
                      : () => _run(
                          () => actions.complete(t, notes: _notes.text.trim().isEmpty ? null : _notes.text.trim()),
                          l10n.taskCompleted,
                        ),
                  icon: const Icon(Icons.check_rounded),
                  label: Text(l10n.completeTask),
                ),
              ],
              const SizedBox(height: Insets.md),
              OutlinedButton.icon(
                icon: const Icon(Icons.report_gmailerrorred),
                label: Text(l10n.reportFaultForRoom),
                onPressed: () => context.push(
                  Uri(path: Routes.maintenanceNew, queryParameters: {'roomId': t.roomId}).toString(),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class NewTaskPage extends ConsumerStatefulWidget {
  const NewTaskPage({super.key});

  @override
  ConsumerState<NewTaskPage> createState() => _NewTaskPageState();
}

class _NewTaskPageState extends ConsumerState<NewTaskPage> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();
  Room? _room;
  StaffMember? _assignee;
  HousekeepingTaskType _type = HousekeepingTaskType.checkoutClean;
  TaskPriority _priority = TaskPriority.normal;
  bool _busy = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(housekeepingActionsProvider).create(
        HousekeepingTaskDraft(
          roomId: _room!.id,
          roomNumber: _room!.number,
          type: _type,
          priority: _priority,
          assigneeId: _assignee?.userId,
          assigneeName: _assignee?.fullName,
          notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        ),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.taskCreated);
      context.pop();
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final rooms = ref.watch(roomsProvider).value ?? const [];
    final housekeepers = (ref.watch(staffListProvider).value ?? const [])
        .where((s) => s.userId != null && s.role == AppRole.housekeepingStaff)
        .toList();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.newTask)),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 560,
          children: [
            DropdownButtonFormField<Room>(
              initialValue: _room,
              decoration: InputDecoration(labelText: l10n.selectRoom),
              items: [
                for (final r in rooms)
                  DropdownMenuItem(
                    value: r,
                    child: Text('${l10n.roomLabel(fmt.digits(r.number))} · ${l10n.roomStatus(r.status)}'),
                  ),
              ],
              onChanged: (r) => setState(() => _room = r),
              validator: (r) => r == null ? l10n.requiredField : null,
            ),
            const SizedBox(height: Insets.md),
            DropdownButtonFormField<HousekeepingTaskType>(
              initialValue: _type,
              decoration: InputDecoration(labelText: l10n.taskTypeLabel),
              items: [
                for (final t in HousekeepingTaskType.values)
                  DropdownMenuItem(value: t, child: Text(l10n.taskType(t))),
              ],
              onChanged: (t) => setState(() => _type = t ?? _type),
            ),
            const SizedBox(height: Insets.md),
            DropdownButtonFormField<StaffMember>(
              initialValue: _assignee,
              decoration: InputDecoration(labelText: l10n.selectAssignee),
              items: [
                for (final s in housekeepers) DropdownMenuItem(value: s, child: Text(s.fullName)),
              ],
              onChanged: (s) => setState(() => _assignee = s),
            ),
            const SizedBox(height: Insets.md),
            Text(l10n.priorityLabel, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: Insets.sm),
            SegmentedButton<TaskPriority>(
              segments: [
                for (final p in TaskPriority.values)
                  ButtonSegment(value: p, label: Text(l10n.taskPriority(p))),
              ],
              selected: {_priority},
              onSelectionChanged: (s) => setState(() => _priority = s.first),
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _notes,
              maxLines: 3,
              decoration: InputDecoration(labelText: '${l10n.notesLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(l10n.createTask)),
          ],
        ),
      ),
    );
  }
}
