/// Coarse grouping that drives the *experience* a role gets: executives get a
/// data-dense dashboard, managers a department console, staff a task-first
/// mobile UI.
enum RoleTier { platform, executive, manager, staff }

/// Department a role belongs to. Used to scope manager dashboards and to
/// target notifications.
enum Department {
  management,
  frontOffice,
  housekeeping,
  maintenance,
  energy,
  foodAndBeverage,
  inventory,
  humanResources,
  analytics,
}

/// All roles supported by the platform. The [code] is the value stored in
/// Firebase custom claims (`role`) and in `users/{uid}.role`.
enum AppRole {
  superAdmin('superAdmin', RoleTier.platform, Department.management),
  hotelOwner('hotelOwner', RoleTier.executive, Department.management),
  generalManager('generalManager', RoleTier.executive, Department.management),
  operationsManager(
    'operationsManager',
    RoleTier.manager,
    Department.management,
  ),
  energyManager('energyManager', RoleTier.manager, Department.energy),
  maintenanceManager(
    'maintenanceManager',
    RoleTier.manager,
    Department.maintenance,
  ),
  housekeepingManager(
    'housekeepingManager',
    RoleTier.manager,
    Department.housekeeping,
  ),
  restaurantManager(
    'restaurantManager',
    RoleTier.manager,
    Department.foodAndBeverage,
  ),
  inventoryManager('inventoryManager', RoleTier.manager, Department.inventory),
  hrManager('hrManager', RoleTier.manager, Department.humanResources),
  receptionStaff('receptionStaff', RoleTier.staff, Department.frontOffice),
  housekeepingStaff(
    'housekeepingStaff',
    RoleTier.staff,
    Department.housekeeping,
  ),
  maintenanceStaff('maintenanceStaff', RoleTier.staff, Department.maintenance),
  restaurantStaff(
    'restaurantStaff',
    RoleTier.staff,
    Department.foodAndBeverage,
  ),
  analyst('analyst', RoleTier.executive, Department.analytics);

  const AppRole(this.code, this.tier, this.department);

  final String code;
  final RoleTier tier;
  final Department department;

  bool get isStaff => tier == RoleTier.staff;
  bool get isExecutive =>
      tier == RoleTier.executive || tier == RoleTier.platform;

  static AppRole? fromCode(String? code) {
    if (code == null) return null;
    for (final r in values) {
      if (r.code == code) return r;
    }
    return null;
  }
}
