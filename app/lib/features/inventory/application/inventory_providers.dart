import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/inventory_item.dart';

final inventoryItemsProvider = StreamProvider<List<InventoryItem>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.inventoryView)) {
    return Stream.value(const []);
  }
  return ref.watch(inventoryRepositoryProvider).watchItems(user.hotelId);
});

final lowStockItemsProvider = Provider<List<InventoryItem>>(
  (ref) => (ref.watch(inventoryItemsProvider).value ?? const [])
      .where((i) => i.isLowStock)
      .toList(),
);

final inventoryItemProvider =
    StreamProvider.autoDispose.family<InventoryItem?, String>((ref, id) {
      final hotelId = ref.watch(activeHotelIdProvider);
      if (hotelId == null) return Stream.value(null);
      return ref.watch(inventoryRepositoryProvider).watchItem(hotelId, id);
    });

final itemMovementsProvider =
    StreamProvider.autoDispose.family<List<StockMovement>, String>((ref, id) {
      final hotelId = ref.watch(activeHotelIdProvider);
      if (hotelId == null) return Stream.value(const []);
      return ref
          .watch(inventoryRepositoryProvider)
          .watchMovements(hotelId, itemId: id);
    });

class InventoryActions {
  InventoryActions(this.ref);

  final Ref ref;

  Future<void> move(
    InventoryItem item,
    MovementType type,
    double quantity, {
    String? reason,
  }) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.inventoryMove)) {
      throw const PermissionDeniedFailure();
    }
    if (quantity <= 0 && type != MovementType.adjust) {
      throw const ValidationFailure('invalid_quantity');
    }
    final delta = type == MovementType.adjust
        ? quantity - item.quantity // adjust = set counted quantity
        : quantity * type.sign;
    await ref.read(inventoryRepositoryProvider).recordMovement(
      user.hotelId,
      itemId: item.id,
      type: type,
      delta: delta,
      actor: user.asActor,
      reason: reason,
    );
  }

  Future<String> create(InventoryItemDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.inventoryManage)) {
      throw const PermissionDeniedFailure();
    }
    return ref
        .read(inventoryRepositoryProvider)
        .createItem(user.hotelId, draft, user.asActor);
  }
}

final inventoryActionsProvider = Provider<InventoryActions>(
  InventoryActions.new,
);
