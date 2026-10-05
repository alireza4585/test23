import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../auth/application/auth_providers.dart';
import 'executive_dashboard.dart';
import 'operations_dashboard.dart';
import 'staff_home.dart';

/// `/home` renders a different experience per role tier:
/// * executives (owner, GM, analyst, super admin) → data-dense dashboard;
/// * department managers → department console;
/// * front-line staff → task-first "My work" screen.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionUserProvider);
    if (user == null) return const SizedBox.shrink();
    if (user.role.tier == RoleTier.staff) return const StaffHome();
    if (user.can(AppPermission.dashboardExecutive)) {
      return const ExecutiveDashboard();
    }
    return const OperationsDashboard();
  }
}
