import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../application/ai_providers.dart';
import '../domain/ai_models.dart';
import 'insight_card.dart';

/// Recommendation center: open recommendations to decide, decided ones with
/// their linked work and measured result, and closed ones. Expected savings
/// and measured savings are shown separately; only evaluations that pass the
/// statistical check count as measured.
class InsightsPage extends ConsumerWidget {
  const InsightsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(hotelSettingsProvider).has(HotelFeature.recommendationLoop)) return const _ClassicInsightsPage();
    final l10n = context.l10n;
    final fmt = context.fmt;
    final ledger = ref.watch(recommendationLedgerProvider);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.recommendationCenterTitle),
          actions: const [ShellActions()],
          bottom: TabBar(
            tabs: [
              Tab(key: const Key('recs.tab.open'), text: l10n.tabOpen),
              Tab(key: const Key('recs.tab.decided'), text: l10n.tabDecided),
              Tab(key: const Key('recs.tab.closed'), text: l10n.tabClosed),
            ],
          ),
        ),
        body: AsyncValueView<List<AiInsight>>(
          value: ledger,
          data: (all) {
            final open = [for (final i in all) if (i.isOpen) i];
            final decided = [for (final i in all) if (i.isDecided) i];
            final closed = [for (final i in all) if (i.isClosed) i];
            final expected = open.fold<double>(0, (s, i) => s + (i.estimatedMonthlySaving ?? 0));
            final measured = decided.fold<double>(0, (s, i) {
              final e = i.evaluation;
              return e != null && e.status == EvaluationStatus.evaluated && e.improved == true ? s + (e.monthlySaving ?? 0) : s;
            });
            Widget list(List<AiInsight> items, {required bool header}) => PageBody(
              maxWidth: 820,
              children: [
                if (header) ...[
                  Text(l10n.recommendationCenterSubtitle, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: Insets.md),
                  ZCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.expectedSavingOpen('${fmt.money(expected)} ${l10n.currencyRial}'),
                          key: const Key('recs.expected'),
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: Insets.xs),
                        Text(
                          l10n.measuredSaving('${fmt.money(measured)} ${l10n.currencyRial}'),
                          key: const Key('recs.measured'),
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: Insets.xs),
                        Text(l10n.measuredSavingNote, style: Theme.of(context).textTheme.labelSmall),
                      ],
                    ),
                  ),
                  const SizedBox(height: Insets.md),
                ],
                if (items.isEmpty)
                  EmptyState(icon: Icons.auto_awesome_outlined, message: header ? l10n.noInsights : l10n.nothingHereYet),
                for (final i in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Insets.md),
                    child: InsightCard(insight: i, expanded: true),
                  ),
              ],
            );
            return TabBarView(
              children: [list(open, header: true), list(decided, header: false), list(closed, header: false)],
            );
          },
        ),
      ),
    );
  }
}

/// The insights list as it was before the Recommendation Center (the hotel's
/// recommendationLoop flag is off): open insights with accept / implemented / dismiss.
class _ClassicInsightsPage extends ConsumerWidget {
  const _ClassicInsightsPage();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final insights = ref.watch(insightsProvider);
    return Scaffold(
      key: const Key('insights.classic'),
      appBar: AppBar(title: Text(l10n.insightsTitle), actions: const [ShellActions()]),
      body: AsyncValueView<List<AiInsight>>(
        value: insights,
        data: (list) => PageBody(
          maxWidth: 820,
          children: [
            Text(l10n.insightsSubtitle, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: Insets.md),
            if (list.isEmpty) EmptyState(icon: Icons.auto_awesome_outlined, message: l10n.noInsights),
            for (final i in list)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.md),
                child: InsightCard(insight: i, expanded: true),
              ),
          ],
        ),
      ),
    );
  }
}

/// Chat with the analytics assistant. Suggested questions make the value
/// obvious in a demo; answers always list the figures they are based on.
class AssistantPage extends ConsumerStatefulWidget {
  const AssistantPage({super.key});

  @override
  ConsumerState<AssistantPage> createState() => _AssistantPageState();
}

class _AssistantPageState extends ConsumerState<AssistantPage> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final question = text ?? _input.text;
    if (question.trim().isEmpty) return;
    _input.clear();
    final locale = Localizations.localeOf(context).languageCode;
    await ref.read(assistantControllerProvider.notifier).ask(question, localeCode: locale);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    if (_scroll.hasClients) {
      await _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final chat = ref.watch(assistantControllerProvider);
    final suggestions = [
      l10n.assistantSuggestion1,
      l10n.assistantSuggestion2,
      l10n.assistantSuggestion3,
      l10n.assistantSuggestion4,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Icon(Icons.auto_awesome, color: AppColors.gold, size: 20),
            const SizedBox(width: Insets.sm),
            Text(l10n.assistantTitle),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Align(
                alignment: AlignmentDirectional.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 820),
                  child: ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.all(Insets.page),
                    children: [
                      _Bubble(
                        message: ChatMessage(role: ChatRole.assistant, text: l10n.assistantWelcome, at: DateTime(0)),
                      ),
                      if (chat.messages.isEmpty) ...[
                        const SizedBox(height: Insets.md),
                        Wrap(
                          spacing: Insets.sm,
                          runSpacing: Insets.sm,
                          children: [
                            for (final s in suggestions)
                              ActionChip(
                                avatar: const Icon(Icons.bolt_outlined, size: 16),
                                label: Text(s),
                                onPressed: () => _send(s),
                              ),
                          ],
                        ),
                      ],
                      for (final m in chat.messages) _Bubble(message: m),
                      if (chat.sending)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: Insets.md),
                          child: Row(
                            children: [
                              const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                              const SizedBox(width: Insets.sm),
                              Text(l10n.thinking, style: theme.textTheme.bodySmall),
                            ],
                          ),
                        ),
                      const SizedBox(height: Insets.md),
                      Text(
                        l10n.assistantDisclaimer,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(Insets.page, Insets.sm, Insets.page, Insets.sm),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 820),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('assistant.input'),
                        controller: _input,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _send(),
                        decoration: InputDecoration(hintText: l10n.assistantHint),
                      ),
                    ),
                    const SizedBox(width: Insets.sm),
                    IconButton.filled(
                      key: const Key('assistant.send'),
                      tooltip: l10n.send,
                      onPressed: chat.sending ? null : () => _send(),
                      icon: const Icon(Icons.arrow_upward),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final mine = message.role == ChatRole.user;
    final text = message.isError ? context.l10n.assistantError : message.text;
    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 620),
        margin: const EdgeInsets.symmetric(vertical: Insets.xs),
        padding: const EdgeInsets.symmetric(horizontal: Insets.lg, vertical: Insets.md),
        decoration: BoxDecoration(
          color: mine ? scheme.primaryContainer : scheme.surfaceContainer,
          borderRadius: BorderRadius.circular(Radii.md),
          border: Border.all(
            color: message.isError ? context.status.danger : scheme.outlineVariant,
          ),
        ),
        child: SelectableText(
          text,
          style: theme.textTheme.bodyMedium?.copyWith(
            height: 1.7,
            color: mine ? scheme.onPrimaryContainer : scheme.onSurface,
          ),
        ),
      ),
    );
  }
}
