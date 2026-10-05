import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_role.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/iran_national_id.dart';
import '../../../core/widgets/components.dart';
import '../../../data/demo/demo_seed.dart';
import '../application/auth_providers.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _nationalId = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _nationalId.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    await ref
        .read(loginControllerProvider.notifier)
        .signIn(_nationalId.text, _password.text);
    // Navigation happens via the router's auth redirect.
  }

  Future<void> _quickLogin(String nationalId) async {
    _nationalId.text = nationalId;
    _password.text = DemoSeed.demoPassword;
    await _submit();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final state = ref.watch(loginControllerProvider);
    final isDemo = ref.watch(appConfigProvider).isDemo;
    final reason = ref.watch(signOutReasonProvider);
    final wide = MediaQuery.sizeOf(context).width >= Breakpoints.medium;

    final form = Form(
      key: _formKey,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!wide) ...[
              const Center(child: BrandMark(size: 64)),
              const SizedBox(height: Insets.lg),
              Text(
                l10n.appName,
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              Text(
                l10n.appTagline,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: Insets.xxl),
            ],
            Text(l10n.loginTitle, style: theme.textTheme.titleLarge),
            const SizedBox(height: Insets.xs),
            Text(
              l10n.loginSubtitle,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: Insets.xl),
            if (reason != null) ...[
              _Banner(message: l10n.sessionTimedOut, color: context.status.info),
              const SizedBox(height: Insets.md),
            ],
            if (state.hasError) ...[
              _Banner(message: l10n.failure(state.error!), color: context.status.danger),
              const SizedBox(height: Insets.md),
            ],
            TextFormField(
              key: const Key('login.nationalId'),
              controller: _nationalId,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.username],
              textDirection: TextDirection.ltr,
              maxLength: 10,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]')),
              ],
              decoration: InputDecoration(
                labelText: l10n.nationalIdLabel,
                hintText: l10n.nationalIdHint,
                prefixIcon: const Icon(Icons.badge_outlined),
                counterText: '',
              ),
              validator: (v) =>
                  IranNationalId.isValid(v ?? '') ? null : l10n.nationalIdInvalid,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              key: const Key('login.password'),
              controller: _password,
              obscureText: _obscure,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.password],
              textDirection: TextDirection.ltr,
              onFieldSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: l10n.passwordLabel,
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  tooltip: _obscure ? l10n.showPassword : l10n.hidePassword,
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                ),
              ),
              validator: (v) => (v ?? '').isEmpty ? l10n.passwordRequired : null,
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(
              key: const Key('login.submit'),
              onPressed: state.isLoading ? null : _submit,
              child: state.isLoading
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.2))
                  : Text(l10n.loginButton),
            ),
            const SizedBox(height: Insets.md),
            Text(
              l10n.forgotPasswordHint,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            if (isDemo) ...[
              const SizedBox(height: Insets.xl),
              _DemoAccounts(onSelect: state.isLoading ? null : _quickLogin),
            ],
          ],
        ),
      ),
    );

    final formPanel = Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Insets.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: form,
        ),
      ),
    );

    return Scaffold(
      body: SafeArea(
        child: wide
            ? Row(
                children: [
                  const Expanded(child: _BrandPanel()),
                  Expanded(child: formPanel),
                ],
              )
            : formPanel,
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Insets.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.sm),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: color, size: 18),
          const SizedBox(width: Insets.sm),
          Expanded(child: Text(message, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}

class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.all(Insets.lg),
      padding: const EdgeInsets.all(Insets.xxl),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.lg),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.charcoalHigh, AppColors.black],
        ),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const BrandMark(size: 72),
          const SizedBox(height: Insets.xl),
          Text(
            l10n.appName,
            style: theme.textTheme.displaySmall?.copyWith(
              color: AppColors.ivory,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Insets.sm),
          Text(
            l10n.appTagline,
            style: theme.textTheme.titleMedium?.copyWith(color: AppColors.goldBright),
          ),
          const SizedBox(height: Insets.xxl),
          for (final (icon, text) in [
            (Icons.insights_outlined, l10n.sectionInsights),
            (Icons.bolt_outlined, l10n.energyTitle),
            (Icons.verified_user_outlined, l10n.loginFooter),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: Insets.md),
              child: Row(
                children: [
                  Icon(icon, color: AppColors.gold, size: 20),
                  const SizedBox(width: Insets.md),
                  Expanded(
                    child: Text(
                      text,
                      style: theme.textTheme.bodyMedium?.copyWith(color: AppColors.silver),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Role picker for sales demos (only rendered with the demo backend).
class _DemoAccounts extends StatelessWidget {
  const _DemoAccounts({required this.onSelect});

  final Future<void> Function(String nationalId)? onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final groups = <RoleTier, List<(String, String, AppRole, String)>>{};
    for (final a in DemoSeed.accounts) {
      groups.putIfAbsent(a.$3.tier, () => []).add(a);
    }
    return ZCard(
      padding: const EdgeInsets.symmetric(vertical: Insets.sm),
      child: Theme(
        data: theme.copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          key: const Key('login.demoAccounts'),
          leading: Icon(Icons.play_circle_outline, color: theme.colorScheme.primary),
          title: Text(l10n.demoAccountsTitle, style: theme.textTheme.titleSmall),
          subtitle: Text(
            '${l10n.demoAccountsHint}\n${l10n.demoPasswordNote(DemoSeed.demoPassword)}',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          children: [
            for (final tier in [RoleTier.executive, RoleTier.manager, RoleTier.staff, RoleTier.platform])
              if (groups[tier] != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(Insets.lg, Insets.sm, Insets.lg, Insets.sm),
                  child: Wrap(
                    spacing: Insets.sm,
                    runSpacing: Insets.sm,
                    children: [
                      for (final (_, nid, role, _) in groups[tier]!)
                        ActionChip(
                          key: Key('demo.${role.code}.$nid'),
                          avatar: Icon(_tierIcon(tier), size: 16),
                          label: Text(l10n.role(role)),
                          onPressed: onSelect == null ? null : () => onSelect!(nid),
                        ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  static IconData _tierIcon(RoleTier tier) => switch (tier) {
    RoleTier.platform => Icons.shield_outlined,
    RoleTier.executive => Icons.workspace_premium_outlined,
    RoleTier.manager => Icons.supervisor_account_outlined,
    RoleTier.staff => Icons.person_outline,
  };
}
