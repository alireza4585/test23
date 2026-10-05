import '../../../core/domain/actor.dart';

enum InsightCategory { energy, maintenance, housekeeping, inventory, revenue, staffing }

enum InsightStatus { active, accepted, dismissed, implemented }

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
  });

  final String id;
  final InsightCategory category;
  final String title;
  final String summary;
  final String recommendation;

  /// 0..1
  final double confidence;
  final InsightStatus status;

  /// `ruleEngine` | `llm`
  final String source;
  final DateTime createdAt;
  final List<String> evidence;

  /// In hotel currency.
  final double? estimatedMonthlySaving;
  final String? route;
}

abstract interface class InsightsRepository {
  Stream<List<AiInsight>> watchInsights(String hotelId, {bool activeOnly = true});

  Future<void> updateStatus(
    String hotelId,
    String insightId,
    InsightStatus status,
    Actor actor,
  );
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
  const AssistantReply({required this.text, this.dataPoints = const []});

  final String text;

  /// Figures the answer relied on (shown under the answer for transparency).
  final List<String> dataPoints;
}

/// Natural-language assistant. The Firebase implementation calls the
/// `aiAssistant` Cloud Function (the LLM API key never reaches the device);
/// the demo implementation answers from local analytics.
abstract interface class AiAssistantRepository {
  Future<AssistantReply> ask({
    required String hotelId,
    required String question,
    required List<ChatMessage> history,
    required String localeCode,
  });
}
