import 'package:pocketbase/pocketbase.dart';

import '../../core/utils/day_key.dart';
import '../../features/actions/domain/ai_action.dart';
import '../../features/briefing/domain/briefing.dart';
import '../../features/energy/domain/energy_model.dart';
import '../../features/energy/domain/energy_reading.dart';
import 'pb_support.dart';

double? _num(Object? v) => v is num ? v.toDouble() : null;

DateTime? _date(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v.replaceFirst(' ', 'T')) : null;

// ------------------------------------------------------------------ actions

/// `aiActions` (server-written; the API rules hide revenue actions from roles
/// without finance.view) and the Action Center routes.
class PocketBaseActionsRepository implements ActionsRepository {
  PocketBaseActionsRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<List<AiAction>> watchActions(String hotelId) => _live
      .list('aiActions', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), sort: '-created', limit: 200)
      .map((records) => [for (final r in records) actionFromRecord(r)]);

  @override
  Future<void> decide(String actionId, {required bool approve, String note = '', Map<String, dynamic>? params}) => pbGuard(
    () => _pb.send(
      '/api/zarin/actions/$actionId/decide',
      method: 'POST',
      body: {'decision': approve ? 'approve' : 'reject', 'note': note, 'params': ?params},
    ),
  );

  @override
  Future<void> proposeBaselineAdjustment(String hotelId, {required String meterType, required List<String> days, required String reason}) =>
      pbGuard(
        () => _pb.send(
          '/api/zarin/actions',
          method: 'POST',
          body: {
            'hotelId': hotelId,
            'type': 'adjustBaseline',
            'reason': reason,
            'params': {'meterType': meterType, 'days': days},
          },
        ),
      );
}

AiAction actionFromRecord(RecordModel r) {
  final o = r.obj('outcome');
  final ci = o['ci95'];
  return AiAction(
    id: r.id,
    type: r.enumValue('type', ActionType.values, ActionType.notifyRole),
    status: r.enumValue('status', ActionStatus.values, ActionStatus.proposed),
    department: r.enumValue('department', ActionDepartment.values, ActionDepartment.operations),
    title: r.str('title'),
    createdAt: r.dateOrNow('created'),
    insightId: r.strOrNull('insight'),
    category: r.str('category', 'energy'),
    priority: r.str('priority', 'medium'),
    reason: r.str('reason'),
    params: r.obj('params'),
    decidedByName: r.strOrNull('decidedByName'),
    decidedAt: r.date('decidedAt'),
    decisionNote: r.strOrNull('decisionNote'),
    error: r.strOrNull('error'),
    outcome: o.isEmpty
        ? null
        : ActionOutcome(
            status: o['status'] as String? ?? 'pending',
            method: o['method'] as String?,
            value: _num(o['value']),
            unit: o['unit'] as String?,
            ciLow: ci is List && ci.length == 2 ? _num(ci[0]) : null,
            ciHigh: ci is List && ci.length == 2 ? _num(ci[1]) : null,
            improved: o['improved'] as bool?,
            measuredAt: _date(o['measuredAt']),
            dueAt: _date(o['dueAt']),
          ),
  );
}

// ----------------------------------------------------------------- briefing

/// `briefings`: the API rules return only the signed-in user's role.
class PocketBaseBriefingRepository implements BriefingRepository {
  PocketBaseBriefingRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<Briefing?> watchToday(String hotelId, String day) => _live
      .list('briefings', filter: _pb.filter('hotel = {:h} && day = {:d}', {'h': hotelId, 'd': day}), limit: 5)
      .map((records) {
        if (records.isEmpty) return null;
        final r = records.first;
        final me = _pb.authStore.record?.id;
        final rating = me == null ? null : r.obj('ratings')[me];
        final items = r.data['items'];
        return Briefing(
          id: r.id,
          day: r.str('day'),
          role: r.str('role'),
          text: r.str('text'),
          source: r.str('source', 'rules'),
          myRating: rating is Map ? rating['useful'] as bool? : null,
          items: [
            if (items is List)
              for (final i in items)
                if (i is Map)
                  BriefingItem(
                    title: i['title'] as String? ?? '',
                    finding: i['finding'] as String? ?? '',
                    cause: i['cause'] as String?,
                    actionId: i['actionId'] as String?,
                    route: i['route'] as String?,
                    category: i['category'] as String? ?? '',
                  ),
          ],
        );
      });

  @override
  Future<void> rate(String briefingId, {required bool useful}) =>
      pbGuard(() => _pb.send('/api/zarin/briefings/$briefingId/rate', method: 'POST', body: {'useful': useful}));
}

// ------------------------------------------------------------- energy model

/// `energyModels`, `energyExpected` and `energyExclusions` (energy.view).
class PocketBaseEnergyModelRepository implements EnergyModelRepository {
  PocketBaseEnergyModelRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<EnergyModelView> watchModel(String hotelId, EnergyType type) => _live
      .list(
        'energyModels',
        filter: _pb.filter("hotel = {:h} && type = {:t} && (status = 'active' || status = 'rejected')", {'h': hotelId, 't': type.name}),
        sort: '-fittedAt',
        limit: 2,
      )
      .asyncMap((models) async {
        final active = models.where((m) => m.str('status') == 'active').firstOrNull;
        final rejected = models.where((m) => m.str('status') == 'rejected').firstOrNull;
        final from = DayKey.of(DayKey.hotelToday(DateTime.now()).subtract(const Duration(days: 35)));
        final p = {'h': hotelId, 't': type.name, 'f': from};
        final expected = await pbGuard(
          () => _pb.collection('energyExpected').getFullList(filter: _pb.filter('hotel = {:h} && type = {:t} && day >= {:f}', p), sort: 'day'),
        );
        final excluded = await pbGuard(
          () => _pb.collection('energyExclusions').getFullList(filter: _pb.filter('hotel = {:h} && type = {:t}', p), sort: '-day'),
        );
        final m = active ?? rejected;
        final stats = m?.obj('stats')['model'];
        return EnergyModelView(
          model: m == null
              ? null
              : EnergyModelInfo(
                  kind: m.str('kind'),
                  valid: m.boolean('valid'),
                  reason: m.strOrNull('reason'),
                  rejected: m.str('status') == 'rejected',
                  cvrmseMonthly: stats is Map ? _num(stats['cvrmseMonthly']) : null,
                  months: stats is Map ? (stats['months'] as num?)?.toInt() : null,
                  weatherSource: m.strOrNull('weatherSource'),
                  trainFrom: m.strOrNull('trainFrom'),
                  trainTo: m.strOrNull('trainTo'),
                ),
          days: [
            for (final r in expected)
              ExpectedDay(
                day: DayKey.parse(r.str('day')),
                expected: r.dbl('expected'),
                lower: r.dbl('lower'),
                upper: r.dbl('upper'),
                actual: r.boolean('hasActual') ? r.dbl('actual') : null,
                spike: r.obj('flags')['spike'] == true,
                drift: r.obj('flags')['drift'] == true,
                excluded: r.obj('flags')['excluded'] == true,
                usedWeather: r.boolean('hasWeather'),
              ),
          ],
          exclusions: [
            for (final x in excluded)
              EnergyExclusion(day: DayKey.parse(x.str('day')), reason: x.str('reason'), createdByName: x.strOrNull('createdByName')),
          ],
        );
      });
}
