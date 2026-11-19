import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/review_providers.dart';
import '../domain/review.dart';

/// Space below the last control so the floating button never covers it.
const _fabRoom = 80.0;

List<String> _split(String v) => [
  for (final p in v.split(RegExp('[,،\n]'))) if (p.trim().isNotEmpty) p.trim(),
];

/// Managers: the hotel's profile for matching, its pages on review sites and
/// a setup check. Platform-level limits (LLM cap, minimum n, thresholds) are
/// set by the platform owner, not here.
class ReviewSettingsTab extends ConsumerWidget {
  const ReviewSettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncValueView<ReviewProfile?>(
      value: ref.watch(reviewProfileProvider),
      onRetry: () => ref.invalidate(reviewProfileProvider),
      data: (p) => p == null
          ? const SizedBox.shrink()
          : PageBody(
              maxWidth: 900,
              children: [
                const _Readiness(),
                _ProfileForm(key: ValueKey(p.hashCode), profile: p),
                const _Listings(),
                const SizedBox(height: _fabRoom),
              ],
            ),
    );
  }
}

class _Readiness extends ConsumerWidget {
  const _Readiness();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final r = ref.watch(reviewReadinessProvider).value;
    if (r == null) return const SizedBox.shrink();
    Widget row(bool ok, String text) => ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(ok ? Icons.check_circle : Icons.radio_button_unchecked, color: ok ? Colors.green : null),
      title: Text(text),
    );
    return ZCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.rvReadyTitle, style: Theme.of(context).textTheme.titleSmall),
          row(r.profileSaved && r.names, l10n.rvReadyProfile),
          row(r.city, l10n.rvReadyCity),
          row(r.listingsConfirmed > 0, l10n.rvReadyListings(r.listingsConfirmed)),
          row(r.surveyConfigured, r.surveyConfigured ? l10n.rvReadySurvey : l10n.rvReadySurveyMissing),
        ],
      ),
    );
  }
}

class _ProfileForm extends ConsumerStatefulWidget {
  const _ProfileForm({super.key, required this.profile});

  final ReviewProfile profile;

  @override
  ConsumerState<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<_ProfileForm> {
  late final _nameFa = TextEditingController(text: widget.profile.nameFa);
  late final _nameEn = TextEditingController(text: widget.profile.nameEn);
  late final _aliases = TextEditingController(text: widget.profile.aliases.join('، '));
  late final _city = TextEditingController(text: widget.profile.city);
  late final _cityAliases = TextEditingController(text: widget.profile.cityAliases.join('، '));
  late final _negative = TextEditingController(text: widget.profile.negativeKeywords.join('، '));
  late final _retention = TextEditingController(text: '${widget.profile.retentionDays}');
  late final _brand = TextEditingController(text: widget.profile.survey.brandName);
  late bool _public = widget.profile.survey.publicEnabled;
  late bool _room = widget.profile.survey.roomEnabled;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_nameFa, _nameEn, _aliases, _city, _cityAliases, _negative, _retention, _brand]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    final days = int.tryParse(_retention.text.trim().replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}'));
    var update = ReviewProfileUpdate(
      nameFa: _nameFa.text.trim(),
      nameEn: _nameEn.text.trim(),
      aliases: _split(_aliases.text),
      city: _city.text.trim(),
      cityAliases: _split(_cityAliases.text),
      negativeKeywords: _split(_negative.text),
      retentionDays: days,
      publicSurvey: _public,
      roomSurvey: _room,
      brandName: _brand.text.trim(),
    );
    setState(() => _busy = true);
    try {
      try {
        await ref.read(reviewActionsProvider).saveProfile(update);
      } on RetentionConfirmationRequired catch (e) {
        if (!mounted) return;
        final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            content: Text(l10n.rvRetentionConfirm(e.affected)),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: Text(MaterialLocalizations.of(c).cancelButtonLabel)),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l10n.rvConfirm)),
            ],
          ),
        );
        if (ok != true) return;
        update = update.withConfirmPurge();
        await ref.read(reviewActionsProvider).saveProfile(update);
      }
      if (mounted) showSuccess(context, l10n.rvSaved);
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    Widget field(TextEditingController c, String label, {Key? key, TextInputType? type, int maxLines = 1}) => Padding(
      padding: const EdgeInsets.only(bottom: Insets.md),
      child: TextField(key: key, controller: c, keyboardType: type, maxLines: maxLines, decoration: InputDecoration(labelText: label)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: l10n.rvProfileTitle, subtitle: l10n.rvProfileHint),
        field(_nameFa, l10n.rvNameFa, key: const ValueKey('rv-name-fa')),
        field(_nameEn, l10n.rvNameEn),
        field(_aliases, l10n.rvAliases, key: const ValueKey('rv-aliases')),
        field(_city, l10n.rvCity),
        field(_cityAliases, l10n.rvCityAliases),
        field(_negative, l10n.rvNegative, key: const ValueKey('rv-negative')),
        field(_retention, l10n.rvRetention, key: const ValueKey('rv-retention'), type: TextInputType.number),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _public, onChanged: (v) => setState(() => _public = v), title: Text(l10n.rvSurveyPublic)),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _room, onChanged: (v) => setState(() => _room = v), title: Text(l10n.rvSurveyRoom)),
        field(_brand, l10n.rvBrand),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: FilledButton(key: const ValueKey('rv-save-profile'), onPressed: _busy ? null : _save, child: Text(l10n.rvSave)),
        ),
      ],
    );
  }
}

class _Listings extends ConsumerStatefulWidget {
  const _Listings();

  @override
  ConsumerState<_Listings> createState() => _ListingsState();
}

class _ListingsState extends ConsumerState<_Listings> {
  final _url = TextEditingController();
  bool _confirm = true;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() call) async {
    try {
      await call();
      if (mounted) showSuccess(context, context.l10n.rvSaved);
    } catch (e) {
      if (mounted) showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final listings = ref.watch(reviewListingsProvider).value ?? const <ReviewListing>[];
    final actions = ref.read(reviewActionsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: l10n.rvListingsTitle, subtitle: l10n.rvListingsHint),
        for (final l in listings)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l.label?.isNotEmpty == true ? l.label! : l10n.rvPlatform(l.platform)),
            subtitle: Text(l.url ?? l.externalId ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, textDirection: TextDirection.ltr),
            trailing: l.status == ListingStatus.candidate
                ? Wrap(spacing: Insets.xs, children: [
                    TextButton(onPressed: () => _run(() => actions.decideListing(l.id, confirm: true)), child: Text(l10n.rvConfirm)),
                    TextButton(onPressed: () => _run(() => actions.decideListing(l.id, confirm: false)), child: Text(l10n.rvNotOurs)),
                  ])
                : Text(l10n.rvListingStatus(l.status.name)),
          ),
        TextField(
          key: const ValueKey('rv-listing-url'),
          controller: _url,
          keyboardType: TextInputType.url,
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(labelText: l10n.rvListingUrl, hintText: 'https://'),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _confirm,
          onChanged: (v) => setState(() => _confirm = v ?? false),
          title: Text(l10n.rvListingConfirmNow),
        ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: OutlinedButton(
            key: const ValueKey('rv-listing-add'),
            onPressed: () => _run(() async {
              await actions.addListing(_url.text, confirm: _confirm);
              _url.clear();
            }),
            child: Text(l10n.rvListingAdd),
          ),
        ),
      ],
    );
  }
}
