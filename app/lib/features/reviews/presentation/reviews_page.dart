import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/review_providers.dart';
import '../domain/review.dart';
import 'review_settings_tab.dart';
import 'survey_qr_tab.dart';

/// Guest reviews (F10, R1): the accepted reviews with their source; for
/// managers also the review queue, sources & settings, and the QR survey.
/// No AI here: analysis and the daily summary come in R2.
class ReviewsPage extends ConsumerWidget {
  const ReviewsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final manage = ref.watch(canManageReviewsProvider);
    final queued = ref.watch(reviewQueueProvider).value?.length ?? 0;
    final fab = manage
        ? FloatingActionButton.extended(
            onPressed: () => _addMenu(context),
            icon: const Icon(Icons.add_comment_outlined),
            label: Text(l10n.rvAdd),
          )
        : null;
    if (!manage) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.navReviews), actions: const [ShellActions()]),
        body: const _ReviewList(),
      );
    }
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.navReviews),
          actions: const [ShellActions()],
          bottom: TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: l10n.rvTabList),
              Tab(text: l10n.rvTabQueue(queued)),
              Tab(text: l10n.rvTabSettings),
              Tab(text: l10n.rvTabQr),
            ],
          ),
        ),
        floatingActionButton: fab,
        body: const TabBarView(children: [_ReviewList(), _QueueTab(), ReviewSettingsTab(), SurveyQrTab()]),
      ),
    );
  }

  static Future<void> _addMenu(BuildContext context) async {
    final l10n = context.l10n;
    final route = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.edit_note), title: Text(l10n.rvAddManual), onTap: () => Navigator.pop(c, Routes.reviewsAdd)),
            ListTile(leading: const Icon(Icons.table_chart_outlined), title: Text(l10n.rvImportCsv), onTap: () => Navigator.pop(c, Routes.reviewsImport)),
          ],
        ),
      ),
    );
    if (route != null && context.mounted) await context.push(route);
  }
}

enum _Filter { all, platforms, staff, inStay, publicQr }

class _ReviewList extends ConsumerStatefulWidget {
  const _ReviewList();

  @override
  ConsumerState<_ReviewList> createState() => _ReviewListState();
}

class _ReviewListState extends ConsumerState<_ReviewList> {
  _Filter _filter = _Filter.all;


  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final labels = {
      _Filter.all: l10n.rvFilterAll,
      _Filter.platforms: l10n.rvFilterPlatforms,
      _Filter.staff: l10n.rvFilterStaff,
      _Filter.inStay: l10n.rvFilterInStay,
      _Filter.publicQr: l10n.rvFilterPublicQr,
    };
    return AsyncValueView<List<GuestReview>>(
      value: ref.watch(reviewsProvider),
      data: (all) {
        final visible = all.where((r) => _matches(_filter, r)).toList();
        final aspects = ref.watch(reviewAspectsProvider).value ?? const <String, List<ReviewAspect>>{};
        return PageBody(
          maxWidth: 900,
          children: [
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.xs,
              children: [
                for (final f in _Filter.values)
                  ChoiceChip(
                    key: ValueKey('rv-filter-${f.name}'),
                    label: Text('${labels[f]} (${context.fmt.number(all.where((r) => _matches(f, r)).length)})'),
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
              ],
            ),
            const SizedBox(height: Insets.md),
            const DigestCard(),
            if (visible.isEmpty)
              Padding(padding: const EdgeInsets.only(top: Insets.xl), child: EmptyState(message: l10n.rvEmpty, icon: Icons.reviews_outlined))
            else
              for (final r in visible)
                Padding(padding: const EdgeInsets.only(bottom: Insets.sm), child: ReviewTile(review: r, aspects: aspects[r.id] ?? const [])),
            const SizedBox(height: 80),
          ],
        );
      },
    );
  }

  static bool _matches(_Filter f, GuestReview r) => switch (f) {
    _Filter.all => true,
    _Filter.platforms => !r.channel.isSurvey && !r.channel.isStaffCaptured,
    _Filter.staff => r.channel.isStaffCaptured,
    _Filter.inStay => r.channel == ReviewChannel.surveyRoom,
    _Filter.publicQr => r.channel == ReviewChannel.surveyPublic,
  };
}

/// One review: source, channel, rating (1–5 and the original scale), date,
/// text and a link to the site. [actions] for the queue.
class ReviewTile extends StatelessWidget {
  const ReviewTile({super.key, required this.review, this.actions, this.aspects = const []});

  final GuestReview review;

  /// Found by the analysis (LLM or rules).
  final List<ReviewAspect> aspects;
  final Widget? actions;

  String _num(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final r = review;
    return ZCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: Insets.sm,
            runSpacing: Insets.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusPill(label: l10n.rvPlatform(r.platform), color: scheme.primary, icon: Icons.public),
              StatusPill(label: l10n.rvChannel(r.channel.wire), color: r.channel.isStaffCaptured ? scheme.tertiary : scheme.secondary),
              if (r.rating5 != null)
                Text(
                  [
                    l10n.rvRating(fmt.digits(_num(r.rating5!))),
                    if (r.ratingRaw != null && r.scaleMax != null && r.scaleMax != 5) l10n.rvRatingRaw(fmt.digits(_num(r.ratingRaw!)), fmt.digits(_num(r.scaleMax!))),
                  ].join(' '),
                  style: theme.textTheme.labelLarge,
                ),
              if (r.postedAt != null) Text(fmt.date(r.postedAt!), style: theme.textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: Insets.sm),
          if (r.title != null) Text(r.title!, style: theme.textTheme.titleSmall),
          if (r.textPurged)
            Text(l10n.rvTextPurged, style: theme.textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic))
          else if (r.text.isNotEmpty)
            Text(r.text, style: theme.textTheme.bodyMedium),
          if (aspects.isNotEmpty) ...[
            const SizedBox(height: Insets.xs),
            Wrap(
              spacing: Insets.xs,
              runSpacing: Insets.xs,
              children: [
                for (final a in aspects)
                  StatusPill(
                    label: '${l10n.rvAspect(a.aspect)} ${a.positive ? '+' : '−'}',
                    color: a.positive ? Colors.green.shade700 : scheme.error,
                  ),
              ],
            ),
          ],
          if (r.duplicateOf != null || r.editedAt != null || r.matchReasons.isNotEmpty || r.url != null) ...[
            const SizedBox(height: Insets.xs),
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (r.duplicateOf != null) Text(l10n.rvCrossPost, style: theme.textTheme.bodySmall),
                if (r.editedAt != null) Text(l10n.rvEdited, style: theme.textTheme.bodySmall),
                if (actions != null)
                  for (final reason in r.matchReasons)
                    Chip(
                      visualDensity: VisualDensity.compact,
                      label: Text(reason.startsWith('negative:') ? l10n.rvReasonNegative(reason.substring(9)) : l10n.rvReason(reason)),
                    ),
                if (r.url != null)
                  TextButton.icon(
                    onPressed: () => launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: Text(l10n.rvOpenLink),
                  ),
              ],
            ),
          ],
          ?actions,
        ],
      ),
    );
  }
}

class _QueueTab extends ConsumerWidget {
  const _QueueTab();

  Future<void> _decide(BuildContext context, WidgetRef ref, String id, bool accept) async {
    try {
      await ref.read(reviewActionsProvider).decide(id, accept: accept);
      if (context.mounted) showSuccess(context, context.l10n.rvDecided);
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    return AsyncValueView<List<GuestReview>>(
      value: ref.watch(reviewQueueProvider),
      onRetry: () => ref.invalidate(reviewQueueProvider),
      data: (items) => PageBody(
        maxWidth: 900,
        children: [
          Text(l10n.rvQueueHint, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: Insets.md),
          if (items.isEmpty)
            EmptyState(message: l10n.rvQueueEmpty, icon: Icons.task_alt)
          else
            for (final r in items)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: ReviewTile(
                  review: r,
                  actions: Padding(
                    padding: const EdgeInsets.only(top: Insets.sm),
                    child: Wrap(
                      spacing: Insets.sm,
                      runSpacing: Insets.xs,
                      children: [
                        FilledButton.icon(
                          key: ValueKey('rv-accept-${r.id}'),
                          onPressed: () => _decide(context, ref, r.id, true),
                          icon: const Icon(Icons.check),
                          label: Text(l10n.rvAccept),
                        ),
                        OutlinedButton.icon(
                          key: ValueKey('rv-reject-${r.id}'),
                          onPressed: () => _decide(context, ref, r.id, false),
                          icon: const Icon(Icons.close),
                          label: Text(l10n.rvReject),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

/// The latest daily summary: new reviews by channel group, the rated average
/// and (if the hotel opted in) the estimated satisfaction, each only from its
/// minimum n, and the most mentioned aspects.
class DigestCard extends ConsumerWidget {
  const DigestCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(reviewDigestProvider).value;
    if (d == null) return const SizedBox.shrink();
    final l10n = context.l10n;
    final fmt = context.fmt;
    final theme = Theme.of(context);
    String score(String label, ReviewScore s) => s.value == null
        ? l10n.rvScoreNotEnough(label, fmt.digits('${s.n}'), fmt.digits('${s.needs}'))
        : l10n.rvScoreRated(label, fmt.digits(s.value!.toStringAsFixed(2)), fmt.digits('${s.n}'));
    final day = DateTime.tryParse(d.day);
    return Padding(
      padding: const EdgeInsets.only(bottom: Insets.md),
      child: ZCard(
        key: const ValueKey('rv-digest'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.rvDigestTitle(day == null ? d.day : fmt.date(day)), style: theme.textTheme.titleSmall),
            const SizedBox(height: Insets.xs),
            Text([
              l10n.rvDigestNew(d.newCount),
              for (final e in d.byGroup.entries.where((e) => e.value > 0)) '${l10n.rvGroup(e.key)} ${fmt.digits('${e.value}')}',
            ].join(' · ')),
            Text(score(l10n.rvRatedLabel, d.rated)),
            for (final g in const ['inStay', 'publicQr'])
              if ((d.ratedByGroup[g]?.n ?? 0) > 0) Text(score(l10n.rvGroup(g), d.ratedByGroup[g]!), style: theme.textTheme.bodySmall),
            if (d.estimated != null)
              Text(
                d.estimated!.value == null
                    ? l10n.rvScoreNotEnough(l10n.rvEstimatedLabel, fmt.digits('${d.estimated!.n}'), fmt.digits('${d.estimated!.needs}'))
                    : l10n.rvScoreRated(l10n.rvEstimatedLabel, fmt.digits(d.estimated!.value!.toStringAsFixed(2)), fmt.digits('${d.estimated!.n}')),
                key: const ValueKey('rv-digest-estimated'),
              ),
            if (d.themes.isNotEmpty) ...[
              const SizedBox(height: Insets.xs),
              Text(l10n.rvThemes, style: theme.textTheme.labelMedium),
              Wrap(
                spacing: Insets.xs,
                runSpacing: Insets.xs,
                children: [
                  for (final t in d.themes)
                    StatusPill(
                      label: l10n.rvTheme('${l10n.rvAspect(t.aspect)} ${t.positive ? '+' : '−'}', fmt.digits('${t.count}')),
                      color: t.positive ? Colors.green.shade700 : theme.colorScheme.error,
                    ),
                ],
              ),
            ],
            if (d.backlog > 0) Text(l10n.rvBacklog(d.backlog), style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
