import 'package:pocketbase/pocketbase.dart';

import '../../features/inventory/domain/purchase_order.dart';
import 'pb_support.dart';

double? _num(Object? v) => v is num ? v.toDouble() : null;

DateTime? _date(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v.replaceFirst(' ', 'T')) : null;

// ---------------------------------------------------------- purchase orders

/// `purchaseOrders` (server-written; readable with inventory.view in the
/// active hotel) and the order routes. Prices are in `purchaseOrderCosts`,
/// which the server shows only with finance.view (like revenue): for anyone
/// else the list is empty and orders carry no amounts. The first approval is
/// the `createPurchaseOrder` action's decide route.
class PocketBasePurchaseOrdersRepository implements PurchaseOrdersRepository {
  PocketBasePurchaseOrdersRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<List<PurchaseOrder>> watchOrders(String hotelId) => _live
      .list('purchaseOrders', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), sort: '-created', limit: 100)
      .asyncMap((records) async {
        // Prices change only with the order (edit, refresh), so re-read them on each order update.
        final costs = <String, RecordModel>{};
        if (records.isNotEmpty) {
          try {
            final list = await _pb.collection('purchaseOrderCosts').getList(
              perPage: 100,
              filter: _pb.filter('hotel = {:h}', {'h': hotelId}),
              skipTotal: true,
            );
            for (final c in list.items) {
              costs[c.str('purchaseOrder')] = c;
            }
          } on ClientException {
            // No prices for this user (or none yet): orders without amounts.
          }
        }
        return [for (final r in records) purchaseOrderFromRecord(r, costs: costs[r.id])];
      });

  Map<String, dynamic> _lines(Map<String, double> quantities) => {
    'lines': [
      for (final e in quantities.entries) {'itemId': e.key, 'quantity': e.value},
    ],
  };

  @override
  Future<void> editLines(String orderId, Map<String, double> quantities) =>
      pbGuard(() => _pb.send('/api/zarin/purchase-orders/$orderId/lines', method: 'POST', body: _lines(quantities)));

  @override
  Future<void> secondApproval(String orderId, {required bool approve, String note = ''}) => pbGuard(
    () => _pb.send(
      '/api/zarin/purchase-orders/$orderId/approve',
      method: 'POST',
      body: {'decision': approve ? 'approve' : 'reject', 'note': note},
    ),
  );

  @override
  Future<void> receive(String orderId, Map<String, double> received) =>
      pbGuard(() => _pb.send('/api/zarin/purchase-orders/$orderId/receive', method: 'POST', body: _lines(received)));

  @override
  Future<void> cancel(String orderId, String note) =>
      pbGuard(() => _pb.send('/api/zarin/purchase-orders/$orderId/cancel', method: 'POST', body: {'note': note}));
}

/// [costs]: the order's `purchaseOrderCosts` record, when the user may see prices.
PurchaseOrder purchaseOrderFromRecord(RecordModel r, {RecordModel? costs}) {
  List<Map<String, dynamic>> maps(String key, [RecordModel? from]) => [
    for (final m in ((from ?? r).data[key] as List? ?? const []).whereType<Map<String, dynamic>>()) m,
  ];
  final prices = {for (final c in maps('lines', costs)) if (costs != null && c['itemId'] is String) c['itemId'] as String: c};
  return PurchaseOrder(
    id: r.id,
    supplierName: r.str('supplierName'),
    status: r.enumValue('status', PurchaseOrderStatus.values, PurchaseOrderStatus.draft),
    createdAt: r.dateOrNow('created'),
    actionId: r.strOrNull('action'),
    total: costs?.dblOrNull('total'),
    leadTimeDays: r.dblOrNull('leadTimeDays'),
    orderedAt: r.date('orderedAt'),
    expectedAt: r.date('expectedAt'),
    sentAt: r.date('sentAt'),
    receivedAt: r.date('receivedAt'),
    needsSecondApproval: r.boolean('needsSecondApproval'),
    note: r.strOrNull('note'),
    editedByName: r.strOrNull('editedByName'),
    lines: [
      for (final l in maps('lines'))
        if (l['itemId'] is String)
          PurchaseOrderLine(
            itemId: l['itemId'] as String,
            name: l['name'] as String? ?? '',
            unit: l['unit'] as String? ?? '',
            quantity: _num(l['quantity']) ?? 0,
            suggested: _num(l['suggested']),
            kind: l['kind'] as String? ?? 'reorder',
            orderBy: l['orderBy'] as String?,
            unitCost: _num(prices[l['itemId']]?['unitCost']),
            cost: _num(prices[l['itemId']]?['cost']),
            received: _num(l['received']),
            isNew: l['isNew'] == true,
          ),
    ],
    approvals: [
      for (final a in maps('approvals'))
        PurchaseOrderApproval(
          step: (_num(a['step']) ?? 1).round(),
          byName: a['byName'] as String? ?? '',
          decision: a['decision'] as String? ?? 'approve',
          at: _date(a['at']),
          note: a['note'] as String?,
        ),
    ],
  );
}
