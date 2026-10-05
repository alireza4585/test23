import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
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

class InsightCard extends ConsumerWidget {
  const InsightCard({super.key, required this.insight, this.expanded = false});

  final AiInsight insight;

  /// Full view (evidence + actions) vs. compact dashboard preview.
  final bool expanded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final user = ref.watch(sessionUserProvider);
    final canAct = user != null &&
        user.canAny(const {
          AppPermission.dashboardExecutive,
          AppPermission.dashboardOperations,
        });

    Future<void> setStatus(InsightStatus status) async {
      try {
        await ref.read(insightActionsProvider).setStatus(insight, status);
        if (context.mounted) showSuccess(context, l10n.insightUpdated);
      } catch (e) {
        if (context.mounted) showFailure(context, e);
      }
    }

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
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Icon(insightIcon(insight.category), size: 18, color: scheme.primary),
              ),
              const SizedBox(width: Insets.sm),
              Text(
                l10n.insightCategory(insight.category),
                style: theme.textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const Spacer(),
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
            const SizedBox(height: Insets.md),
            Text(l10n.recommendationLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(insight.recommendation, style: theme.textTheme.bodyMedium?.copyWith(height: 1.6)),
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
            if (canAct) ...[
              const SizedBox(height: Insets.md),
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  FilledButton.tonal(
                    onPressed: () => setStatus(InsightStatus.accepted),
                    child: Text(l10n.acceptInsight),
                  ),
                  OutlinedButton(
                    onPressed: () => setStatus(InsightStatus.implemented),
                    child: Text(l10n.implementedInsight),
                  ),
                  TextButton(
                    onPressed: () => setStatus(InsightStatus.dismissed),
                    child: Text(l10n.dismissInsight),
                  ),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }
}
