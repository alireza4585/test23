import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/review_providers.dart';
import '../application/share_intake.dart';
import '../domain/review.dart';

String _ascii(String v) => v.trim().replaceAll(',', '.').replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}');

/// One review typed in, or shared from Instagram, Google Maps, Telegram or a
/// browser (Android share): the link and its site are filled in, all editable.
class ReviewAddPage extends ConsumerStatefulWidget {
  const ReviewAddPage({super.key});

  @override
  ConsumerState<ReviewAddPage> createState() => _ReviewAddPageState();
}

class _ReviewAddPageState extends ConsumerState<ReviewAddPage> {
  final _text = TextEditingController();
  final _url = TextEditingController();
  final _rating = TextEditingController();
  final _scale = TextEditingController(text: '5');
  String _platform = 'other';
  DateTime _date = DateTime.now();
  ReviewChannel _channel = ReviewChannel.manual;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final shared = ref.read(pendingShareProvider);
    if (shared != null && !shared.isCsv) {
      // Cleared after this frame: a provider may not change while the tree builds.
      WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(pendingShareProvider.notifier).take());
      _channel = ReviewChannel.staffShare;
      final link = firstLink(shared.text);
      _url.text = link ?? '';
      _text.text = (link == null ? shared.text : shared.text.replaceFirst(link, '')).trim();
      _platform = guessReviewPlatform(link);
    }
    _url.addListener(() {
      final guess = guessReviewPlatform(_url.text.trim());
      if (guess != 'other' && _platform == 'other') setState(() => _platform = guess);
    });
  }

  @override
  void dispose() {
    for (final c in [_text, _url, _rating, _scale]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    final rating = _rating.text.trim().isEmpty ? null : double.tryParse(_ascii(_rating.text));
    final scale = double.tryParse(_ascii(_scale.text));
    setState(() => _busy = true);
    try {
      final result = await ref.read(reviewActionsProvider).add(ReviewDraft(
        channel: _channel,
        text: _text.text,
        url: _url.text.trim().isEmpty ? null : _url.text.trim(),
        platform: _platform,
        postedAt: _date,
        rating: rating,
        scaleMax: rating == null ? null : scale,
      ));
      if (!mounted) return;
      final saved = result.status == ReviewStatus.needsReview ? l10n.rvSavedQueued : l10n.rvSaved;
      showSuccess(context, result.linkRemoved ? '$saved ${l10n.rvLinkRemoved}' : saved);
      context.pop();
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(_channel == ReviewChannel.staffShare ? l10n.rvSharedTitle : l10n.rvAddTitle)),
      body: PageBody(
        maxWidth: 720,
        children: [
          TextField(
            key: const ValueKey('rv-add-url'),
            controller: _url,
            keyboardType: TextInputType.url,
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(labelText: l10n.rvLink, hintText: 'https://'),
          ),
          const SizedBox(height: Insets.md),
          DropdownButtonFormField<String>(
            key: ValueKey('rv-add-platform-$_platform'),
            initialValue: _platform,
            decoration: InputDecoration(labelText: l10n.rvSource),
            items: [
              for (final p in reviewPlatforms.where((p) => p != 'survey')) DropdownMenuItem(value: p, child: Text(l10n.rvPlatform(p))),
            ],
            onChanged: (v) => setState(() => _platform = v ?? 'other'),
          ),
          const SizedBox(height: Insets.md),
          TextField(
            key: const ValueKey('rv-add-text'),
            controller: _text,
            minLines: 4,
            maxLines: 12,
            maxLength: 8000,
            decoration: InputDecoration(labelText: l10n.rvText, helperText: l10n.rvTextHint, helperMaxLines: 3),
          ),
          const SizedBox(height: Insets.md),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event_outlined),
            title: Text(l10n.rvDate),
            subtitle: Text(context.fmt.date(_date)),
            onTap: () async {
              final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2015), lastDate: DateTime.now());
              if (d != null) setState(() => _date = d);
            },
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('rv-add-rating'),
                  controller: _rating,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: l10n.rvRatingLabel),
                ),
              ),
              const SizedBox(width: Insets.md),
              SizedBox(
                width: 96,
                child: TextField(controller: _scale, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: l10n.rvScaleLabel)),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          FilledButton(key: const ValueKey('rv-add-save'), onPressed: _busy ? null : _save, child: Text(l10n.rvSave)),
        ],
      ),
    );
  }
}

/// CSV in the generic format: a preview first (nothing saved), then the import.
class ReviewImportPage extends ConsumerStatefulWidget {
  const ReviewImportPage({super.key});

  @override
  ConsumerState<ReviewImportPage> createState() => _ReviewImportPageState();
}

class _ReviewImportPageState extends ConsumerState<ReviewImportPage> {
  final _csv = TextEditingController();
  String? _platform;
  ImportResult? _preview;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final shared = ref.read(pendingShareProvider);
    if (shared != null && shared.isCsv) {
      WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(pendingShareProvider.notifier).take());
      _csv.text = shared.text;
    }
    _csv.addListener(() {
      if (_preview != null) setState(() => _preview = null);
    });
  }

  @override
  void dispose() {
    _csv.dispose();
    super.dispose();
  }

  Future<void> _run({required bool dryRun}) async {
    final l10n = context.l10n;
    setState(() => _busy = true);
    try {
      final r = await ref.read(reviewActionsProvider).importCsv(_csv.text, platform: _platform, dryRun: dryRun);
      if (!mounted) return;
      if (dryRun) {
        setState(() => _preview = r);
      } else {
        showSuccess(context, '${l10n.rvImportDone}: ${l10n.rvImportSummary(r.created, r.updated, r.unchanged, r.needsReview, r.crossPosts)}');
        context.pop();
      }
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final p = _preview;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.rvImportTitle)),
      body: PageBody(
        maxWidth: 900,
        children: [
          Text(l10n.rvImportHint, style: theme.textTheme.bodySmall),
          const SizedBox(height: Insets.md),
          DropdownButtonFormField<String?>(
            initialValue: _platform,
            decoration: InputDecoration(labelText: l10n.rvSource),
            items: [
              DropdownMenuItem<String?>(value: null, child: Text(l10n.rvFilterAll)),
              for (final pl in reviewPlatforms.where((x) => x != 'survey')) DropdownMenuItem<String?>(value: pl, child: Text(l10n.rvPlatform(pl))),
            ],
            onChanged: (v) => setState(() {
              _platform = v;
              _preview = null;
            }),
          ),
          const SizedBox(height: Insets.md),
          TextField(
            key: const ValueKey('rv-import-csv'),
            controller: _csv,
            minLines: 6,
            maxLines: 14,
            textDirection: TextDirection.ltr,
            style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
            decoration: InputDecoration(labelText: l10n.rvImportPaste, alignLabelWithHint: true),
          ),
          const SizedBox(height: Insets.md),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: OutlinedButton(key: const ValueKey('rv-import-preview'), onPressed: _busy ? null : () => _run(dryRun: true), child: Text(l10n.rvImportPreview)),
          ),
          if (p != null) ...[
            SectionHeader(title: l10n.rvImportSummary(p.created, p.updated, p.unchanged, p.needsReview, p.crossPosts)),
            if (p.errors.isNotEmpty) ...[
              Text(l10n.rvImportErrors(p.errors.length), style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.error)),
              for (final (row, reason) in p.errors.take(20))
                Text(l10n.rvImportRowError(row, l10n.rvImportReason(reason)), style: theme.textTheme.bodySmall),
              const SizedBox(height: Insets.sm),
            ],
            for (final r in p.preview.take(20))
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Text(context.fmt.digits('${r.row}')),
                title: Text(r.text.isEmpty ? '—' : r.text, maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text([
                  l10n.rvPlatform(r.platform),
                  if (r.rating5 != null) l10n.rvRating(context.fmt.digits(r.rating5!.toStringAsFixed(1))),
                  if (r.status == 'needsReview') l10n.rvToReview,
                ].join(' · ')),
              ),
            const SizedBox(height: Insets.md),
            FilledButton(
              key: const ValueKey('rv-import-commit'),
              onPressed: _busy || p.rows == 0 ? null : () => _run(dryRun: false),
              child: Text(l10n.rvImportCommit(p.rows)),
            ),
          ],
        ],
      ),
    );
  }
}
