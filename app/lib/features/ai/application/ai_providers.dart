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

class InsightActions {
  InsightActions(this.ref);

  final Ref ref;

  Future<void> setStatus(AiInsight insight, InsightStatus status) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    await ref
        .read(insightsRepositoryProvider)
        .updateStatus(user.hotelId, insight.id, status, user.asActor);
  }
}

final insightActionsProvider = Provider<InsightActions>(InsightActions.new);

class ChatState {
  const ChatState({this.messages = const [], this.sending = false});

  final List<ChatMessage> messages;
  final bool sending;

  ChatState copyWith({List<ChatMessage>? messages, bool? sending}) => ChatState(
    messages: messages ?? this.messages,
    sending: sending ?? this.sending,
  );
}

/// Conversation state for the AI assistant screen. History stays on the
/// device for the session; the backend logs each Q/A for audit.
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
      );
      final answer = reply.dataPoints.isEmpty
          ? reply.text
          : '${reply.text}\n\n— ${reply.dataPoints.join(' · ')}';
      state = state.copyWith(
        sending: false,
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
