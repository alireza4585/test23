import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../data/repository_providers.dart';
import '../../admin/application/admin_providers.dart';
import '../application/auth_providers.dart';

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const BrandMark(size: 72),
            const SizedBox(height: Insets.lg),
            Text(context.l10n.appName, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: Insets.xl),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ],
        ),
      ),
    );
  }
}

class AccessDeniedPage extends StatelessWidget {
  const AccessDeniedPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(),
      body: EmptyState(
        icon: Icons.lock_outline,
        message: '${l10n.accessDeniedTitle}\n\n${l10n.accessDeniedBody}',
        action: FilledButton(
          onPressed: () => context.go(Routes.home),
          child: Text(l10n.goHome),
        ),
      ),
    );
  }
}

/// Forced after first sign-in with a temporary password, and reachable from
/// the profile screen.
class ChangePasswordPage extends ConsumerStatefulWidget {
  const ChangePasswordPage({super.key});

  @override
  ConsumerState<ChangePasswordPage> createState() => _ChangePasswordPageState();
}

class _ChangePasswordPageState extends ConsumerState<ChangePasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).changePassword(
        currentPassword: _current.text,
        newPassword: _next.text,
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.passwordChanged);
      context.go(Routes.home);
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(sessionUserProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.changePasswordTitle),
        actions: [
          if (user?.mustChangePassword ?? false)
            TextButton(
              onPressed: () => ref.read(sessionControllerProvider).signOut(),
              child: Text(l10n.signOut),
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 480,
          children: [
            if (user?.mustChangePassword ?? false)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.lg),
                child: Text(l10n.mustChangePasswordInfo),
              ),
            TextFormField(
              controller: _current,
              obscureText: true,
              decoration: InputDecoration(labelText: l10n.currentPassword),
              validator: (v) => (v ?? '').isEmpty ? l10n.requiredField : null,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _next,
              obscureText: true,
              decoration: InputDecoration(labelText: l10n.newPassword, helperText: l10n.passwordTooWeak),
              validator: (v) => UserAdminActions.isStrongPassword(v ?? '') ? null : l10n.passwordTooWeak,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: InputDecoration(labelText: l10n.confirmPassword),
              validator: (v) => v == _next.text ? null : l10n.passwordsDontMatch,
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}
