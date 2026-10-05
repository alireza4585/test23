import 'package:flutter/material.dart';

import '../../features/auth/domain/app_user.dart';
import '../l10n/l10n.dart';
import '../security/app_role.dart';
import 'routes.dart';

enum NavItem {
  home,
  rooms,
  housekeeping,
  maintenance,
  energy,
  inventory,
  staff,
  dailyOps,
  reports,
  insights,
  assistant,
  users,
  profile,
}

class NavDestinationSpec {
  const NavDestinationSpec({
    required this.item,
    required this.path,
    required this.icon,
    required this.selectedIcon,
  });

  final NavItem item;
  final String path;
  final IconData icon;
  final IconData selectedIcon;

  String label(AppLocalizations l10n, AppUser user) => switch (item) {
    NavItem.home => user.role.isStaff ? l10n.navMyWork : l10n.navDashboard,
    NavItem.rooms => l10n.navRooms,
    NavItem.housekeeping => l10n.navHousekeeping,
    NavItem.maintenance => l10n.navMaintenance,
    NavItem.energy => l10n.navEnergy,
    NavItem.inventory => l10n.navInventory,
    NavItem.staff => l10n.navStaff,
    NavItem.dailyOps => l10n.navDailyOps,
    NavItem.reports => l10n.navReports,
    NavItem.insights => l10n.navInsights,
    NavItem.assistant => l10n.navAssistant,
    NavItem.users => l10n.navUsers,
    NavItem.profile => l10n.navProfile,
  };
}

/// Role-specific navigation. Destinations are filtered by permission
/// (via [RouteAccess]) and *ordered* by what each role does most, so a
/// housekeeper's bottom bar is "My work · Housekeeping · Rooms · Report",
/// while a GM sees "Dashboard · Rooms · Maintenance · Energy".
abstract final class RoleExperience {
  static const all = <NavDestinationSpec>[
    NavDestinationSpec(item: NavItem.home, path: Routes.home, icon: Icons.space_dashboard_outlined, selectedIcon: Icons.space_dashboard),
    NavDestinationSpec(item: NavItem.rooms, path: Routes.rooms, icon: Icons.meeting_room_outlined, selectedIcon: Icons.meeting_room),
    NavDestinationSpec(item: NavItem.housekeeping, path: Routes.housekeeping, icon: Icons.cleaning_services_outlined, selectedIcon: Icons.cleaning_services),
    NavDestinationSpec(item: NavItem.maintenance, path: Routes.maintenance, icon: Icons.handyman_outlined, selectedIcon: Icons.handyman),
    NavDestinationSpec(item: NavItem.energy, path: Routes.energy, icon: Icons.bolt_outlined, selectedIcon: Icons.bolt),
    NavDestinationSpec(item: NavItem.inventory, path: Routes.inventory, icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
    NavDestinationSpec(item: NavItem.staff, path: Routes.staff, icon: Icons.badge_outlined, selectedIcon: Icons.badge),
    NavDestinationSpec(item: NavItem.dailyOps, path: Routes.dailyOps, icon: Icons.edit_calendar_outlined, selectedIcon: Icons.edit_calendar),
    NavDestinationSpec(item: NavItem.reports, path: Routes.reports, icon: Icons.description_outlined, selectedIcon: Icons.description),
    NavDestinationSpec(item: NavItem.insights, path: Routes.insights, icon: Icons.auto_awesome_outlined, selectedIcon: Icons.auto_awesome),
    NavDestinationSpec(item: NavItem.assistant, path: Routes.assistant, icon: Icons.forum_outlined, selectedIcon: Icons.forum),
    NavDestinationSpec(item: NavItem.users, path: Routes.users, icon: Icons.admin_panel_settings_outlined, selectedIcon: Icons.admin_panel_settings),
    NavDestinationSpec(item: NavItem.profile, path: Routes.profile, icon: Icons.person_outline, selectedIcon: Icons.person),
  ];

  static const Map<AppRole, List<NavItem>> _priority = {
    AppRole.superAdmin: [NavItem.home, NavItem.users, NavItem.insights, NavItem.reports],
    AppRole.hotelOwner: [NavItem.home, NavItem.insights, NavItem.reports, NavItem.energy],
    AppRole.generalManager: [NavItem.home, NavItem.rooms, NavItem.maintenance, NavItem.energy],
    AppRole.analyst: [NavItem.home, NavItem.reports, NavItem.energy, NavItem.assistant],
    AppRole.operationsManager: [NavItem.home, NavItem.rooms, NavItem.housekeeping, NavItem.maintenance],
    AppRole.energyManager: [NavItem.home, NavItem.energy, NavItem.maintenance, NavItem.insights],
    AppRole.maintenanceManager: [NavItem.home, NavItem.maintenance, NavItem.rooms, NavItem.inventory],
    AppRole.housekeepingManager: [NavItem.home, NavItem.housekeeping, NavItem.rooms, NavItem.inventory],
    AppRole.restaurantManager: [NavItem.home, NavItem.inventory, NavItem.staff, NavItem.maintenance],
    AppRole.inventoryManager: [NavItem.home, NavItem.inventory, NavItem.reports, NavItem.maintenance],
    AppRole.hrManager: [NavItem.home, NavItem.staff, NavItem.users, NavItem.reports],
    AppRole.receptionStaff: [NavItem.home, NavItem.rooms, NavItem.dailyOps, NavItem.maintenance],
    AppRole.housekeepingStaff: [NavItem.home, NavItem.housekeeping, NavItem.rooms, NavItem.maintenance],
    AppRole.maintenanceStaff: [NavItem.home, NavItem.maintenance, NavItem.rooms, NavItem.staff],
    AppRole.restaurantStaff: [NavItem.home, NavItem.maintenance, NavItem.inventory, NavItem.staff],
  };

  /// All destinations the user may open, in role priority order.
  static List<NavDestinationSpec> destinationsFor(AppUser user) {
    final allowed = all
        .where((d) => d.item == NavItem.home || d.item == NavItem.profile || RouteAccess.canAccess(user, d.path))
        .toList();
    final order = _priority[user.role] ?? const <NavItem>[];
    int rank(NavDestinationSpec d) {
      final i = order.indexOf(d.item);
      return i == -1 ? order.length + d.item.index : i;
    }

    return allowed..sort((a, b) => rank(a).compareTo(rank(b)));
  }

  /// Bottom-bar destinations on phones (the rest live under "More").
  static const primaryCount = 4;
}
