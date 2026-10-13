import 'dart:async';

import '../../core/error/app_failure.dart';
import '../../core/security/app_permission.dart';
import '../../core/security/role_policy.dart';
import '../../core/utils/day_key.dart';
import '../../features/actions/domain/ai_action.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/briefing/domain/briefing.dart';
import '../../features/energy/domain/energy_baseline.dart';
import '../../features/energy/domain/energy_model.dart';
import '../../features/energy/domain/energy_reading.dart';
import 'demo_store.dart';

/// Offline demo of the AI phase 1 features. It mirrors the server's rules
/// closely enough to show the flows (department scoping, the baseline cap),
/// but the server is the authority: approving here records the decision only,
/// it does not open tickets or tasks.
class DemoActionsRepository implements ActionsRepository {
  DemoActionsRepository(this._store);

  final DemoStore _store;

  static ActionDepartment _department(InsightCategory c) => switch (c) {
    InsightCategory.energy => ActionDepartment.energy,
    InsightCategory.maintenance => ActionDepartment.maintenance,
    InsightCategory.housekeeping => ActionDepartment.housekeeping,
    InsightCategory.inventory => ActionDepartment.inventory,
    InsightCategory.revenue || InsightCategory.staffing => ActionDepartment.operations,
  };

  /// One proposed action per open insight (as the nightly server run does).
  void _propose() {
    for (final i in _store.insights.all.where((i) => i.isOpen)) {
      final id = 'act-${i.id}';
      if (_store.actions.get(id) != null) continue;
      final ticket = i.category == InsightCategory.energy || i.category == InsightCategory.maintenance;
      _store.actions.put(
        AiAction(
          id: id,
          insightId: i.id,
          type: ticket ? ActionType.createTicket : ActionType.notifyRole,
          status: ActionStatus.proposed,
          department: _department(i.category),
          category: i.category.name,
          priority: i.priority.name,
          title: i.title,
          reason: i.recommendation,
          createdAt: _store.clock.now(),
        ),
      );
    }
  }

  DemoAccount get _me {
    final uid = _store.signedInUid;
    final me = uid == null ? null : _store.accountByUid(uid);
    if (me == null) throw const SessionExpiredFailure();
    return me;
  }

  bool _canSee(AiAction a) => a.category != 'revenue' || RolePolicy.resolve(_me.role).contains(AppPermission.financeView);

  @override
  Stream<List<AiAction>> watchActions(String hotelId) {
    _propose();
    return _store.actions.watch(where: _canSee, sort: (a, b) => b.createdAt.compareTo(a.createdAt));
  }

  @override
  Future<void> decide(String actionId, {required bool approve, String note = '', Map<String, dynamic>? params}) async {
    final me = _me;
    final a = _store.actions.get(actionId);
    if (a == null || !_canSee(a)) throw const NotFoundFailure();
    final perms = RolePolicy.resolve(me.role);
    if (!perms.contains(AppPermission.aiActionsApprove)) throw const PermissionDeniedFailure('ai.actions.approve');
    if (!RolePolicy.canDecideDepartment(me.role, a.department.name)) throw const PermissionDeniedFailure('department_not_allowed');
    if (!a.isPending) throw const ValidationFailure('action_not_pending');
    if (!approve && note.trim().length < 3) throw const ValidationFailure('note_required');
    if (approve && a.type == ActionType.adjustBaseline && !RolePolicy.baselineAdjustRoles.contains(me.role)) {
      throw const PermissionDeniedFailure('baseline_adjust_not_allowed');
    }
    await _store.latency();
    if (approve && a.type == ActionType.adjustBaseline) {
      for (final d in (a.params['days'] as List).cast<String>()) {
        _store.energyExclusions.put(
          (type: a.params['meterType'] as String, exclusion: EnergyExclusion(day: DayKey.parse(d), reason: a.reason, createdByName: me.fullName)),
        );
      }
    }
    _store.actions.put(
      AiAction(
        id: a.id,
        insightId: a.insightId,
        type: a.type,
        status: approve ? ActionStatus.executed : ActionStatus.rejected,
        department: a.department,
        category: a.category,
        priority: a.priority,
        title: a.title,
        reason: a.reason,
        params: {...a.params, ...?params},
        createdAt: a.createdAt,
        decidedByName: me.fullName,
        decidedAt: _store.clock.now(),
        decisionNote: note,
        outcome: approve ? const ActionOutcome(status: 'notMeasurable') : null,
      ),
    );
    _store.audit(me.fullName, approve ? 'actions.approve' : 'actions.reject', actionId);
  }

  @override
  Future<void> proposeBaselineAdjustment(String hotelId, {required String meterType, required List<String> days, required String reason}) async {
    final me = _me;
    if (!RolePolicy.baselineAdjustRoles.contains(me.role)) throw const PermissionDeniedFailure('baseline_adjust_not_allowed');
    if (reason.trim().length < 10) throw const ValidationFailure('reason_required');
    if (days.isEmpty) throw const ValidationFailure('invalid_days');
    await _store.latency();
    final id = _store.nextId('act');
    _store.actions.put(
      AiAction(
        id: id,
        type: ActionType.adjustBaseline,
        status: ActionStatus.proposed,
        department: ActionDepartment.energy,
        title: 'کنار گذاشتن ${days.length} روز از مدل',
        reason: reason.trim(),
        params: {'meterType': meterType, 'days': days},
        createdAt: _store.clock.now(),
      ),
    );
  }
}

/// The demo briefing: today's open insights for the role (revenue only with
/// finance.view), as the server's rule-based text would list them.
class DemoBriefingRepository implements BriefingRepository {
  DemoBriefingRepository(this._store);

  final DemoStore _store;
  final Map<String, bool> _ratings = {};
  final _changes = StreamController<void>.broadcast();

  Briefing? _build(String day) {
    final uid = _store.signedInUid;
    final me = uid == null ? null : _store.accountByUid(uid);
    if (me == null) return null;
    final perms = RolePolicy.resolve(me.role);
    if (!perms.contains(AppPermission.aiInsightsView)) return null;
    final open = _store.insights.all
        .where((i) => i.isOpen && (i.category != InsightCategory.revenue || perms.contains(AppPermission.financeView)))
        .toList()
      ..sort((a, b) => b.priority.index.compareTo(a.priority.index));
    final items = [
      for (final i in open.take(7)) BriefingItem(title: i.title, finding: i.summary, category: i.category.name, route: i.route),
    ];
    final text = [
      'گزارش صبحگاهی $day',
      for (var k = 0; k < items.length; k++) '${k + 1}. ${items[k].title}: ${items[k].finding}',
    ].join('\n');
    final id = 'brief-$day-${me.role.name}';
    return Briefing(id: id, day: day, role: me.role.name, text: text, source: 'rules', items: items, myRating: _ratings[id]);
  }

  @override
  Stream<Briefing?> watchToday(String hotelId, String day) async* {
    yield _build(day);
    await for (final _ in _changes.stream) {
      yield _build(day);
    }
  }

  @override
  Future<void> rate(String briefingId, {required bool useful}) async {
    await _store.latency();
    _ratings[briefingId] = useful;
    _changes.add(null);
  }
}

/// The demo energy model: the occupancy baseline of Batch 1 over the last 35
/// days (the server fits the weather model; the demo has no weather data).
/// Data errors use the server's band (core energy-model.ts): outside 0.2–2 ×
/// expected; the demo baseline is always young, so its alarms are low-confidence.
class DemoEnergyModelRepository implements EnergyModelRepository {
  DemoEnergyModelRepository(this._store);

  final DemoStore _store;

  static const _dataErrorLow = 0.2;
  static const _dataErrorHigh = 2.0;

  @override
  Stream<EnergyModelView> watchModel(String hotelId, EnergyType type) {
    EnergyModelView compute() {
      final today = DayKey.hotelToday(_store.clock.now());
      final occupied = {for (final o in _store.operations.all) DayKey.startOfDay(o.day): o.roomsOccupied};
      final byDay = <DateTime, double>{};
      for (final r in _store.energy.all.where((r) => r.type == type)) {
        final d = DayKey.startOfDay(r.day);
        byDay[d] = (byDay[d] ?? 0) + r.consumption;
      }
      final from = today.subtract(const Duration(days: 35));
      final rows = [
        for (final e in byDay.entries)
          if (occupied[e.key] != null && e.key.isBefore(today)) EnergyDay(e.key, e.value, occupied[e.key]!),
      ];
      final exclusions = [
        for (final x in _store.energyExclusions.all)
          if (x.type == type.name) x.exclusion,
      ]..sort((a, b) => b.day.compareTo(a.day));
      final analysis = analyzeEnergyLocally(
        type: type,
        from: from,
        to: today.subtract(const Duration(days: 1)),
        history: rows.where((r) => r.day.isBefore(from)).toList(),
        period: rows.where((r) => !r.day.isBefore(from)).toList(),
        tariff: 0,
      );
      final b = analysis.baseline;
      if (b == null) {
        return EnergyModelView(
          model: EnergyModelInfo(kind: 'occupancy', valid: false, rejected: true, reason: 'insufficient_data: ${rows.length} of 28 days'),
          exclusions: exclusions,
        );
      }
      final cv = b.cvrmse / 100;
      final excludedDays = {for (final x in exclusions) DayKey.of(x.day)};
      return EnergyModelView(
        model: EnergyModelInfo(kind: 'occupancy', valid: b.valid, reason: b.valid ? null : 'cvrmse ${b.cvrmse.toStringAsFixed(1)}%', trainFrom: DayKey.of(b.from), trainTo: DayKey.of(b.to)),
        days: [
          for (final d in analysis.days)
            () {
              final error = d.actual <= _dataErrorLow * d.expected || d.actual >= _dataErrorHigh * d.expected;
              return ExpectedDay(
                day: d.day,
                expected: d.expected,
                lower: d.expected * (1 - 1.96 * cv),
                upper: d.expected * (1 + 1.96 * cv),
                actual: d.actual,
                spike: b.valid && !error && d.actual > d.expected * (1 + 1.96 * cv),
                excluded: excludedDays.contains(DayKey.of(d.day)),
                dataError: error,
                lowConfidence: true,
              );
            }(),
        ],
        exclusions: exclusions,
      );
    }

    return Stream.multi((controller) {
      controller.add(compute());
      final sub = _store.energyExclusions.watch().listen((_) => controller.add(compute()));
      controller.onCancel = sub.cancel;
    });
  }
}
