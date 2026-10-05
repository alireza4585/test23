import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/domain/media_file.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/platform/platform_providers.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/status_colors.dart';
import '../../auth/application/auth_providers.dart';
import '../../rooms/application/rooms_providers.dart';
import '../../rooms/domain/room.dart';
import '../../staff/domain/staff.dart';
import '../application/maintenance_providers.dart';
import '../domain/maintenance_ticket.dart';
import '../domain/ticket_workflow.dart';
import 'ticket_tile.dart';

class MaintenancePage extends ConsumerWidget {
  const MaintenancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final user = ref.watch(sessionUserProvider)!;
    final canSeeAll = user.can(AppPermission.maintenanceViewAll);
    final tabs = <(String, TicketQuery)>[
      (l10n.tabActive, (mine: !canSeeAll, activeOnly: true)),
      if (canSeeAll) (l10n.tabMine, (mine: true, activeOnly: false)),
      (l10n.tabAll, (mine: !canSeeAll, activeOnly: false)),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.mntTitle),
          actions: const [ShellActions()],
          bottom: TabBar(tabs: [for (final t in tabs) Tab(text: t.$1)]),
        ),
        floatingActionButton: user.can(AppPermission.maintenanceReport)
            ? FloatingActionButton.extended(
                key: const Key('maintenance.new'),
                onPressed: () => context.push(Routes.maintenanceNew),
                icon: const Icon(Icons.report_gmailerrorred),
                label: Text(l10n.mntNewTicket),
              )
            : null,
        body: TabBarView(
          children: [for (final t in tabs) _TicketList(query: t.$2)],
        ),
      ),
    );
  }
}

class _TicketList extends ConsumerWidget {
  const _TicketList({required this.query});

  final TicketQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(ticketsProvider(query));
    return AsyncValueView<List<MaintenanceTicket>>(
      value: tickets,
      data: (list) {
        if (list.isEmpty) {
          return EmptyState(icon: Icons.handyman_outlined, message: context.l10n.noTickets);
        }
        return PageBody(
          maxWidth: 820,
          children: [
            const SizedBox(height: Insets.sm),
            for (final t in list)
              Padding(padding: const EdgeInsets.only(bottom: Insets.sm), child: TicketTile(ticket: t)),
            const SizedBox(height: 72),
          ],
        );
      },
    );
  }
}

/// Fault report — designed for staff standing in a room: title, category,
/// priority, location prefilled from the room, optional photo.
class NewTicketPage extends ConsumerStatefulWidget {
  const NewTicketPage({super.key, this.roomId});

  final String? roomId;

  @override
  ConsumerState<NewTicketPage> createState() => _NewTicketPageState();
}

class _NewTicketPageState extends ConsumerState<NewTicketPage> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _area = TextEditingController();
  TicketCategory _category = TicketCategory.other;
  TicketPriority _priority = TicketPriority.medium;
  bool _inRoom = true;
  Room? _room;
  final List<MediaFile> _photos = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _inRoom = true;
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _area.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(bool camera) async {
    try {
      final file = await ref.read(mediaPickerProvider).pickImage(fromCamera: camera);
      if (file != null) setState(() => _photos.add(file));
    } catch (e) {
      if (mounted) showFailure(context, e);
    }
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      final id = await ref.read(maintenanceActionsProvider).report(
        TicketDraft(
          title: _title.text.trim(),
          description: _description.text.trim(),
          category: _category,
          priority: _priority,
          roomId: _inRoom ? _room?.id : null,
          roomNumber: _inRoom ? _room?.number : null,
          area: _inRoom ? null : _area.text.trim(),
          photos: List.of(_photos),
        ),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.ticketCreated);
      context.pushReplacement(Routes.ticket(id));
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
    if (_room == null && widget.roomId != null) {
      for (final r in rooms) {
        if (r.id == widget.roomId) _room = r;
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.mntNewTicket)),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 600,
          children: [
            TextFormField(
              key: const Key('ticket.title'),
              controller: _title,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: l10n.ticketTitleLabel, hintText: l10n.ticketTitleHint),
              validator: (v) => (v ?? '').trim().length < 3 ? l10n.requiredField : null,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _description,
              maxLines: 3,
              decoration: InputDecoration(labelText: '${l10n.ticketDescriptionLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.lg),
            Text(l10n.ticketCategoryLabel, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: Insets.sm),
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              children: [
                for (final c in TicketCategory.values)
                  ChoiceChip(
                    avatar: Icon(ticketCategoryIcon(c), size: 16),
                    label: Text(l10n.ticketCategory(c)),
                    selected: _category == c,
                    onSelected: (_) => setState(() => _category = c),
                  ),
              ],
            ),
            const SizedBox(height: Insets.lg),
            Text(l10n.priorityLabel, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: Insets.sm),
            SegmentedButton<TicketPriority>(
              segments: [
                for (final p in TicketPriority.values)
                  ButtonSegment(value: p, label: Text(l10n.ticketPriority(p))),
              ],
              selected: {_priority},
              onSelectionChanged: (s) => setState(() => _priority = s.first),
            ),
            const SizedBox(height: Insets.lg),
            Text(l10n.ticketLocationLabel, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: Insets.sm),
            SegmentedButton<bool>(
              segments: [
                ButtonSegment(value: true, label: Text(l10n.locationRoom), icon: const Icon(Icons.meeting_room_outlined)),
                ButtonSegment(value: false, label: Text(l10n.locationArea), icon: const Icon(Icons.location_city)),
              ],
              selected: {_inRoom},
              onSelectionChanged: (s) => setState(() => _inRoom = s.first),
            ),
            const SizedBox(height: Insets.md),
            if (_inRoom)
              DropdownButtonFormField<Room>(
                initialValue: _room,
                decoration: InputDecoration(labelText: l10n.selectRoom),
                items: [
                  for (final r in rooms)
                    DropdownMenuItem(value: r, child: Text(l10n.roomLabel(fmt.digits(r.number)))),
                ],
                onChanged: (r) => setState(() => _room = r),
                validator: (r) => r == null ? l10n.requiredField : null,
              )
            else
              TextFormField(
                controller: _area,
                decoration: InputDecoration(labelText: l10n.locationArea, hintText: l10n.areaHint),
                validator: (v) => (v ?? '').trim().isEmpty ? l10n.requiredField : null,
              ),
            const SizedBox(height: Insets.lg),
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _addPhoto(true),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(l10n.takePhoto),
                ),
                OutlinedButton.icon(
                  onPressed: () => _addPhoto(false),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(l10n.chooseFromGallery),
                ),
                if (_photos.isNotEmpty) Text(l10n.photosCount(fmt.number(_photos.length))),
              ],
            ),
            if (_photos.isNotEmpty) ...[
              const SizedBox(height: Insets.md),
              SizedBox(
                height: 84,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _photos.length,
                  separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
                  itemBuilder: (_, i) => ClipRRect(
                    borderRadius: BorderRadius.circular(Radii.sm),
                    child: Image.memory(_photos[i].bytes, width: 84, height: 84, fit: BoxFit.cover),
                  ),
                ),
              ),
            ],
            const SizedBox(height: Insets.xl),
            FilledButton.icon(
              key: const Key('ticket.submit'),
              onPressed: _busy ? null : _submit,
              icon: const Icon(Icons.send_rounded),
              label: Text(l10n.submitTicket),
            ),
          ],
        ),
      ),
    );
  }
}

class TicketDetailPage extends ConsumerWidget {
  const TicketDetailPage({super.key, required this.ticketId});

  final String ticketId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final ticket = ref.watch(ticketProvider(ticketId));
    final events = ref.watch(ticketEventsProvider(ticketId)).value ?? const [];
    final user = ref.watch(sessionUserProvider)!;
    final now = ref.watch(clockProvider).now();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.mntTitle)),
      body: AsyncValueView<MaintenanceTicket?>(
        value: ticket,
        data: (t) {
          if (t == null) return EmptyState(message: l10n.errorNotFound);
          final targets = TicketWorkflow.allowedTargets(user, t);
          final overdue = t.isOverdue(now);
          return PageBody(
            maxWidth: 720,
            children: [
              ZCard(
                highlight: context.ticketPriorityColor(t.priority),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(ticketCategoryIcon(t.category), color: theme.colorScheme.onSurfaceVariant),
                        const SizedBox(width: Insets.sm),
                        Text(l10n.ticketCategory(t.category), style: theme.textTheme.labelLarge),
                        const Spacer(),
                        StatusPill(label: l10n.ticketStatus(t.status), color: context.ticketStatusColor(t.status)),
                      ],
                    ),
                    const SizedBox(height: Insets.md),
                    Text(t.title, style: theme.textTheme.titleLarge),
                    if (t.description.isNotEmpty) ...[
                      const SizedBox(height: Insets.sm),
                      Text(t.description, style: theme.textTheme.bodyMedium?.copyWith(height: 1.6)),
                    ],
                    const Divider(height: Insets.xl),
                    LabeledValue(
                      label: l10n.ticketLocationLabel,
                      value: t.roomNumber != null ? l10n.roomLabel(fmt.digits(t.roomNumber!)) : (t.area ?? '—'),
                    ),
                    LabeledValue(label: l10n.priorityLabel, value: l10n.ticketPriority(t.priority)),
                    LabeledValue(label: l10n.assignee, value: t.assigneeName ?? l10n.unassigned),
                    LabeledValue(label: l10n.reportedBy(''), value: t.reportedByName),
                    Padding(
                      padding: const EdgeInsets.only(top: Insets.sm),
                      child: overdue
                          ? StatusPill(label: l10n.slaOverdue, color: context.status.danger, icon: Icons.schedule)
                          : Text(l10n.slaDue(fmt.dateTime(t.slaDueAt)), style: theme.textTheme.bodySmall),
                    ),
                    if (t.photoPaths.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: Insets.sm),
                        child: Text(l10n.photosCount(fmt.number(t.photoPaths.length)), style: theme.textTheme.bodySmall),
                      ),
                  ],
                ),
              ),
              if (user.can(AppPermission.maintenanceManage) && t.status.isActive) ...[
                const SizedBox(height: Insets.md),
                OutlinedButton.icon(
                  icon: const Icon(Icons.engineering_outlined),
                  label: Text(l10n.assignTo),
                  onPressed: () => _assign(context, ref, t),
                ),
              ],
              if (targets.isNotEmpty) ...[
                SectionHeader(title: l10n.changeStatus),
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: Insets.sm,
                  children: [
                    for (final s in targets)
                      FilledButton.tonal(
                        key: Key('ticket.to.${s.name}'),
                        onPressed: () => _changeStatus(context, ref, t, s),
                        child: Text(l10n.changeStatusTo(l10n.ticketStatus(s))),
                      ),
                  ],
                ),
              ],
              SectionHeader(title: l10n.timeline),
              for (final e in events)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    radius: 16,
                    backgroundColor: theme.colorScheme.surfaceContainerHigh,
                    child: Icon(switch (e.type) {
                      TicketEventType.created => Icons.flag_outlined,
                      TicketEventType.assigned => Icons.engineering_outlined,
                      TicketEventType.statusChanged => Icons.sync_alt,
                      TicketEventType.comment => Icons.chat_bubble_outline,
                    }, size: 16),
                  ),
                  title: Text(switch (e.type) {
                    TicketEventType.created => l10n.eventCreated,
                    TicketEventType.assigned => l10n.eventAssigned(e.note ?? ''),
                    TicketEventType.statusChanged => l10n.eventStatus(
                      e.fromStatus == null ? '—' : l10n.ticketStatus(e.fromStatus!),
                      e.toStatus == null ? '—' : l10n.ticketStatus(e.toStatus!),
                    ),
                    TicketEventType.comment => l10n.eventComment,
                  }),
                  subtitle: Text(
                    [
                      e.actorName,
                      fmt.dateTime(e.at),
                      if (e.type == TicketEventType.statusChanged && e.note != null) e.note!,
                    ].join(' · '),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _changeStatus(
    BuildContext context,
    WidgetRef ref,
    MaintenanceTicket t,
    TicketStatus to,
  ) async {
    final l10n = context.l10n;
    String? note;
    if (to == TicketStatus.resolved) {
      note = await _askNote(context, l10n.resolutionNoteHint);
      if (note == null) return;
    }
    try {
      await ref.read(maintenanceActionsProvider).changeStatus(t, to, note: note);
      if (context.mounted) showSuccess(context, l10n.ticketStatusChanged);
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }

  Future<String?> _askNote(BuildContext context, String hint) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: TextField(
          controller: controller,
          maxLines: 3,
          autofocus: true,
          decoration: InputDecoration(labelText: hint),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.l10n.cancel)),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: Text(context.l10n.confirm),
          ),
        ],
      ),
    ).whenComplete(controller.dispose);
  }

  Future<void> _assign(BuildContext context, WidgetRef ref, MaintenanceTicket t) async {
    final technicians = ref.read(techniciansProvider);
    final chosen = await showModalBottomSheet<StaffMember>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(context.l10n.assignTo, style: Theme.of(context).textTheme.titleMedium)),
            for (final s in technicians)
              ListTile(
                leading: const Icon(Icons.engineering_outlined),
                title: Text(s.fullName),
                subtitle: Text(context.l10n.department(s.department)),
                selected: s.userId == t.assigneeId,
                onTap: () => Navigator.pop(sheetContext, s),
              ),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    try {
      await ref.read(maintenanceActionsProvider).assign(t, chosen);
      if (context.mounted) showSuccess(context, context.l10n.ticketAssigned);
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }
}
