import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../application/inventory_providers.dart';
import '../domain/inventory_item.dart';

double? _parseNumber(String v) => double.tryParse(
  v.trim().replaceAll(',', '').replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}'),
);

class InventoryPage extends ConsumerStatefulWidget {
  const InventoryPage({super.key});

  @override
  ConsumerState<InventoryPage> createState() => _InventoryPageState();
}

class _InventoryPageState extends ConsumerState<InventoryPage> {
  bool _lowOnly = false;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final user = ref.watch(sessionUserProvider)!;
    final items = ref.watch(inventoryItemsProvider);
    final lowCount = ref.watch(lowStockItemsProvider).length;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.invTitle), actions: const [ShellActions()]),
      floatingActionButton: user.can(AppPermission.inventoryManage)
          ? FloatingActionButton.extended(
              onPressed: () => context.push(Routes.inventoryNew),
              icon: const Icon(Icons.add),
              label: Text(l10n.newItem),
            )
          : null,
      body: AsyncValueView<List<InventoryItem>>(
        value: items,
        data: (all) {
          final q = _query.trim().toLowerCase();
          final visible = all.where((i) {
            if (_lowOnly && !i.isLowStock) return false;
            if (q.isEmpty) return true;
            return i.name.toLowerCase().contains(q) || i.sku.toLowerCase().contains(q);
          }).toList();
          return PageBody(
            maxWidth: 900,
            children: [
              TextField(
                decoration: InputDecoration(
                  hintText: l10n.search,
                  prefixIcon: const Icon(Icons.search),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
              const SizedBox(height: Insets.sm),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: FilterChip(
                  label: Text('${l10n.filterLowStock} ${fmt.number(lowCount)}'),
                  selected: _lowOnly,
                  onSelected: (v) => setState(() => _lowOnly = v),
                ),
              ),
              const SizedBox(height: Insets.sm),
              if (visible.isEmpty) EmptyState(message: l10n.emptyGeneric),
              for (final i in visible)
                Padding(
                  padding: const EdgeInsets.only(bottom: Insets.sm),
                  child: _ItemTile(item: i),
                ),
              const SizedBox(height: 72),
            ],
          );
        },
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item});

  final InventoryItem item;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final color = item.isOutOfStock
        ? context.status.danger
        : item.isLowStock
        ? context.status.warning
        : null;
    final ratio = item.reorderLevel <= 0 ? 1.0 : (item.quantity / (item.reorderLevel * 3)).clamp(0.0, 1.0);
    return ZCard(
      key: Key('item.${item.id}'),
      highlight: color,
      onTap: () => context.push(Routes.item(item.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(item.name, style: theme.textTheme.titleSmall)),
              if (color != null)
                StatusPill(
                  label: item.isOutOfStock ? l10n.outOfStock : l10n.lowStock,
                  color: color,
                  icon: Icons.warning_amber_rounded,
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${l10n.inventoryCategory(item.category)} · ${item.sku}${item.location == null ? '' : ' · ${item.location}'}',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: Insets.sm),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: ratio,
                    minHeight: 6,
                    color: color ?? context.status.success,
                    backgroundColor: theme.colorScheme.surfaceContainerHigh,
                  ),
                ),
              ),
              const SizedBox(width: Insets.md),
              Text(
                '${fmt.number(item.quantity)} ${item.unit}',
                style: theme.textTheme.labelLarge,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class InventoryItemPage extends ConsumerWidget {
  const InventoryItemPage({super.key, required this.itemId});

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final item = ref.watch(inventoryItemProvider(itemId));
    final movements = ref.watch(itemMovementsProvider(itemId)).value ?? const [];
    final user = ref.watch(sessionUserProvider)!;

    return Scaffold(
      appBar: AppBar(title: Text(item.value?.name ?? l10n.invTitle)),
      floatingActionButton: user.can(AppPermission.inventoryMove) && item.value != null
          ? FloatingActionButton.extended(
              key: const Key('inventory.move'),
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => _MovementSheet(item: item.value!),
              ),
              icon: const Icon(Icons.swap_vert),
              label: Text(l10n.recordMovement),
            )
          : null,
      body: AsyncValueView<InventoryItem?>(
        value: item,
        data: (i) {
          if (i == null) return EmptyState(message: l10n.errorNotFound);
          return PageBody(
            maxWidth: 720,
            children: [
              ResponsiveGrid(
                minTileWidth: 150,
                children: [
                  KpiCard(
                    label: l10n.onHand,
                    value: fmt.number(i.quantity),
                    unit: i.unit,
                    emphasis: true,
                    caption: i.isLowStock ? l10n.lowStock : null,
                    captionColor: i.isLowStock ? context.status.warning : null,
                  ),
                  KpiCard(label: l10n.reorderLevel, value: fmt.number(i.reorderLevel), unit: i.unit),
                  if (i.stockValue != null)
                    KpiCard(label: l10n.stockValue, value: fmt.money(i.stockValue!), unit: l10n.currencyRial),
                ],
              ),
              const SizedBox(height: Insets.md),
              ZCard(
                child: Column(
                  children: [
                    LabeledValue(label: l10n.skuLabel, value: i.sku),
                    LabeledValue(label: l10n.unitLabel, value: i.unit),
                    LabeledValue(label: l10n.ticketCategoryLabel, value: l10n.inventoryCategory(i.category)),
                    if (i.location != null) LabeledValue(label: l10n.locationLabel, value: i.location!),
                  ],
                ),
              ),
              SectionHeader(title: l10n.movements),
              if (movements.isEmpty) Text(l10n.noMovements, style: Theme.of(context).textTheme.bodySmall),
              for (final m in movements)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    m.delta >= 0 ? Icons.south_west : Icons.north_east,
                    color: m.delta >= 0 ? context.status.success : context.status.warning,
                  ),
                  title: Text('${l10n.movementType(m.type)} ${fmt.number(m.delta.abs())} ${i.unit}'),
                  subtitle: Text(
                    [m.actorName, fmt.dateTime(m.createdAt), if (m.reason != null) m.reason!].join(' · '),
                  ),
                  trailing: Text(fmt.number(m.quantityAfter)),
                ),
              const SizedBox(height: 72),
            ],
          );
        },
      ),
    );
  }
}

class _MovementSheet extends ConsumerStatefulWidget {
  const _MovementSheet({required this.item});

  final InventoryItem item;

  @override
  ConsumerState<_MovementSheet> createState() => _MovementSheetState();
}

class _MovementSheetState extends ConsumerState<_MovementSheet> {
  final _formKey = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  final _reason = TextEditingController();
  MovementType _type = MovementType.issue;
  bool _busy = false;

  @override
  void dispose() {
    _quantity.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(inventoryActionsProvider).move(
        widget.item,
        _type,
        _parseNumber(_quantity.text)!,
        reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.movementSaved);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Padding(
      padding: EdgeInsets.fromLTRB(Insets.xl, 0, Insets.xl, MediaQuery.viewInsetsOf(context).bottom + Insets.xl),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.item.name, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: Insets.lg),
            Wrap(
              spacing: Insets.sm,
              children: [
                for (final t in MovementType.values)
                  ChoiceChip(
                    label: Text(l10n.movementType(t)),
                    selected: _type == t,
                    onSelected: (_) => setState(() => _type = t),
                  ),
              ],
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _quantity,
              autofocus: true,
              textDirection: TextDirection.ltr,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l10n.quantityLabel(widget.item.unit)),
              validator: (v) {
                final n = _parseNumber(v ?? '');
                if (n == null || n < 0) return l10n.invalidNumber;
                if (_type != MovementType.adjust && n == 0) return l10n.invalidNumber;
                return null;
              },
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _reason,
              decoration: InputDecoration(labelText: '${l10n.reasonLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(onPressed: _busy ? null : _save, child: Text(l10n.save)),
          ],
        ),
      ),
    );
  }
}

class NewInventoryItemPage extends ConsumerStatefulWidget {
  const NewInventoryItemPage({super.key});

  @override
  ConsumerState<NewInventoryItemPage> createState() => _NewInventoryItemPageState();
}

class _NewInventoryItemPageState extends ConsumerState<NewInventoryItemPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _sku = TextEditingController();
  final _unit = TextEditingController();
  final _reorder = TextEditingController();
  final _initial = TextEditingController();
  final _cost = TextEditingController();
  final _location = TextEditingController();
  InventoryCategory _category = InventoryCategory.guestAmenities;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _sku, _unit, _reorder, _initial, _cost, _location]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      final reorder = _parseNumber(_reorder.text)!;
      final id = await ref.read(inventoryActionsProvider).create(
        InventoryItemDraft(
          name: _name.text.trim(),
          sku: _sku.text.trim(),
          category: _category,
          unit: _unit.text.trim(),
          reorderLevel: reorder,
          reorderQuantity: reorder * 3,
          initialQuantity: _parseNumber(_initial.text) ?? 0,
          unitCost: _parseNumber(_cost.text),
          location: _location.text.trim().isEmpty ? null : _location.text.trim(),
        ),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.itemCreated);
      context.pushReplacement(Routes.item(id));
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    String? required(String? v) => (v ?? '').trim().isEmpty ? l10n.requiredField : null;
    String? number(String? v) => _parseNumber(v ?? '') == null ? l10n.invalidNumber : null;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.newItem)),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 560,
          children: [
            TextFormField(controller: _name, decoration: InputDecoration(labelText: l10n.itemName), validator: required),
            const SizedBox(height: Insets.md),
            TextFormField(controller: _sku, decoration: InputDecoration(labelText: l10n.skuLabel), validator: required),
            const SizedBox(height: Insets.md),
            DropdownButtonFormField<InventoryCategory>(
              initialValue: _category,
              decoration: InputDecoration(labelText: l10n.ticketCategoryLabel),
              items: [
                for (final c in InventoryCategory.values)
                  DropdownMenuItem(value: c, child: Text(l10n.inventoryCategory(c))),
              ],
              onChanged: (c) => setState(() => _category = c ?? _category),
            ),
            const SizedBox(height: Insets.md),
            TextFormField(controller: _unit, decoration: InputDecoration(labelText: l10n.unitLabel), validator: required),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _reorder,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: l10n.reorderLevel),
              validator: number,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _initial,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: l10n.initialQuantity),
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _cost,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: '${l10n.unitCost} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _location,
              decoration: InputDecoration(labelText: '${l10n.locationLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(onPressed: _busy ? null : _save, child: Text(l10n.save)),
          ],
        ),
      ),
    );
  }
}
