import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/ai_models.dart';

final insightsProvider = StreamProvider<List<AiInsight>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.aiInsightsView)) {
    return Stream.value(const []);
  }
  return ref.watch(insightsRepositoryProvider).watchInsights(user.hotelId);
});

/// The whole recommendation ledger (open, decided, dismissed, resolved).
final recommendationLedgerProvider = StreamProvider<List<AiInsight>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.aiInsightsView)) {
    return Stream.value(const []);
  }
  return ref.watch(insightsRepositoryProvider).watchInsights(user.hotelId, activeOnly: false);
});

class InsightActions {
  InsightActions(this.ref);

  final Ref ref;

  /// Executives and department managers decide; the server checks again.
  bool get canDecide {
    final user = ref.read(sessionUserProvider);
    return user != null &&
        user.can(AppPermission.aiInsightsView) &&
        user.canAny(const {AppPermission.dashboardExecutive, AppPermission.dashboardOperations});
  }

  bool get canCreateTicket => ref.read(sessionUserProvider)?.can(AppPermission.maintenanceReport) ?? false;

  Future<void> decide(
    AiInsight insight,
    InsightDecision decision, {
    String note = '',
    bool createTicket = false,
  }) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!canDecide) throw const PermissionDeniedFailure('insight.decide');
    if (createTicket && !canCreateTicket) throw const PermissionDeniedFailure('maintenance.report');
    await ref.read(insightsRepositoryProvider).decide(
      user.hotelId,
      insight.id,
      decision,
      note: note.trim(),
      createTicket: createTicket,
      actor: user.asActor,
    );
  }
}

final insightActionsProvider = Provider<InsightActions>(InsightActions.new);

class ChatState {
  const ChatState({this.messages = const [], this.sending = false, this.threadId});

  final List<ChatMessage> messages;
  final bool sending;

  /// Server-side thread of this conversation (PocketBase).
  final String? threadId;

  ChatState copyWith({List<ChatMessage>? messages, bool? sending, String? threadId}) => ChatState(
    messages: messages ?? this.messages,
    sending: sending ?? this.sending,
    threadId: threadId ?? this.threadId,
  );
}

/// Conversation state for the AI assistant screen. Messages are shown from
/// the device; on PocketBase the server keeps the conversation (thread) and
/// logs each Q/A for audit.
class AssistantController extends Notifier<ChatState> {
  @override
  ChatState build() {
    // Reset the conversation when the user changes.
    ref.watch(sessionUserProvider.select((u) => u?.uid));
    return const ChatState();
  }

  Future<void> ask(String question, {required String localeCode}) async {
    final text = question.trim();
    if (text.isEmpty || state.sending) return;
    final user = ref.read(sessionUserProvider);
    if (user == null) return;
    final now = ref.read(clockProvider).now();
    final history = state.messages;
    state = state.copyWith(
      sending: true,
      messages: [
        ...history,
        ChatMessage(role: ChatRole.user, text: text, at: now),
      ],
    );
    try {
      final reply = await ref.read(aiAssistantRepositoryProvider).ask(
        hotelId: user.hotelId,
        question: text,
        history: history,
        localeCode: localeCode,
        threadId: state.threadId,
      );
      final answer = reply.dataPoints.isEmpty
          ? reply.text
          : '${reply.text}\n\n— ${reply.dataPoints.join(' · ')}';
      state = state.copyWith(
        sending: false,
        threadId: reply.threadId,
        messages: [
          ...state.messages,
          ChatMessage(
            role: ChatRole.assistant,
            text: answer,
            at: ref.read(clockProvider).now(),
          ),
        ],
      );
    } catch (e) {
      state = state.copyWith(
        sending: false,
        messages: [
          ...state.messages,
          ChatMessage(
            role: ChatRole.assistant,
            text: e is AppFailure ? e.runtimeType.toString() : '',
            at: ref.read(clockProvider).now(),
            isError: true,
          ),
        ],
      );
    }
  }
}

final assistantControllerProvider =
    NotifierProvider<AssistantController, ChatState>(AssistantController.new);
