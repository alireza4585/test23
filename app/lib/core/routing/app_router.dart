import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/admin/presentation/users_pages.dart';
import '../../features/ai/presentation/ai_pages.dart';
import '../../features/auth/application/auth_providers.dart';
import '../../features/auth/presentation/auth_misc_pages.dart';
import '../../features/auth/presentation/login_page.dart';
import '../../features/dashboard/presentation/home_page.dart';
import '../../features/energy/presentation/energy_page.dart';
import '../../features/housekeeping/presentation/housekeeping_pages.dart';
import '../../features/inventory/presentation/inventory_pages.dart';
import '../../features/maintenance/presentation/maintenance_pages.dart';
import '../../features/notifications/presentation/notifications_page.dart';
import '../../features/operations/presentation/daily_ops_page.dart';
import '../../features/profile/presentation/profile_page.dart';
import '../../features/reports/presentation/reports_page.dart';
import '../../features/rooms/presentation/rooms_pages.dart';
import '../../features/staff/presentation/staff_page.dart';
import '../widgets/app_shell.dart';
import 'routes.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final _shellKey = GlobalKey<NavigatorState>(debugLabel: 'shell');

/// Guard pipeline (evaluated on every navigation and whenever auth changes):
/// 1. auth still resolving        → /splash
/// 2. signed out                  → /login
/// 3. temporary password          → /change-password
/// 4. signed in on a public page  → /home
/// 5. route not allowed for role  → /access-denied
///
/// Deep links (push notification taps, alert routes) go through the same
/// guard, so a forged or stale link can never open a screen the role lacks.
String? authRedirect(AsyncValue<Object?> auth, AppUserView? user, String location) {
  if (auth.isLoading && !auth.hasValue) {
    return location == Routes.splash ? null : Routes.splash;
  }
  if (user == null) {
    return location == Routes.login ? null : Routes.login;
  }
  if (user.mustChangePassword && location != Routes.changePassword) {
    return Routes.changePassword;
  }
  if (Routes.public.contains(location)) return Routes.home;
  if (location == Routes.accessDenied ||
      location == Routes.changePassword ||
      location == Routes.home ||
      location == Routes.profile) {
    return null;
  }
  return user.canOpen(location) ? null : Routes.accessDenied;
}

/// Narrow view of the user used by [authRedirect] (keeps it unit-testable).
abstract interface class AppUserView {
  bool get mustChangePassword;
  bool canOpen(String location);
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(currentUserProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  NoTransitionPage<void> tab(Widget child, GoRouterState state) =>
      NoTransitionPage(key: state.pageKey, child: child);

  final router = GoRouter(
    navigatorKey: _rootKey,
    initialLocation: Routes.splash,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(currentUserProvider);
      final user = auth.value;
      return authRedirect(
        auth,
        user == null ? null : _UserView(user.mustChangePassword, (loc) => RouteAccess.canAccess(user, loc)),
        state.matchedLocation,
      );
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (_, _) => const SplashPage()),
      GoRoute(path: Routes.login, builder: (_, _) => const LoginPage()),
      GoRoute(path: Routes.changePassword, builder: (_, _) => const ChangePasswordPage()),
      GoRoute(path: Routes.accessDenied, builder: (_, _) => const AccessDeniedPage()),
      GoRoute(
        path: Routes.notifications,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const NotificationsPage(),
      ),
      GoRoute(
        path: Routes.assistant,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const AssistantPage(),
      ),
      ShellRoute(
        navigatorKey: _shellKey,
        builder: (context, state, child) => AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: Routes.home, pageBuilder: (_, s) => tab(const HomePage(), s)),
          GoRoute(
            path: Routes.rooms,
            pageBuilder: (_, s) => tab(const RoomsPage(), s),
            routes: [
              GoRoute(
                path: ':roomId',
                builder: (_, s) => RoomDetailPage(roomId: s.pathParameters['roomId']!),
              ),
            ],
          ),
          GoRoute(
            path: Routes.housekeeping,
            pageBuilder: (_, s) => tab(const HousekeepingPage(), s),
            routes: [
              GoRoute(path: 'new', builder: (_, _) => const NewTaskPage()),
              GoRoute(
                path: 'tasks/:taskId',
                builder: (_, s) => TaskDetailPage(taskId: s.pathParameters['taskId']!),
              ),
            ],
          ),
          GoRoute(
            path: Routes.maintenance,
            pageBuilder: (_, s) => tab(const MaintenancePage(), s),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, s) => NewTicketPage(roomId: s.uri.queryParameters['roomId']),
              ),
              GoRoute(
                path: ':ticketId',
                builder: (_, s) => TicketDetailPage(ticketId: s.pathParameters['ticketId']!),
              ),
            ],
          ),
          GoRoute(path: Routes.energy, pageBuilder: (_, s) => tab(const EnergyPage(), s)),
          GoRoute(
            path: Routes.inventory,
            pageBuilder: (_, s) => tab(const InventoryPage(), s),
            routes: [
              GoRoute(path: 'new', builder: (_, _) => const NewInventoryItemPage()),
              GoRoute(
                path: ':itemId',
                builder: (_, s) => InventoryItemPage(itemId: s.pathParameters['itemId']!),
              ),
            ],
          ),
          GoRoute(path: Routes.staff, pageBuilder: (_, s) => tab(const StaffPage(), s)),
          GoRoute(path: Routes.dailyOps, pageBuilder: (_, s) => tab(const DailyOpsPage(), s)),
          GoRoute(path: Routes.reports, pageBuilder: (_, s) => tab(const ReportsPage(), s)),
          GoRoute(path: Routes.insights, pageBuilder: (_, s) => tab(const InsightsPage(), s)),
          GoRoute(
            path: Routes.users,
            pageBuilder: (_, s) => tab(const UsersPage(), s),
            routes: [GoRoute(path: 'new', builder: (_, _) => const NewUserPage())],
          ),
          GoRoute(path: Routes.profile, pageBuilder: (_, s) => tab(const ProfilePage(), s)),
        ],
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

class _UserView implements AppUserView {
  _UserView(this.mustChangePassword, this._canOpen);

  @override
  final bool mustChangePassword;
  final bool Function(String) _canOpen;

  @override
  bool canOpen(String location) => _canOpen(location);
}
