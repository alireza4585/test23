/// Purchase orders proposed by the replenishment run (AI phase 2, F5).
///
/// A draft belongs to a `createPurchaseOrder` action: approving that action in
/// the Action Center is the first approval. Above the hotel's
/// `purchaseApprovalLimit` (or with no limit set) a general manager who is not
/// the first approver must approve it again. Receipt adds the stock.
enum PurchaseOrderStatus { draft, awaitingApproval, approved, sent, received, cancelled }

class PurchaseOrderLine {
  const PurchaseOrderLine({
    required this.itemId,
    required this.name,
    required this.unit,
    required this.quantity,
    this.suggested,
    this.kind = 'reorder',
    this.orderBy,
    this.unitCost,
    this.cost,
    this.received,
  });

  final String itemId;
  final String name;
  final String unit;
  final double quantity;

  /// What the forecast suggested (the quantity may have been edited since).
  final double? suggested;

  /// `reorder` (reorder point) | `par` (daily delivery up to the par level)
  final String kind;

  /// Day key (YYYY-MM-DD) by which the order should go out.
  final String? orderBy;

  /// Prices: null unless the user may see revenue (finance.view).
  final double? unitCost;
  final double? cost;
  final double? received;
}

class PurchaseOrderApproval {
  const PurchaseOrderApproval({required this.step, required this.byName, required this.decision, this.at, this.note});

  final int step;
  final String byName;

  /// `approve` | `reject`
  final String decision;
  final DateTime? at;
  final String? note;
}

class PurchaseOrder {
  const PurchaseOrder({
    required this.id,
    required this.supplierName,
    required this.status,
    required this.lines,
    required this.createdAt,
    this.actionId,
    this.total,
    this.leadTimeDays,
    this.orderedAt,
    this.expectedAt,
    this.sentAt,
    this.receivedAt,
    this.approvals = const [],
    this.needsSecondApproval = false,
    this.note,
    this.editedByName,
  });

  final String id;
  final String supplierName;
  final PurchaseOrderStatus status;
  final List<PurchaseOrderLine> lines;
  final DateTime createdAt;

  /// The `createPurchaseOrder` action whose approval is the first approval.
  final String? actionId;

  /// Null unless the user may see revenue (finance.view).
  final double? total;
  final double? leadTimeDays;
  final DateTime? orderedAt;
  final DateTime? expectedAt;
  final DateTime? sentAt;
  final DateTime? receivedAt;
  final List<PurchaseOrderApproval> approvals;
  final bool needsSecondApproval;
  final String? note;
  final String? editedByName;

  bool get isOpen => status == PurchaseOrderStatus.approved || status == PurchaseOrderStatus.sent;

  /// Ordered, not received, and past the expected day.
  bool isOverdue(DateTime now) => isOpen && expectedAt != null && expectedAt!.isBefore(now);
}

abstract interface class PurchaseOrdersRepository {
  /// Newest first. Read access is `inventory.view` in the active hotel.
  Stream<List<PurchaseOrder>> watchOrders(String hotelId);

  /// Draft only: new quantities by item id; 0 removes the line.
  Future<void> editLines(String orderId, Map<String, double> quantities);

  /// The general manager's second approval (a [note] is required to reject).
  Future<void> secondApproval(String orderId, {required bool approve, String note = ''});

  /// Received quantities by item id; lines not listed arrived in full.
  Future<void> receive(String orderId, Map<String, double> received);

  /// An order that has not arrived (a [note] is required).
  Future<void> cancel(String orderId, String note);
}
