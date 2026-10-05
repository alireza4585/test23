import '../../../core/domain/actor.dart';

enum InventoryCategory {
  guestAmenities,
  linen,
  cleaningSupplies,
  foodAndBeverage,
  maintenanceParts,
  office,
  other,
}

class InventoryItem {
  const InventoryItem({
    required this.id,
    required this.name,
    required this.sku,
    required this.category,
    required this.unit,
    required this.quantity,
    required this.reorderLevel,
    this.reorderQuantity = 0,
    this.location,
    this.unitCost,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String sku;
  final InventoryCategory category;
  final String unit;
  final double quantity;

  /// Reorder point: at or below this quantity a low-stock alert is raised.
  final double reorderLevel;
  final double reorderQuantity;
  final String? location;
  final double? unitCost;
  final DateTime? updatedAt;

  bool get isLowStock => quantity <= reorderLevel;
  bool get isOutOfStock => quantity <= 0;
  double? get stockValue => unitCost == null ? null : unitCost! * quantity;
}

enum MovementType {
  receive,
  issue,
  adjust,
  waste;

  /// Sign applied to the entered (positive) quantity.
  int get sign => switch (this) {
    MovementType.receive => 1,
    MovementType.issue => -1,
    MovementType.waste => -1,
    MovementType.adjust => 1,
  };
}

class StockMovement {
  const StockMovement({
    required this.id,
    required this.itemId,
    required this.itemName,
    required this.type,
    required this.delta,
    required this.quantityAfter,
    required this.actorName,
    required this.createdAt,
    this.reason,
  });

  final String id;
  final String itemId;
  final String itemName;
  final MovementType type;

  /// Signed change applied to the item quantity.
  final double delta;
  final double quantityAfter;
  final String actorName;
  final DateTime createdAt;
  final String? reason;
}

class InventoryItemDraft {
  const InventoryItemDraft({
    required this.name,
    required this.sku,
    required this.category,
    required this.unit,
    required this.reorderLevel,
    this.reorderQuantity = 0,
    this.initialQuantity = 0,
    this.location,
    this.unitCost,
  });

  final String name;
  final String sku;
  final InventoryCategory category;
  final String unit;
  final double reorderLevel;
  final double reorderQuantity;
  final double initialQuantity;
  final String? location;
  final double? unitCost;
}

abstract interface class InventoryRepository {
  Stream<List<InventoryItem>> watchItems(String hotelId);

  Stream<InventoryItem?> watchItem(String hotelId, String itemId);

  Stream<List<StockMovement>> watchMovements(
    String hotelId, {
    String? itemId,
    int limit = 30,
  });

  /// Atomically applies [delta] to the item and records the movement.
  /// Throws `ValidationFailure('insufficient_stock')` if the result would be
  /// negative.
  Future<void> recordMovement(
    String hotelId, {
    required String itemId,
    required MovementType type,
    required double delta,
    required Actor actor,
    String? reason,
  });

  Future<String> createItem(
    String hotelId,
    InventoryItemDraft draft,
    Actor actor,
  );
}
