import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/app_config.dart';
import '../../../core/di/core_providers.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/preferences/preferences.dart';
import '../../../core/routing/routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/iran_national_id.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../hotel/application/hotel_providers.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final user = ref.watch(sessionUserProvider)!;
    final prefs = ref.watch(preferencesProvider);
    final sessions = ref.watch(mySessionsProvider).value ?? const [];
    final hotel = ref.watch(hotelProvider).value;
    final config = ref.watch(appConfigProvider);
    final now = ref.watch(clockProvider).now();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileTitle)),
      body: PageBody(
        maxWidth: 640,
        children: [
          ZCard(
            child: Row(
              children: [
                CircleAvatar(radius: 28, child: Text(user.fullName.characters.first, style: theme.textTheme.titleLarge)),
                const SizedBox(width: Insets.lg),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user.fullName, style: theme.textTheme.titleMedium),
                      Text(l10n.role(user.role), style: theme.textTheme.bodySmall),
                      Text(
                        fmt.digits(IranNationalId.mask(user.nationalId)),
                        textDirection: TextDirection.ltr,
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                if (config.backend == BackendKind.demo) StatusPill(label: l10n.demoBadge, color: context.status.accent),
              ],
            ),
          ),
          const SizedBox(height: Insets.md),
          ZCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                if (hotel != null)
                  ListTile(leading: const Icon(Icons.apartment), title: Text(l10n.hotelLabel), trailing: Text(hotel.name)),
                ListTile(
                  leading: const Icon(Icons.verified_user_outlined),
                  title: Text(l10n.myPermissions),
                  trailing: Text(l10n.permissionsCount(fmt.number(user.permissions.length))),
                  onTap: () => showModalBottomSheet<void>(
                    context: context,
                    builder: (_) => SafeArea(
                      child: ListView(
                        shrinkWrap: true,
                        padding: const EdgeInsets.all(Insets.lg),
                        children: [
                          for (final p in user.permissions.toList()..sort((a, b) => a.code.compareTo(b.code)))
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Text(p.code, textDirection: TextDirection.ltr),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.password),
                  title: Text(l10n.changePasswordTitle),
                  onTap: () => context.push(Routes.changePassword),
                ),
              ],
            ),
          ),
          SectionHeader(title: l10n.languageLabel),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'fa', label: Text(l10n.languageFa)),
              ButtonSegment(value: 'en', label: Text(l10n.languageEn)),
            ],
            selected: {prefs.locale.languageCode},
            onSelectionChanged: (s) => ref.read(preferencesProvider.notifier).setLocale(Locale(s.first)),
          ),
          const SizedBox(height: Insets.md),
          SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_outlined)),
              ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_outlined)),
              ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.brightness_auto_outlined)),
            ],
            selected: {prefs.themeMode},
            onSelectionChanged: (s) => ref.read(preferencesProvider.notifier).setThemeMode(s.first),
          ),
          SectionHeader(title: l10n.activeSessions),
          ZCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final s in sessions.where((s) => s.isActive))
                  ListTile(
                    leading: Icon(s.platform == 'ios' ? Icons.phone_iphone : Icons.phone_android),
                    title: Text(s.model, textDirection: TextDirection.ltr),
                    subtitle: Text('${s.appVersion} · ${fmt.relative(s.lastSeenAt, now, l10n)}'),
                  ),
                ListTile(
                  leading: Icon(Icons.logout, color: context.status.danger),
                  title: Text(l10n.revokeAllSessions),
                  onTap: () async {
                    try {
                      await ref.read(sessionRepositoryProvider).revokeAllSessions(user.uid);
                      if (context.mounted) showSuccess(context, l10n.sessionsRevoked);
                    } catch (e) {
                      if (context.mounted) showFailure(context, e);
                    }
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: Insets.xl),
          OutlinedButton.icon(
            key: const Key('profile.signOut'),
            icon: const Icon(Icons.logout),
            label: Text(l10n.signOut),
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  content: Text(l10n.signOutConfirm),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(l10n.cancel)),
                    FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(l10n.signOut)),
                  ],
                ),
              );
              if (ok ?? false) await ref.read(sessionControllerProvider).signOut();
            },
          ),
          const SizedBox(height: Insets.md),
          Center(
            child: Text(
              '${l10n.appName} · ${config.environment}',
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}
