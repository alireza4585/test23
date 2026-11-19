import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../application/inventory_providers.dart';
import '../domain/purchase_order.dart';

double? _parseNumber(String v) => double.tryParse(
  v.trim().replaceAll(',', '').replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}'),
);

/// "Proposed orders" on the inventory page: open purchase orders and what the
/// signed-in user may do with each. The server enforces every rule again.
class PurchaseOrdersSection extends ConsumerWidget {
  const PurchaseOrdersSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(purchaseOrdersProvider).value ?? const <PurchaseOrder>[];
    final open = orders
        .where((o) => o.status != PurchaseOrderStatus.received && o.status != PurchaseOrderStatus.cancelled)
        .toList();
    if (open.isEmpty) return const SizedBox.shrink();
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: l10n.poSectionTitle, subtitle: l10n.poSectionHint),
        for (final o in open)
          Padding(
            padding: const EdgeInsets.only(bottom: Insets.sm),
            child: _OrderCard(order: o),
          ),
        const SizedBox(height: Insets.md),
      ],
    );
  }
}

class _OrderCard extends ConsumerWidget {
  const _OrderCard({required this.order});

  final PurchaseOrder order;

  Future<void> _run(BuildContext context, Future<void> Function() call) async {
    final l10n = context.l10n;
    try {
      await call();
      if (context.mounted) showSuccess(context, l10n.poSaved);
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final user = ref.watch(sessionUserProvider)!;
    final now = DateTime.now();
    final overdue = order.isOverdue(now);
    final o = order;
    final repo = ref.read(purchaseOrdersRepositoryProvider);
    final gm = user.role == AppRole.generalManager || user.role == AppRole.superAdmin;
    final color = switch (o.status) {
      PurchaseOrderStatus.draft => context.status.info,
      PurchaseOrderStatus.awaitingApproval => context.status.warning,
      _ => overdue ? context.status.danger : context.status.success,
    };

    final buttons = <Widget>[
      if (o.status == PurchaseOrderStatus.draft && user.can(AppPermission.inventoryManage)) ...[
        OutlinedButton.icon(
          key: ValueKey('po.${o.id}.edit'),
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: Text(l10n.poEdit),
          onPressed: () => _showQuantities(context, o, received: false),
        ),
        if (o.actionId != null && user.can(AppPermission.aiActionsApprove)) ...[
          FilledButton.icon(
            key: ValueKey('po.${o.id}.approve'),
            icon: const Icon(Icons.check, size: 18),
            label: Text(l10n.poApprove),
            onPressed: () => _run(context, () => ref.read(actionsRepositoryProvider).decide(o.actionId!, approve: true)),
          ),
          TextButton(
            key: ValueKey('po.${o.id}.reject'),
            onPressed: () async {
              final note = await _askNote(context);
              if (note == null || !context.mounted) return;
              await _run(context, () => ref.read(actionsRepositoryProvider).decide(o.actionId!, approve: false, note: note));
            },
            child: Text(l10n.poReject),
          ),
        ],
      ],
      if (o.status == PurchaseOrderStatus.awaitingApproval && gm) ...[
        FilledButton.icon(
          key: ValueKey('po.${o.id}.second.approve'),
          icon: const Icon(Icons.verified_outlined, size: 18),
          label: Text(l10n.poSecondApprove),
          onPressed: () => _run(context, () => repo.secondApproval(o.id, approve: true)),
        ),
        TextButton(
          key: ValueKey('po.${o.id}.second.reject'),
          onPressed: () async {
            final note = await _askNote(context);
            if (note == null || !context.mounted) return;
            await _run(context, () => repo.secondApproval(o.id, approve: false, note: note));
          },
          child: Text(l10n.poReject),
        ),
      ],
      if (o.isOpen && user.can(AppPermission.inventoryMove))
        FilledButton.icon(
          key: ValueKey('po.${o.id}.receive'),
          icon: const Icon(Icons.move_to_inbox_outlined, size: 18),
          label: Text(l10n.poReceive),
          onPressed: () => _showQuantities(context, o, received: true),
        ),
      if ((o.isOpen || o.status == PurchaseOrderStatus.awaitingApproval) && user.can(AppPermission.inventoryManage))
        TextButton(
          key: ValueKey('po.${o.id}.cancel'),
          onPressed: () async {
            final note = await _askNote(context);
            if (note == null || !context.mounted) return;
            await _run(context, () => repo.cancel(o.id, note));
          },
          child: Text(l10n.poCancel),
        ),
    ];

    return ZCard(
      key: ValueKey('po.${o.id}'),
      highlight: color,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(o.supplierName.isEmpty ? '—' : o.supplierName, style: theme.textTheme.titleSmall)),
              StatusPill(label: l10n.poStatus(o.status.name), color: color),
            ],
          ),
          const SizedBox(height: Insets.xs),
          Text(
            [
              l10n.poLines(o.lines.length),
              if (o.total != null) l10n.poTotal(fmt.money(o.total!)),
              if (o.expectedAt != null) l10n.poExpected(fmt.dateShort(o.expectedAt!)),
            ].join(' · '),
            style: theme.textTheme.bodySmall,
          ),
          if (overdue) ...[
            const SizedBox(height: Insets.xs),
            Text(l10n.poOverdue, style: theme.textTheme.bodySmall?.copyWith(color: context.status.danger)),
          ],
          if (o.status == PurchaseOrderStatus.awaitingApproval) ...[
            const SizedBox(height: Insets.xs),
            Text(l10n.poNeedsSecond, style: theme.textTheme.bodySmall),
          ],
          const SizedBox(height: Insets.sm),
          for (final l in o.lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '• ${l.name}: ${fmt.number(l.quantity, decimals: l.quantity % 1 == 0 ? 0 : 1)} ${l.unit}'
                '${l.orderBy != null && o.status == PurchaseOrderStatus.draft ? ' — ${l10n.poOrderBy(l.orderBy!)}' : ''}'
                '${l.isNew ? ' · ${l10n.poLineNew}' : ''}',
                key: ValueKey('po.${o.id}.line.${l.itemId}'),
                style: theme.textTheme.bodySmall?.copyWith(fontWeight: l.isNew ? FontWeight.w600 : null),
              ),
            ),
          if (buttons.isNotEmpty) ...[
            const SizedBox(height: Insets.sm),
            Wrap(spacing: Insets.sm, runSpacing: Insets.xs, children: buttons),
          ],
        ],
      ),
    );
  }

  Future<String?> _askNote(BuildContext context) => showDialog<String>(
    context: context,
    builder: (_) => const _NoteDialog(),
  );

  Future<void> _showQuantities(BuildContext context, PurchaseOrder o, {required bool received}) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _QuantitiesSheet(order: o, received: received),
  );
}

class _NoteDialog extends StatefulWidget {
  const _NoteDialog();

  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
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
      content: TextField(
        key: const ValueKey('po.note'),
        controller: _note,
        autofocus: true,
        decoration: InputDecoration(hintText: l10n.poNoteHint),
        maxLines: 3,
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.cancel)),
        FilledButton(
          key: const ValueKey('po.note.ok'),
          onPressed: () {
            if (_note.text.trim().length < 3) return;
            Navigator.of(context).pop(_note.text.trim());
          },
          child: Text(l10n.confirm),
        ),
      ],
    );
  }
}

/// Edit a draft's quantities, or record what arrived.
class _QuantitiesSheet extends ConsumerStatefulWidget {
  const _QuantitiesSheet({required this.order, required this.received});

  final PurchaseOrder order;
  final bool received;

  @override
  ConsumerState<_QuantitiesSheet> createState() => _QuantitiesSheetState();
}

class _QuantitiesSheetState extends ConsumerState<_QuantitiesSheet> {
  late final Map<String, TextEditingController> _fields = {
    for (final l in widget.order.lines)
      l.itemId: TextEditingController(text: l.quantity % 1 == 0 ? l.quantity.toStringAsFixed(0) : '${l.quantity}'),
  };
  bool _saving = false;

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    final values = <String, double>{};
    for (final l in widget.order.lines) {
      final v = _parseNumber(_fields[l.itemId]!.text);
      if (v == null || v < 0) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.poInvalidQuantity)));
        return;
      }
      if (v != l.quantity || widget.received) values[l.itemId] = v;
    }
    setState(() => _saving = true);
    try {
      final repo = ref.read(purchaseOrdersRepositoryProvider);
      if (widget.received) {
        await repo.receive(widget.order.id, values);
      } else if (values.isNotEmpty) {
        await repo.editLines(widget.order.id, values);
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      showSuccess(context, l10n.poSaved);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    return Padding(
      padding: EdgeInsets.only(left: Insets.lg, right: Insets.lg, bottom: MediaQuery.viewInsetsOf(context).bottom + Insets.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.received ? l10n.poReceive : l10n.poEdit, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: Insets.md),
            for (final l in widget.order.lines)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: TextField(
                  key: ValueKey('po.line.${l.itemId}'),
                  controller: _fields[l.itemId],
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: '${l.name} (${l.unit})',
                    helperText: !widget.received && l.suggested != null ? l10n.poSuggested(fmt.number(l.suggested!, decimals: l.suggested! % 1 == 0 ? 0 : 1)) : null,
                  ),
                ),
              ),
            const SizedBox(height: Insets.sm),
            FilledButton(
              key: const ValueKey('po.save'),
              onPressed: _saving ? null : _save,
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}
