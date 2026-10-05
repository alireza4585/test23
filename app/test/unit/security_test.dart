import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_permission.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/core/security/role_policy.dart';
import 'package:zarin_hooshmand/core/utils/iran_national_id.dart';
import 'package:zarin_hooshmand/features/auth/domain/app_user.dart';

import '../helpers/test_app.dart';

class _View implements AppUserView {
  _View(this.user);

  final AppUser user;

  @override
  bool get mustChangePassword => user.mustChangePassword;

  @override
  bool canOpen(String location) => RouteAccess.canAccess(user, location);
}

void main() {
  group('IranNationalId', () {
    test('accepts valid checksums and Persian digits', () {
      expect(IranNationalId.isValid('0012345679'), isTrue);
      expect(IranNationalId.isValid('۰۰۱۲۳۴۵۶۷۹'), isTrue);
      expect(IranNationalId.isValid('001-234567-9'), isTrue);
    });

    test('rejects bad checksums, wrong length and repeated digits', () {
      expect(IranNationalId.isValid('0012345678'), isFalse);
      expect(IranNationalId.isValid('12345'), isFalse);
      expect(IranNationalId.isValid('1111111111'), isFalse);
    });

    test('masks the middle digits', () {
      expect(IranNationalId.mask('0012345679'), '001•••••79');
    });
  });

  group('RolePolicy', () {
    test('every role has a template', () {
      for (final role in AppRole.values) {
        expect(RolePolicy.defaults[role], isNotNull, reason: role.code);
      }
    });

    test('front-line staff never get executive or admin capabilities', () {
      for (final role in AppRole.values.where((r) => r.isStaff)) {
        final p = RolePolicy.resolve(role);
        expect(p.contains(AppPermission.dashboardExecutive), isFalse, reason: role.code);
        expect(p.contains(AppPermission.usersManage), isFalse, reason: role.code);
        expect(p.contains(AppPermission.financeView), isFalse, reason: role.code);
        expect(p.contains(AppPermission.maintenanceReport), isTrue, reason: role.code);
      }
    });

    test('templates can only narrow permissions', () {
      final narrowed = RolePolicy.resolve(
        AppRole.housekeepingStaff,
        templateOverride: {AppPermission.roomsView, AppPermission.usersManage},
      );
      expect(narrowed, {AppPermission.roomsView});
    });

    test('no role can assign a role above its own (privilege escalation)', () {
      expect(RolePolicy.assignableBy(AppRole.hrManager), isNot(contains(AppRole.generalManager)));
      expect(RolePolicy.assignableBy(AppRole.generalManager), isNot(contains(AppRole.hotelOwner)));
      expect(RolePolicy.assignableBy(AppRole.generalManager), isNot(contains(AppRole.superAdmin)));
      expect(RolePolicy.assignableBy(AppRole.housekeepingStaff), isEmpty);
    });
  });

  group('Route guard', () {
    const loaded = AsyncData<Object?>(null);

    test('signed-out users are sent to login', () {
      expect(authRedirect(loaded, null, Routes.home), Routes.login);
      expect(authRedirect(loaded, null, Routes.login), isNull);
    });

    test('while auth resolves the splash is shown', () {
      expect(authRedirect(const AsyncLoading(), null, Routes.home), Routes.splash);
    });

    test('roles are denied routes outside their permissions', () {
      final hk = _View(userWith(AppRole.housekeepingStaff));
      expect(authRedirect(loaded, hk, Routes.energy), Routes.accessDenied);
      expect(authRedirect(loaded, hk, Routes.users), Routes.accessDenied);
      expect(authRedirect(loaded, hk, Routes.housekeepingNew), Routes.accessDenied);
      expect(authRedirect(loaded, hk, Routes.housekeeping), isNull);
      expect(authRedirect(loaded, hk, Routes.maintenanceNew), isNull);

      final gm = _View(userWith(AppRole.generalManager));
      expect(authRedirect(loaded, gm, Routes.energy), isNull);
      expect(authRedirect(loaded, gm, Routes.users), isNull);
      expect(authRedirect(loaded, gm, Routes.login), Routes.home);
    });

    test('temporary passwords force the change-password screen', () {
      final user = userWith(AppRole.receptionStaff, mustChangePassword: true);
      expect(authRedirect(loaded, _View(user), Routes.rooms), Routes.changePassword);
    });
  });
}
