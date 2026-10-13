/// Action Center (AI phase 1, F1): typed, approvable actions attached to
/// recommendations. The server executes them after an approval; the app only
/// shows them and sends the decision.
enum ActionType { createTicket, createTask, notifyRole, adjustBaseline }

enum ActionStatus { proposed, executed, failed, rejected, expired }

/// Department whose managers may decide the action (server-enforced).
enum ActionDepartment { energy, maintenance, housekeeping, inventory, restaurant, operations }

/// Result of an executed action, measured after its window. Observational:
/// a before/after comparison, never a causal claim.
class ActionOutcome {
  const ActionOutcome({
    required this.status,
    this.method,
    this.value,
    this.unit,
    this.ciLow,
    this.ciHigh,
    this.improved,
    this.measuredAt,
    this.dueAt,
  });

  /// `pending` | `measured` | `inconclusive` | `notMeasurable`
  final String status;
  final String? method;
  final double? value;
  final String? unit;
  final double? ciLow;
  final double? ciHigh;
  final bool? improved;
  final DateTime? measuredAt;
  final DateTime? dueAt;
}

class AiAction {
  const AiAction({
    required this.id,
    required this.type,
    required this.status,
    required this.department,
    required this.title,
    required this.createdAt,
    this.insightId,
    this.category = 'energy',
    this.priority = 'medium',
    this.reason = '',
    this.params = const {},
    this.decidedByName,
    this.decidedAt,
    this.decisionNote,
    this.error,
    this.outcome,
  });

  final String id;
  final ActionType type;
  final ActionStatus status;
  final ActionDepartment department;
  final String title;
  final DateTime createdAt;
  final String? insightId;

  /// Insight category (`revenue` actions need finance.view to be seen).
  final String category;

  /// `low` | `medium` | `high`
  final String priority;
  final String reason;
  final Map<String, dynamic> params;
  final String? decidedByName;
  final DateTime? decidedAt;
  final String? decisionNote;
  final String? error;
  final ActionOutcome? outcome;

  bool get isPending => status == ActionStatus.proposed;
}

abstract interface class ActionsRepository {
  /// Newest first; what the signed-in user may see (the server filters).
  Stream<List<AiAction>> watchActions(String hotelId);

  /// Approve (the server executes) or reject (a [note] is required).
  Future<void> decide(String actionId, {required bool approve, String note = '', Map<String, dynamic>? params});

  /// Proposes keeping [days] of [meterType] out of the energy model fit
  /// (general manager / energy manager, reason required, ≤ 5 days a month).
  Future<void> proposeBaselineAdjustment(String hotelId, {required String meterType, required List<String> days, required String reason});
}
