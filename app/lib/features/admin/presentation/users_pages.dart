import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/routing/routes.dart';
import '../../../core/security/app_role.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/iran_national_id.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/domain/app_user.dart';
import '../application/admin_providers.dart';
import '../domain/user_admin.dart';

class UsersPage extends ConsumerWidget {
  const UsersPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final users = ref.watch(managedUsersProvider);
    final me = ref.watch(sessionUserProvider)!;
    final assignable = ref.watch(assignableRolesProvider).toSet();
    final now = ref.watch(clockProvider).now();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.usersTitle), actions: const [ShellActions()]),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('users.new'),
        onPressed: () => context.push(Routes.usersNew),
        icon: const Icon(Icons.person_add_alt),
        label: Text(l10n.newUser),
      ),
      body: AsyncValueView<List<ManagedUser>>(
        value: users,
        data: (list) => PageBody(
          maxWidth: 860,
          children: [
            for (final u in list)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.sm),
                child: ZCard(
                  padding: const EdgeInsets.symmetric(horizontal: Insets.lg, vertical: Insets.sm),
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(child: Text(u.fullName.characters.first)),
                    title: Text(u.fullName),
                    subtitle: Text(
                      [
                        l10n.role(u.role),
                        fmt.digits(u.nationalIdMasked),
                        u.lastLoginAt == null
                            ? l10n.neverLoggedIn
                            : l10n.lastLogin(fmt.relative(u.lastLoginAt!, now, l10n)),
                      ].join(' · '),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        StatusPill(
                          label: l10n.userStatus(u.status),
                          color: u.status == UserStatus.active ? context.status.success : context.status.danger,
                        ),
                        if (u.uid != me.uid && assignable.contains(u.role))
                          PopupMenuButton<String>(
                            onSelected: (action) => _onAction(context, ref, u, action),
                            itemBuilder: (_) => [
                              if (u.status == UserStatus.active)
                                PopupMenuItem(value: 'suspend', child: Text(l10n.suspendUser))
                              else
                                PopupMenuItem(value: 'activate', child: Text(l10n.activateUser)),
                              PopupMenuItem(value: 'reset', child: Text(l10n.resetPassword)),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 72),
          ],
        ),
      ),
    );
  }

  Future<void> _onAction(BuildContext context, WidgetRef ref, ManagedUser u, String action) async {
    final actions = ref.read(userAdminActionsProvider);
    final l10n = context.l10n;
    try {
      switch (action) {
        case 'suspend':
          await actions.setStatus(u, UserStatus.suspended);
          if (context.mounted) showSuccess(context, l10n.savedSuccessfully);
        case 'activate':
          await actions.setStatus(u, UserStatus.active);
          if (context.mounted) showSuccess(context, l10n.savedSuccessfully);
        case 'reset':
          final password = await actions.resetPassword(u);
          if (context.mounted) {
            await showDialog<void>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: Text(l10n.resetPassword),
                content: SelectableText(l10n.passwordResetDone(password)),
                actions: [
                  TextButton(
                    onPressed: () => Clipboard.setData(ClipboardData(text: password)),
                    child: const Icon(Icons.copy),
                  ),
                  FilledButton(onPressed: () => Navigator.pop(dialogContext), child: Text(l10n.close)),
                ],
              ),
            );
          }
      }
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }
}

class NewUserPage extends ConsumerStatefulWidget {
  const NewUserPage({super.key});

  @override
  ConsumerState<NewUserPage> createState() => _NewUserPageState();
}

class _NewUserPageState extends ConsumerState<NewUserPage> {
  final _formKey = GlobalKey<FormState>();
  final _nationalId = TextEditingController();
  final _fullName = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController(text: UserAdminActions.generatePassword());
  AppRole? _role;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_nationalId, _fullName, _phone, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(userAdminActionsProvider).create(
        nationalId: _nationalId.text,
        fullName: _fullName.text,
        role: _role!,
        temporaryPassword: _password.text,
        phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
      );
      if (!mounted) return;
      showSuccess(context, context.l10n.userCreated);
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
    final roles = ref.watch(assignableRolesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.newUser)),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 560,
          children: [
            TextFormField(
              key: const Key('newUser.nationalId'),
              controller: _nationalId,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              maxLength: 10,
              decoration: InputDecoration(labelText: l10n.nationalIdLabel, counterText: ''),
              validator: (v) => IranNationalId.isValid(v ?? '') ? null : l10n.nationalIdInvalid,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              key: const Key('newUser.fullName'),
              controller: _fullName,
              decoration: InputDecoration(labelText: l10n.fullNameLabel),
              validator: (v) => (v ?? '').trim().length < 3 ? l10n.requiredField : null,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: '${l10n.phoneLabel} (${l10n.optional})'),
            ),
            const SizedBox(height: Insets.md),
            DropdownButtonFormField<AppRole>(
              key: const Key('newUser.role'),
              initialValue: _role,
              decoration: InputDecoration(labelText: l10n.roleLabel, helperText: l10n.assignableRolesHint),
              items: [for (final r in roles) DropdownMenuItem(value: r, child: Text(l10n.role(r)))],
              onChanged: (r) => setState(() => _role = r),
              validator: (r) => r == null ? l10n.requiredField : null,
            ),
            const SizedBox(height: Insets.md),
            TextFormField(
              controller: _password,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: l10n.temporaryPassword,
                helperText: l10n.passwordTooWeak,
                suffixIcon: TextButton(
                  onPressed: () => setState(() => _password.text = UserAdminActions.generatePassword()),
                  child: Text(l10n.generatePassword),
                ),
              ),
              validator: (v) => UserAdminActions.isStrongPassword(v ?? '') ? null : l10n.passwordTooWeak,
            ),
            const SizedBox(height: Insets.xl),
            FilledButton(
              key: const Key('newUser.submit'),
              onPressed: _busy ? null : _submit,
              child: Text(l10n.createUser),
            ),
          ],
        ),
      ),
    );
  }
}
