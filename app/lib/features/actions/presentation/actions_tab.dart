import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/action_providers.dart';
import '../domain/ai_action.dart';

/// Action Center tab of the Recommendation Center: pending actions first,
/// then the ledger (executed with their measured outcome, rejected, expired).
class ActionsTab extends ConsumerWidget {
  const ActionsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    return AsyncValueView<List<AiAction>>(
      value: ref.watch(actionsProvider),
      data: (all) {
        final pending = [for (final a in all) if (a.isPending) a];
        final done = [for (final a in all) if (!a.isPending) a];
        return PageBody(
          maxWidth: 820,
          children: [
            Text(l10n.actionsSubtitle, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: Insets.md),
            if (all.isEmpty) EmptyState(icon: Icons.playlist_add_check, message: l10n.noActions),
            for (final a in [...pending, ...done])
              Padding(padding: const EdgeInsets.only(bottom: Insets.md), child: ActionCard(action: a)),
          ],
        );
      },
    );
  }
}

class ActionCard extends ConsumerStatefulWidget {
  const ActionCard({super.key, required this.action});

  final AiAction action;

  @override
  ConsumerState<ActionCard> createState() => _ActionCardState();
}

class _ActionCardState extends ConsumerState<ActionCard> {
  bool _busy = false;

  Future<void> _decide(bool approve) async {
    final l10n = context.l10n;
    var note = '';
    if (!approve) {
      final typed = await showDialog<String>(context: context, builder: (_) => const _RejectDialog());
      if (typed == null) return;
      note = typed;
    }
    setState(() => _busy = true);
    try {
      await ref.read(actionCenterProvider).decide(widget.action, approve: approve, note: note);
      if (mounted) showSuccess(context, approve ? l10n.actionApproved : l10n.actionRejected);
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
    final a = widget.action;
    final theme = Theme.of(context);
    final status = context.status;
    final center = ref.watch(actionCenterProvider);
    final canDecide = center.canDecide(a);
    final o = a.outcome;
    final color = switch (a.status) {
      ActionStatus.proposed => status.warning,
      ActionStatus.executed => status.success,
      ActionStatus.failed => status.danger,
      ActionStatus.rejected || ActionStatus.expired => theme.colorScheme.outline,
    };
    return ZCard(
      key: Key('action.${a.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Insets.sm,
            runSpacing: Insets.xs,
            children: [
              StatusPill(label: l10n.actionStatus(a.status.name), color: color),
              StatusPill(label: l10n.actionType(a.type.name), color: theme.colorScheme.primary),
              StatusPill(label: l10n.actionDepartment(a.department.name), color: theme.colorScheme.secondary),
            ],
          ),
          const SizedBox(height: Insets.sm),
          Text(a.title, style: theme.textTheme.titleSmall),
          if (a.reason.isNotEmpty) ...[
            const SizedBox(height: Insets.xs),
            Text(a.reason, style: theme.textTheme.bodySmall),
          ],
          if (a.decidedByName != null && a.decidedAt != null) ...[
            const SizedBox(height: Insets.xs),
            Text(l10n.actionDecidedBy(a.decidedByName!, fmt.dateTime(a.decidedAt!)), style: theme.textTheme.labelSmall),
          ],
          if (a.decisionNote != null && a.decisionNote!.isNotEmpty) Text('«${a.decisionNote}»', style: theme.textTheme.labelSmall),
          if (a.error != null && a.error!.isNotEmpty) Text(l10n.actionFailedReason(a.error!), style: theme.textTheme.labelSmall?.copyWith(color: status.danger)),
          if (o != null && a.status == ActionStatus.executed) ...[
            const SizedBox(height: Insets.sm),
            Text(
              switch (o.status) {
                'measured' when o.value != null => l10n.actionOutcomeMeasured(
                  '${fmt.number(o.value!)} ${o.unit ?? ''}'.trim(),
                  o.ciLow == null ? '—' : fmt.number(o.ciLow!),
                  o.ciHigh == null ? '—' : fmt.number(o.ciHigh!),
                ),
                'inconclusive' => l10n.actionOutcomeInconclusive,
                'notMeasurable' => l10n.actionOutcomeNotMeasurable,
                _ => l10n.actionOutcomePending,
              },
              key: Key('action.${a.id}.outcome'),
              style: theme.textTheme.bodySmall,
            ),
            Text(l10n.actionOutcomeLabel, style: theme.textTheme.labelSmall),
          ],
          if (a.isPending) ...[
            const SizedBox(height: Insets.md),
            if (canDecide)
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.xs,
                children: [
                  FilledButton.icon(
                    key: Key('action.${a.id}.approve'),
                    onPressed: _busy ? null : () => _decide(true),
                    icon: const Icon(Icons.check),
                    label: Text(l10n.actionApprove),
                  ),
                  OutlinedButton(
                    key: Key('action.${a.id}.reject'),
                    onPressed: _busy ? null : () => _decide(false),
                    child: Text(l10n.actionReject),
                  ),
                ],
              )
            else
              Text(l10n.actionNotYours, key: Key('action.${a.id}.notYours'), style: theme.textTheme.labelSmall),
          ],
        ],
      ),
    );
  }
}

/// Asks for the reason of a rejection; returns it, or null when cancelled.
class _RejectDialog extends StatefulWidget {
  const _RejectDialog();

  @override
  State<_RejectDialog> createState() => _RejectDialogState();
}

class _RejectDialogState extends State<_RejectDialog> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(l10n.actionReject),
      content: TextField(
        key: const Key('action.rejectNote'),
        controller: _note,
        decoration: InputDecoration(labelText: l10n.actionRejectNote),
        maxLines: 2,
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.cancel)),
        FilledButton(
          key: const Key('action.rejectConfirm'),
          onPressed: () => Navigator.of(context).pop(_note.text),
          child: Text(l10n.actionReject),
        ),
      ],
    );
  }
}
