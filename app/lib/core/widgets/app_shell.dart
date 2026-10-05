import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/application/auth_providers.dart';
import '../../features/notifications/application/notifications_providers.dart';
import '../l10n/enum_labels.dart';
import '../l10n/l10n.dart';
import '../routing/navigation.dart';
import '../routing/routes.dart';
import '../theme/app_theme.dart';
import 'components.dart';

/// Adaptive navigation chrome:
/// * phones (< 600dp): Material 3 NavigationBar with the role's top 4
///   destinations + "More" sheet;
/// * tablets / desktop: NavigationRail with every allowed destination
///   (extended with labels ≥ 1200dp).
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionUserProvider);
    if (user == null) return const Scaffold(body: SizedBox.shrink());
    final l10n = context.l10n;
    final destinations = RoleExperience.destinationsFor(user);
    final selected = destinations.indexWhere(
      (d) => location == d.path || location.startsWith('${d.path}/'),
    );
    final width = MediaQuery.sizeOf(context).width;

    if (width < Breakpoints.compact) {
      final primary = destinations.take(RoleExperience.primaryCount).toList();
      final overflow = destinations.skip(RoleExperience.primaryCount).toList();
      final selectedPrimary = selected >= 0 && selected < primary.length
          ? selected
          : primary.length; // "More" highlighted for overflow routes
      return Scaffold(
        body: child,
        bottomNavigationBar: NavigationBar(
          selectedIndex: selectedPrimary.clamp(0, primary.length),
          onDestinationSelected: (i) {
            if (i < primary.length) {
              context.go(primary[i].path);
            } else {
              _showMore(context, overflow, user.role.isStaff);
            }
          },
          destinations: [
            for (final d in primary)
              NavigationDestination(
                icon: Icon(d.icon),
                selectedIcon: Icon(d.selectedIcon),
                label: d.label(l10n, user),
              ),
            NavigationDestination(
              icon: const Icon(Icons.menu),
              label: l10n.navMore,
            ),
          ],
        ),
      );
    }

    final extended = width >= Breakpoints.expanded;
    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            extended: extended,
            minExtendedWidth: 240,
            selectedIndex: selected < 0 ? null : selected,
            labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.symmetric(vertical: Insets.lg),
              child: extended
                  ? Row(
                      children: [
                        const BrandMark(size: 36),
                        const SizedBox(width: Insets.sm),
                        Text(l10n.appName, style: Theme.of(context).textTheme.titleMedium),
                      ],
                    )
                  : const BrandMark(size: 36),
            ),
            onDestinationSelected: (i) => context.go(destinations[i].path),
            destinations: [
              for (final d in destinations)
                NavigationRailDestination(
                  icon: Icon(d.icon),
                  selectedIcon: Icon(d.selectedIcon),
                  label: Text(d.label(l10n, user)),
                ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: child),
        ],
      ),
    );
  }

  void _showMore(
    BuildContext context,
    List<NavDestinationSpec> overflow,
    bool isStaff,
  ) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => Consumer(
        builder: (context, ref, _) {
          final user = ref.watch(sessionUserProvider);
          if (user == null) return const SizedBox.shrink();
          return SafeArea(
            child: ListView(
              shrinkWrap: true,
              children: [
                ListTile(
                  leading: const BrandMark(size: 32),
                  title: Text(user.fullName),
                  subtitle: Text(context.l10n.role(user.role)),
                ),
                const Divider(),
                for (final d in overflow)
                  ListTile(
                    leading: Icon(d.icon),
                    title: Text(d.label(context.l10n, user)),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      context.go(d.path);
                    },
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Standard app-bar actions: notifications bell with unread badge.
class ShellActions extends ConsumerWidget {
  const ShellActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadCountProvider);
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: Insets.sm),
      child: IconButton(
        tooltip: context.l10n.navNotifications,
        onPressed: () => context.push(Routes.notifications),
        icon: Badge(
          isLabelVisible: unread > 0,
          label: Text(context.fmt.number(unread)),
          child: const Icon(Icons.notifications_none_rounded),
        ),
      ),
    );
  }
}
