import '../../../core/domain/actor.dart';

enum InsightCategory { energy, maintenance, housekeeping, inventory, revenue, staffing }

/// `resolved`: the server no longer detects the condition (closed automatically).
enum InsightStatus { active, accepted, dismissed, implemented, resolved }

enum InsightDecision { accepted, dismissed, implemented }

enum InsightPriority { low, medium, high }

/// What acting on a recommendation should change, and how it is measured.
class ExpectedImpact {
  const ExpectedImpact({
    required this.metric,
    required this.unit,
    required this.baseline,
    required this.expected,
    required this.method,
    this.monthlySaving,
  });

  /// e.g. `electricityPerOccupiedRoom`, `checkoutCleanMinutes`.
  final String metric;
  final String unit;

  /// Current level when the recommendation was made.
  final double baseline;

  /// Level the recommendation aims for.
  final double expected;

  /// Evaluation method (`energyBaseline`, `durationAvg`, `ticketCount`, …).
  final String method;
  final double? monthlySaving;
}

enum EvaluationStatus { pending, evaluated, inconclusive, insufficientData, notSupported }

/// Before/after measurement of a decided recommendation. Only `evaluated`
/// results count as realised effects; `inconclusive` means the change could
/// not be told apart from normal variation.
class InsightEvaluation {
  const InsightEvaluation({
    required this.status,
    required this.method,
    this.unit,
    this.baseline,
    this.actual,
    this.delta,
    this.improved,
    this.monthlySaving,
    this.confidence,
    this.detail,
    this.limitations = const [],
    this.dueAt,
    this.afterFrom,
    this.afterTo,
  });

  final EvaluationStatus status;
  final String method;
  final String? unit;
  final double? baseline;
  final double? actual;
  final double? delta;
  final bool? improved;
  final double? monthlySaving;

  /// `low` | `medium` | `high`
  final String? confidence;
  final String? detail;
  final List<String> limitations;
  final DateTime? dueAt;
  final String? afterFrom;
  final String? afterTo;
}

/// A recommendation produced by the analytics rule engine or an LLM.
///
/// Every insight carries its [evidence] (the numbers it is based on) and a
/// [source] so managers can judge it — the platform suggests, people decide.
class AiInsight {
  const AiInsight({
    required this.id,
    required this.category,
    required this.title,
    required this.summary,
    required this.recommendation,
    required this.confidence,
    required this.status,
    required this.source,
    required this.createdAt,
    this.evidence = const [],
    this.estimatedMonthlySaving,
    this.route,
    this.rule,
    this.priority = InsightPriority.medium,
    this.expectedImpact,
    this.evaluation,
    this.decisionNote,
    this.decidedByName,
    this.decidedAt,
    this.linkedTicketId,
    this.closedReason,
  });

  final String id;
  final InsightCategory category;
  final String title;
  final String summary;
  final String recommendation;

  /// 0..1
  final double confidence;
  final InsightStatus status;

  /// `rules` | `ruleEngine` | `llm` | `external`
  final String source;
  final DateTime createdAt;
  final List<String> evidence;

  /// In hotel currency.
  final double? estimatedMonthlySaving;
  final String? route;
  final String? rule;
  final InsightPriority priority;
  final ExpectedImpact? expectedImpact;
  final InsightEvaluation? evaluation;
  final String? decisionNote;
  final String? decidedByName;
  final DateTime? decidedAt;
  final String? linkedTicketId;

  /// Why the server closed it (`not_detected_in_latest_run`).
  final String? closedReason;

  bool get isOpen => status == InsightStatus.active;

  bool get isDecided => status == InsightStatus.accepted || status == InsightStatus.implemented;

  bool get isClosed => status == InsightStatus.dismissed || status == InsightStatus.resolved;

  AiInsight copyWith({
    InsightStatus? status,
    InsightEvaluation? evaluation,
    bool clearEvaluation = false,
    String? decisionNote,
    String? decidedByName,
    DateTime? decidedAt,
    String? linkedTicketId,
  }) => AiInsight(
    id: id,
    category: category,
    title: title,
    summary: summary,
    recommendation: recommendation,
    confidence: confidence,
    status: status ?? this.status,
    source: source,
    createdAt: createdAt,
    evidence: evidence,
    estimatedMonthlySaving: estimatedMonthlySaving,
    route: route,
    rule: rule,
    priority: priority,
    expectedImpact: expectedImpact,
    evaluation: clearEvaluation ? null : evaluation ?? this.evaluation,
    decisionNote: decisionNote ?? this.decisionNote,
    decidedByName: decidedByName ?? this.decidedByName,
    decidedAt: decidedAt ?? this.decidedAt,
    linkedTicketId: linkedTicketId ?? this.linkedTicketId,
    closedReason: closedReason,
  );
}

abstract interface class InsightsRepository {
  /// [activeOnly] = the open recommendations; otherwise the whole ledger
  /// (decided, dismissed and resolved too), newest first.
  Stream<List<AiInsight>> watchInsights(String hotelId, {bool activeOnly = true});

  /// Plain status change (accept / implemented / dismiss), used while the
  /// hotel's recommendationLoop flag is off (the classic insights list).
  Future<void> updateStatus(String hotelId, String insightId, InsightStatus status, Actor actor);

  /// Records a decision with an optional [note]. With [createTicket] the
  /// backend also opens one maintenance ticket linked to the recommendation
  /// (a repeated request reuses it).
  Future<void> decide(
    String hotelId,
    String insightId,
    InsightDecision decision, {
    String note = '',
    bool createTicket = false,
    required Actor actor,
  });
}

enum ChatRole { user, assistant }

class ChatMessage {
  const ChatMessage({
    required this.role,
    required this.text,
    required this.at,
    this.isError = false,
  });

  final ChatRole role;
  final String text;
  final DateTime at;
  final bool isError;
}

class AssistantReply {
  const AssistantReply({required this.text, this.dataPoints = const [], this.threadId});

  final String text;

  /// Figures the answer relied on (shown under the answer for transparency).
  final List<String> dataPoints;

  /// Server-side conversation thread (PocketBase); send it with the next
  /// question to continue the conversation.
  final String? threadId;
}

/// Natural-language assistant. The Firebase implementation calls the
/// `aiAssistant` Cloud Function (the LLM API key never reaches the device);
/// the demo implementation answers from local analytics.
abstract interface class AiAssistantRepository {
  /// [history] is used by backends without server-side threads (Firebase,
  /// demo); PocketBase keeps the conversation itself and uses [threadId].
  Future<AssistantReply> ask({
    required String hotelId,
    required String question,
    required List<ChatMessage> history,
    required String localeCode,
    String? threadId,
  });
}
