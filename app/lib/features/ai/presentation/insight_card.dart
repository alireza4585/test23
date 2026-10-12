import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../application/ai_providers.dart';
import '../domain/ai_models.dart';

IconData insightIcon(InsightCategory c) => switch (c) {
  InsightCategory.energy => Icons.bolt_outlined,
  InsightCategory.maintenance => Icons.handyman_outlined,
  InsightCategory.housekeeping => Icons.cleaning_services_outlined,
  InsightCategory.inventory => Icons.inventory_2_outlined,
  InsightCategory.revenue => Icons.trending_up,
  InsightCategory.staffing => Icons.groups_outlined,
};

Color insightStatusColor(BuildContext context, InsightStatus s) {
  final p = context.status;
  return switch (s) {
    InsightStatus.active => p.info,
    InsightStatus.accepted => p.warning,
    InsightStatus.implemented => p.success,
    InsightStatus.dismissed || InsightStatus.resolved => p.neutral,
  };
}

/// A recommendation with its evidence, expected impact, decision trail and
/// measured result. [expanded] shows everything plus the decision action;
/// the compact form is the dashboard preview.
class InsightCard extends ConsumerWidget {
  const InsightCard({super.key, required this.insight, this.expanded = false});

  final AiInsight insight;
  final bool expanded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final actions = ref.watch(insightActionsProvider);
    // Without the hotel's recommendationLoop flag the card keeps the classic
    // accept / implemented / dismiss buttons (no decision sheet, ticket or evaluation).
    final loop = ref.watch(hotelSettingsProvider).has(HotelFeature.recommendationLoop);
    final canDecide = loop && actions.canDecide && (insight.isOpen || insight.status == InsightStatus.accepted);
    final canSetStatus = !loop && actions.canDecide && insight.isOpen;

    Future<void> setStatus(InsightStatus status) async {
      try {
        await actions.setStatus(insight, status);
        if (context.mounted) showSuccess(context, l10n.insightUpdated);
      } catch (e) {
        if (context.mounted) showFailure(context, e);
      }
    }
    final impact = insight.expectedImpact;

    return ZCard(
      key: Key('insight.${insight.id}'),
      onTap: expanded || insight.route == null ? null : () => context.push(insight.route!),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(Radii.sm)),
                child: Icon(insightIcon(insight.category), size: 18, color: scheme.primary),
              ),
              const SizedBox(width: Insets.sm),
              Expanded(
                child: Text(
                  l10n.insightCategory(insight.category),
                  style: theme.textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
              if (expanded && !insight.isOpen) ...[
                StatusPill(label: l10n.insightStatus(insight.status), color: insightStatusColor(context, insight.status)),
                const SizedBox(width: Insets.sm),
              ],
              Text(
                l10n.confidenceLabel(fmt.percent(insight.confidence * 100)),
                style: theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: Insets.md),
          Text(insight.title, style: theme.textTheme.titleSmall),
          const SizedBox(height: Insets.xs),
          Text(
            insight.summary,
            maxLines: expanded ? null : 3,
            overflow: expanded ? null : TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant, height: 1.6),
          ),
          if (insight.estimatedMonthlySaving != null) ...[
            const SizedBox(height: Insets.sm),
            Text(
              l10n.estimatedSaving('${fmt.money(insight.estimatedMonthlySaving!)} ${l10n.currencyRial}'),
              style: theme.textTheme.labelMedium?.copyWith(color: scheme.primary, fontWeight: FontWeight.w600),
            ),
          ],
          if (expanded) ...[
            if (insight.priority == InsightPriority.high && insight.isOpen) ...[
              const SizedBox(height: Insets.sm),
              StatusPill(label: l10n.insightPriority(insight.priority), color: context.status.danger, icon: Icons.priority_high),
            ],
            const SizedBox(height: Insets.md),
            Text(l10n.recommendationLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(insight.recommendation, style: theme.textTheme.bodyMedium?.copyWith(height: 1.6)),
            if (impact != null) ...[
              const SizedBox(height: Insets.md),
              Text(l10n.expectedImpactLabel, style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(
                l10n.impactFromTo(fmt.number(impact.baseline, decimals: 1), fmt.number(impact.expected, decimals: 1), l10n.impactUnit(impact.unit)),
                style: theme.textTheme.bodyMedium,
              ),
            ],
            if (insight.evidence.isNotEmpty) ...[
              const SizedBox(height: Insets.md),
              Text(l10n.evidenceLabel, style: theme.textTheme.labelLarge),
              for (final e in insight.evidence)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.fiber_manual_record, size: 8, color: scheme.onSurfaceVariant),
                      const SizedBox(width: Insets.sm),
                      Expanded(child: Text(e, style: theme.textTheme.bodySmall)),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: Insets.sm),
            Text(
              insight.source == 'llm' ? l10n.sourceLlm : l10n.sourceRuleEngine,
              style: theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (insight.status == InsightStatus.resolved && insight.closedReason != null) ...[
              const SizedBox(height: Insets.md),
              Text(l10n.closedNotDetected, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            ],
            if (!insight.isOpen && insight.decidedByName != null && insight.decidedAt != null) ...[
              const SizedBox(height: Insets.md),
              Text(
                l10n.decidedByLine(l10n.insightStatus(insight.status), insight.decidedByName!, fmt.dateTime(insight.decidedAt!)),
                style: theme.textTheme.labelMedium,
              ),
              if ((insight.decisionNote ?? '').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('«${insight.decisionNote!}»', style: theme.textTheme.bodySmall),
                ),
            ],
            if (insight.linkedTicketId != null) ...[
              const SizedBox(height: Insets.sm),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  key: Key('insight.${insight.id}.ticket'),
                  onPressed: () => context.push(Routes.ticket(insight.linkedTicketId!)),
                  icon: const Icon(Icons.handyman_outlined, size: 18),
                  label: Text(l10n.openLinkedTicket),
                ),
              ),
            ],
            if (insight.evaluation != null) EvaluationView(evaluation: insight.evaluation!),
            if (canSetStatus) ...[
              const SizedBox(height: Insets.md),
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  FilledButton.tonal(
                    key: Key('insight.${insight.id}.accept'),
                    onPressed: () => setStatus(InsightStatus.accepted),
                    child: Text(l10n.acceptInsight),
                  ),
                  OutlinedButton(
                    key: Key('insight.${insight.id}.implemented'),
                    onPressed: () => setStatus(InsightStatus.implemented),
                    child: Text(l10n.implementedInsight),
                  ),
                  TextButton(
                    key: Key('insight.${insight.id}.dismiss'),
                    onPressed: () => setStatus(InsightStatus.dismissed),
                    child: Text(l10n.dismissInsight),
                  ),
                ],
              ),
            ],
            if (canDecide) ...[
              const SizedBox(height: Insets.md),
              FilledButton.tonalIcon(
                key: Key('insight.${insight.id}.decide'),
                onPressed: () => showDecisionSheet(context, insight),
                icon: const Icon(Icons.how_to_vote_outlined, size: 18),
                label: Text(l10n.decideAction),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// Measured result of a decided recommendation, with its limitation.
class EvaluationView extends StatelessWidget {
  const EvaluationView({super.key, required this.evaluation});

  final InsightEvaluation evaluation;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final palette = context.status;
    final e = evaluation;
    final outcome = e.method == 'stockout' || e.method == 'oooRooms';
    final (String headline, Color color, IconData icon) = switch (e.status) {
      EvaluationStatus.pending => (
        e.dueAt == null ? l10n.evaluationLabel : l10n.evaluationPending(fmt.date(e.dueAt!)),
        palette.info,
        Icons.schedule,
      ),
      EvaluationStatus.evaluated when e.improved == true => (
        outcome ? l10n.evaluationNoProblem : l10n.evaluationImproved,
        palette.success,
        Icons.verified_outlined,
      ),
      EvaluationStatus.evaluated => (
        outcome ? l10n.evaluationProblemHappened : l10n.evaluationWorse,
        palette.danger,
        Icons.trending_down,
      ),
      EvaluationStatus.inconclusive => (l10n.evaluationInconclusive, palette.neutral, Icons.help_outline),
      EvaluationStatus.insufficientData => (l10n.evaluationInsufficient, palette.neutral, Icons.hourglass_empty),
      EvaluationStatus.notSupported => (l10n.evaluationNotSupported, palette.neutral, Icons.block),
    };
    final limitation = switch (e.method) {
      'energyBaseline' => l10n.evaluationLimitEnergy,
      'stockout' || 'oooRooms' => l10n.evaluationLimitOutcome,
      _ => l10n.evaluationLimitBeforeAfter,
    };
    return Padding(
      padding: const EdgeInsets.only(top: Insets.md),
      child: Container(
        key: const Key('insight.evaluation'),
        width: double.infinity,
        padding: const EdgeInsets.all(Insets.md),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(Radii.sm),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.evaluationLabel, style: theme.textTheme.labelMedium),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(width: Insets.sm),
                Expanded(child: Text(headline, style: theme.textTheme.bodyMedium?.copyWith(color: color, fontWeight: FontWeight.w600))),
              ],
            ),
            if (e.baseline != null && e.actual != null && !outcome) ...[
              const SizedBox(height: 4),
              Text(
                l10n.beforeAfter(fmt.number(e.baseline!, decimals: 1), fmt.number(e.actual!, decimals: 1), l10n.impactUnit(e.unit ?? '')),
                style: theme.textTheme.bodySmall,
              ),
            ],
            if (e.monthlySaving != null && e.status == EvaluationStatus.evaluated) ...[
              const SizedBox(height: 4),
              Text(
                l10n.measuredSaving('${fmt.money(e.monthlySaving!)} ${l10n.currencyRial}'),
                style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
            if (e.status != EvaluationStatus.pending) ...[
              const SizedBox(height: 4),
              Text(limitation, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet: decision, note and (for managers who may report faults) a
/// linked maintenance ticket.
Future<void> showDecisionSheet(BuildContext context, AiInsight insight) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => _DecisionSheet(insight: insight),
);

class _DecisionSheet extends ConsumerStatefulWidget {
  const _DecisionSheet({required this.insight});

  final AiInsight insight;

  @override
  ConsumerState<_DecisionSheet> createState() => _DecisionSheetState();
}

class _DecisionSheetState extends ConsumerState<_DecisionSheet> {
  final _note = TextEditingController();
  late InsightDecision _decision =
      widget.insight.status == InsightStatus.accepted ? InsightDecision.implemented : InsightDecision.accepted;
  bool _ticket = false;
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    setState(() => _saving = true);
    try {
      await ref.read(insightActionsProvider).decide(
        widget.insight,
        _decision,
        note: _note.text,
        createTicket: _ticket && _decision != InsightDecision.dismissed,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      showSuccess(context, l10n.decisionSaved);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final actions = ref.watch(insightActionsProvider);
    final choices = widget.insight.status == InsightStatus.accepted
        ? const [InsightDecision.implemented, InsightDecision.dismissed]
        : InsightDecision.values;
    final offerTicket = actions.canCreateTicket && widget.insight.linkedTicketId == null && _decision != InsightDecision.dismissed;
    return Padding(
      padding: EdgeInsets.only(
        left: Insets.lg,
        right: Insets.lg,
        bottom: MediaQuery.viewInsetsOf(context).bottom + Insets.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.decisionTitle, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Insets.xs),
          Text(widget.insight.title, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: Insets.md),
          SegmentedButton<InsightDecision>(
            key: const Key('decision.choice'),
            segments: [for (final d in choices) ButtonSegment(value: d, label: Text(l10n.insightDecision(d)))],
            selected: {_decision},
            onSelectionChanged: (s) => setState(() => _decision = s.first),
          ),
          const SizedBox(height: Insets.md),
          TextField(
            key: const Key('decision.note'),
            controller: _note,
            maxLines: 3,
            maxLength: 1000,
            decoration: InputDecoration(hintText: l10n.decisionNoteHint),
          ),
          if (offerTicket)
            CheckboxListTile(
              key: const Key('decision.ticket'),
              contentPadding: EdgeInsets.zero,
              value: _ticket,
              onChanged: (v) => setState(() => _ticket = v ?? false),
              title: Text(l10n.createLinkedTicket),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          const SizedBox(height: Insets.sm),
          FilledButton(
            key: const Key('decision.save'),
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(l10n.save),
          ),
        ],
      ),
    );
  }
}
