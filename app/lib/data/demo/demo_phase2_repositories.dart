import '../../core/error/app_failure.dart';
import '../../core/security/app_permission.dart';
import '../../core/security/app_role.dart';
import '../../core/security/role_policy.dart';
import '../../core/utils/day_key.dart';
import '../../features/actions/domain/ai_action.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/inventory/domain/purchase_order.dart';
import 'demo_store.dart';

/// Offline demo of F5 purchase orders. It follows the server's flow (draft →
/// action approval → second approval → receipt) closely enough to show it;
/// the server is the authority. The demo hotel has no `purchaseApprovalLimit`,
/// so every approval by someone other than the general manager needs theirs.
class DemoPurchaseOrdersRepository implements PurchaseOrdersRepository {
  DemoPurchaseOrdersRepository(this._store);

  final DemoStore _store;

  DemoAccount get _me {
    final uid = _store.signedInUid;
    final me = uid == null ? null : _store.accountByUid(uid);
    if (me == null) throw const SessionExpiredFailure();
    return me;
  }

  /// One supplier draft for the low-stock items, with its action (as the
  /// nightly replenishment run proposes it).
  void _propose(String hotelId) {
    if (!(_store.hotels.get(hotelId)?.settings.has(HotelFeature.replenishment) ?? false)) return;
    if (_store.purchaseOrders.all.isNotEmpty) return;
    final low = _store.items.all.where((i) => i.isLowStock).take(4).toList();
    if (low.isEmpty) return;
    final now = _store.clock.now();
    final orderBy = DayKey.of(now);
    final lines = [
      for (final i in low)
        PurchaseOrderLine(
          itemId: i.id,
          name: i.name,
          unit: i.unit,
          quantity: i.reorderQuantity > 0 ? i.reorderQuantity : i.reorderLevel * 2,
          suggested: i.reorderQuantity > 0 ? i.reorderQuantity : i.reorderLevel * 2,
          orderBy: orderBy,
          unitCost: i.unitCost,
          cost: i.unitCost == null ? null : i.unitCost! * (i.reorderQuantity > 0 ? i.reorderQuantity : i.reorderLevel * 2),
        ),
    ];
    const actionId = 'act-replenishment-demo';
    _store.purchaseOrders.put(
      _order(id: 'po-demo-1', status: PurchaseOrderStatus.draft, lines: lines, createdAt: now, actionId: actionId, leadTimeDays: 3),
    );
    _store.actions.put(
      AiAction(
        id: actionId,
        type: ActionType.createPurchaseOrder,
        status: ActionStatus.proposed,
        department: ActionDepartment.inventory,
        category: 'inventory',
        priority: 'high',
        title: 'سفارش خرید از «تأمین‌کنندهٔ نمونه»: ${low.length} قلم',
        reason: 'موجودی این اقلام پیش از رسیدن سفارش بعدی به نقطهٔ سفارش می‌رسد.',
        params: {
          'supplierName': 'تأمین‌کنندهٔ نمونه',
          'purchaseOrderId': 'po-demo-1',
          'lines': [
            for (final l in lines) {'itemId': l.itemId, 'name': l.name, 'unit': l.unit, 'quantity': l.quantity, 'orderBy': l.orderBy},
          ],
        },
        createdAt: now,
      ),
    );
  }

  static PurchaseOrder _order({
    required String id,
    required PurchaseOrderStatus status,
    required List<PurchaseOrderLine> lines,
    required DateTime createdAt,
    String? actionId,
    double? leadTimeDays,
    PurchaseOrder? from,
    List<PurchaseOrderApproval>? approvals,
    bool? needsSecondApproval,
    DateTime? orderedAt,
    DateTime? expectedAt,
    DateTime? receivedAt,
    String? note,
    String? editedByName,
  }) {
    final total = lines.every((l) => l.cost != null) ? lines.fold<double>(0, (s, l) => s + l.cost!) : null;
    return PurchaseOrder(
      id: id,
      supplierName: from?.supplierName ?? 'تأمین‌کنندهٔ نمونه',
      status: status,
      lines: lines,
      createdAt: createdAt,
      actionId: actionId ?? from?.actionId,
      total: total,
      leadTimeDays: leadTimeDays ?? from?.leadTimeDays,
      orderedAt: orderedAt ?? from?.orderedAt,
      expectedAt: expectedAt ?? from?.expectedAt,
      sentAt: from?.sentAt,
      receivedAt: receivedAt ?? from?.receivedAt,
      approvals: approvals ?? from?.approvals ?? const [],
      needsSecondApproval: needsSecondApproval ?? from?.needsSecondApproval ?? false,
      note: note ?? from?.note,
      editedByName: editedByName ?? from?.editedByName,
    );
  }

  PurchaseOrder _get(String id) {
    final po = _store.purchaseOrders.get(id);
    if (po == null) throw const NotFoundFailure('purchase_order');
    return po;
  }

  void _require(AppPermission p) {
    if (!RolePolicy.resolve(_me.role).contains(p)) throw PermissionDeniedFailure(p.code);
  }

  @override
  Stream<List<PurchaseOrder>> watchOrders(String hotelId) {
    _require(AppPermission.inventoryView);
    _propose(hotelId);
    final prices = RolePolicy.resolve(_me.role).contains(AppPermission.financeView);
    return _store.purchaseOrders
        .watch(sort: (a, b) => b.createdAt.compareTo(a.createdAt))
        .map((orders) => prices ? orders : [for (final o in orders) _withoutPrices(o)]);
  }

  /// As the server: prices only with finance.view, like revenue.
  static PurchaseOrder _withoutPrices(PurchaseOrder o) => PurchaseOrder(
    id: o.id,
    supplierName: o.supplierName,
    status: o.status,
    createdAt: o.createdAt,
    actionId: o.actionId,
    leadTimeDays: o.leadTimeDays,
    orderedAt: o.orderedAt,
    expectedAt: o.expectedAt,
    sentAt: o.sentAt,
    receivedAt: o.receivedAt,
    approvals: o.approvals,
    needsSecondApproval: o.needsSecondApproval,
    note: o.note,
    editedByName: o.editedByName,
    lines: [
      for (final l in o.lines)
        PurchaseOrderLine(itemId: l.itemId, name: l.name, unit: l.unit, quantity: l.quantity, suggested: l.suggested, kind: l.kind, orderBy: l.orderBy, received: l.received),
    ],
  );

  @override
  Future<void> editLines(String orderId, Map<String, double> quantities) async {
    _require(AppPermission.inventoryManage);
    final po = _get(orderId);
    if (po.status != PurchaseOrderStatus.draft) throw const ValidationFailure('purchase_order_not_draft');
    for (final id in quantities.keys) {
      if (!po.lines.any((l) => l.itemId == id)) throw const ValidationFailure('unknown_line');
    }
    final next = [
      for (final l in po.lines)
        if ((quantities[l.itemId] ?? l.quantity) > 0)
          PurchaseOrderLine(
            itemId: l.itemId,
            name: l.name,
            unit: l.unit,
            quantity: quantities[l.itemId] ?? l.quantity,
            suggested: l.suggested,
            kind: l.kind,
            orderBy: l.orderBy,
            unitCost: l.unitCost,
            cost: l.unitCost == null ? null : l.unitCost! * (quantities[l.itemId] ?? l.quantity),
          ),
    ];
    if (next.isEmpty) throw const ValidationFailure('purchase_order_empty');
    await _store.latency();
    _store.purchaseOrders.put(_order(id: po.id, status: po.status, lines: next, createdAt: po.createdAt, from: po, editedByName: _me.fullName));
    _store.audit(_me.fullName, 'purchaseOrders.edit', po.id);
  }

  /// The first approval: called by the demo Action Center when the
  /// order's action is approved.
  static void approveFromAction(DemoStore store, AiAction action, DemoAccount me) {
    final po = store.purchaseOrders.get(action.params['purchaseOrderId'] as String? ?? '');
    if (po == null || po.status != PurchaseOrderStatus.draft) throw const ValidationFailure('purchase_order_not_draft');
    if (!RolePolicy.resolve(me.role).contains(AppPermission.inventoryManage)) throw const PermissionDeniedFailure('inventory.manage');
    final now = store.clock.now();
    final byGm = me.role == AppRole.generalManager || me.role == AppRole.superAdmin;
    final approvals = [...po.approvals, PurchaseOrderApproval(step: 1, byName: me.fullName, decision: 'approve', at: now)];
    store.purchaseOrders.put(
      byGm
          ? _order(id: po.id, status: PurchaseOrderStatus.approved, lines: po.lines, createdAt: po.createdAt, from: po, approvals: approvals, needsSecondApproval: false, orderedAt: now, expectedAt: now.add(Duration(days: (po.leadTimeDays ?? 3).round())))
          : _order(id: po.id, status: PurchaseOrderStatus.awaitingApproval, lines: po.lines, createdAt: po.createdAt, from: po, approvals: approvals, needsSecondApproval: true),
    );
  }

  @override
  Future<void> secondApproval(String orderId, {required bool approve, String note = ''}) async {
    final me = _me;
    if (me.role != AppRole.generalManager && me.role != AppRole.superAdmin) throw const PermissionDeniedFailure('second_approval_not_allowed');
    final po = _get(orderId);
    if (po.status != PurchaseOrderStatus.awaitingApproval) throw const ValidationFailure('purchase_order_not_awaiting');
    if (!approve && note.trim().length < 3) throw const ValidationFailure('note_required');
    if (po.approvals.any((a) => a.byName == me.fullName)) throw const PermissionDeniedFailure('same_approver');
    await _store.latency();
    final now = _store.clock.now();
    final approvals = [...po.approvals, PurchaseOrderApproval(step: 2, byName: me.fullName, decision: approve ? 'approve' : 'reject', at: now, note: note.trim())];
    _store.purchaseOrders.put(
      approve
          ? _order(id: po.id, status: PurchaseOrderStatus.approved, lines: po.lines, createdAt: po.createdAt, from: po, approvals: approvals, orderedAt: now, expectedAt: now.add(Duration(days: (po.leadTimeDays ?? 3).round())))
          : _order(id: po.id, status: PurchaseOrderStatus.cancelled, lines: po.lines, createdAt: po.createdAt, from: po, approvals: approvals, note: note.trim()),
    );
    _store.audit(me.fullName, 'purchaseOrders.approve', po.id);
  }

  @override
  Future<void> receive(String orderId, Map<String, double> received) async {
    _require(AppPermission.inventoryMove);
    final po = _get(orderId);
    if (!po.isOpen) throw const ValidationFailure('purchase_order_not_open');
    await _store.latency();
    final now = _store.clock.now();
    final done = <PurchaseOrderLine>[];
    for (final l in po.lines) {
      final q = received[l.itemId] ?? l.quantity;
      final item = _store.items.get(l.itemId);
      if (item != null && q > 0) {
        _store.items.put(
          InventoryItem(
            id: item.id,
            name: item.name,
            sku: item.sku,
            category: item.category,
            unit: item.unit,
            quantity: item.quantity + q,
            reorderLevel: item.reorderLevel,
            reorderQuantity: item.reorderQuantity,
            location: item.location,
            unitCost: item.unitCost,
            updatedAt: now,
          ),
        );
        _store.movements.put(
          StockMovement(
            id: _store.nextId('mv'),
            itemId: item.id,
            itemName: item.name,
            type: MovementType.receive,
            delta: q,
            quantityAfter: item.quantity + q,
            actorName: _me.fullName,
            createdAt: now,
            reason: 'دریافت سفارش خرید ${po.id}',
          ),
        );
      }
      done.add(
        PurchaseOrderLine(itemId: l.itemId, name: l.name, unit: l.unit, quantity: l.quantity, suggested: l.suggested, kind: l.kind, orderBy: l.orderBy, unitCost: l.unitCost, cost: l.cost, received: q),
      );
    }
    _store.purchaseOrders.put(_order(id: po.id, status: PurchaseOrderStatus.received, lines: done, createdAt: po.createdAt, from: po, receivedAt: now));
    _store.audit(_me.fullName, 'purchaseOrders.receive', po.id);
  }

  @override
  Future<void> cancel(String orderId, String note) async {
    _require(AppPermission.inventoryManage);
    final po = _get(orderId);
    if (!po.isOpen && po.status != PurchaseOrderStatus.awaitingApproval) throw const ValidationFailure('purchase_order_not_open');
    if (note.trim().length < 3) throw const ValidationFailure('note_required');
    await _store.latency();
    _store.purchaseOrders.put(_order(id: po.id, status: PurchaseOrderStatus.cancelled, lines: po.lines, createdAt: po.createdAt, from: po, note: note.trim()));
    _store.audit(_me.fullName, 'purchaseOrders.cancel', po.id);
  }
}
