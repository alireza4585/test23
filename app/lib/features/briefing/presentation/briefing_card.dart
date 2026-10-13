import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../data/repository_providers.dart';
import '../../actions/application/action_providers.dart';


/// First card of the home page (morningBriefing flag): today's briefing for
/// the user's role, collapsed to its first two items, with "useful / not useful".
class BriefingCard extends ConsumerStatefulWidget {
  const BriefingCard({super.key});

  @override
  ConsumerState<BriefingCard> createState() => _BriefingCardState();
}

class _BriefingCardState extends ConsumerState<BriefingCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final briefing = ref.watch(briefingProvider).value;
    if (briefing == null) return const SizedBox.shrink();
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final lines = briefing.text.split('\n').skip(1).toList();
    final shown = _expanded ? lines : lines.take(2).toList();
    Future<void> rate(bool useful) async {
      try {
        await ref.read(briefingRepositoryProvider).rate(briefing.id, useful: useful);
        if (context.mounted) showSuccess(context, l10n.briefingThanks);
      } catch (e) {
        if (context.mounted) showFailure(context, e);
      }
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: Insets.md),
      child: ZCard(
        key: const Key('briefing.card'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.wb_twilight, color: AppColors.gold),
                const SizedBox(width: Insets.sm),
                Expanded(child: Text(l10n.briefingTitle, style: theme.textTheme.titleMedium)),
                Text(briefing.source == 'llm' ? l10n.briefingSourceLlm : l10n.briefingSourceRules, style: theme.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: Insets.sm),
            if (lines.isEmpty) Text(l10n.briefingNone, style: theme.textTheme.bodySmall),
            for (final line in shown)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.xs),
                child: Text(line, style: theme.textTheme.bodyMedium),
              ),
            Wrap(
              spacing: Insets.xs,
              children: [
                if (lines.length > shown.length || _expanded && lines.length > 2)
                  TextButton(
                    key: const Key('briefing.expand'),
                    onPressed: () => setState(() => _expanded = !_expanded),
                    child: Text(_expanded ? l10n.showLess : l10n.showAll(lines.length)),
                  ),
                TextButton.icon(
                  key: const Key('briefing.useful'),
                  onPressed: () => rate(true),
                  icon: Icon(briefing.myRating == true ? Icons.thumb_up : Icons.thumb_up_outlined, size: 18),
                  label: Text(l10n.briefingUseful),
                ),
                TextButton.icon(
                  key: const Key('briefing.notUseful'),
                  onPressed: () => rate(false),
                  icon: Icon(briefing.myRating == false ? Icons.thumb_down : Icons.thumb_down_outlined, size: 18),
                  label: Text(l10n.briefingNotUseful),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

