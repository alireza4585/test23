import '../../features/ai/domain/ai_models.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/reports/domain/report_models.dart';
import '../../features/rooms/domain/room.dart';
import '../../features/staff/domain/staff.dart';
import '../error/app_failure.dart';
import '../security/app_role.dart';
import 'l10n.dart';

/// Localized labels for domain enums, kept out of the domain layer.
extension EnumLabels on AppLocalizations {
  String role(AppRole r) => switch (r) {
    AppRole.superAdmin => roleSuperAdmin,
    AppRole.hotelOwner => roleHotelOwner,
    AppRole.generalManager => roleGeneralManager,
    AppRole.operationsManager => roleOperationsManager,
    AppRole.energyManager => roleEnergyManager,
    AppRole.maintenanceManager => roleMaintenanceManager,
    AppRole.housekeepingManager => roleHousekeepingManager,
    AppRole.restaurantManager => roleRestaurantManager,
    AppRole.inventoryManager => roleInventoryManager,
    AppRole.hrManager => roleHrManager,
    AppRole.receptionStaff => roleReceptionStaff,
    AppRole.housekeepingStaff => roleHousekeepingStaff,
    AppRole.maintenanceStaff => roleMaintenanceStaff,
    AppRole.restaurantStaff => roleRestaurantStaff,
    AppRole.analyst => roleAnalyst,
  };

  String department(Department d) => switch (d) {
    Department.management => deptManagement,
    Department.frontOffice => deptFrontOffice,
    Department.housekeeping => deptHousekeeping,
    Department.maintenance => deptMaintenance,
    Department.energy => deptEnergy,
    Department.foodAndBeverage => deptFoodAndBeverage,
    Department.inventory => deptInventory,
    Department.humanResources => deptHumanResources,
    Department.analytics => deptAnalytics,
  };

  String roomStatus(RoomStatus s) => switch (s) {
    RoomStatus.vacantClean => roomStatusVacantClean,
    RoomStatus.vacantDirty => roomStatusVacantDirty,
    RoomStatus.cleaningInProgress => roomStatusCleaningInProgress,
    RoomStatus.occupied => roomStatusOccupied,
    RoomStatus.outOfOrder => roomStatusOutOfOrder,
  };

  String roomType(RoomType t) => switch (t) {
    RoomType.single => roomTypeSingle,
    RoomType.double => roomTypeDouble,
    RoomType.twin => roomTypeTwin,
    RoomType.suite => roomTypeSuite,
    RoomType.deluxe => roomTypeDeluxe,
  };

  String taskType(HousekeepingTaskType t) => switch (t) {
    HousekeepingTaskType.checkoutClean => taskTypeCheckoutClean,
    HousekeepingTaskType.stayoverClean => taskTypeStayoverClean,
    HousekeepingTaskType.deepClean => taskTypeDeepClean,
    HousekeepingTaskType.inspection => taskTypeInspection,
    HousekeepingTaskType.turndown => taskTypeTurndown,
  };

  String taskStatus(TaskStatus s) => switch (s) {
    TaskStatus.pending => taskStatusPending,
    TaskStatus.inProgress => taskStatusInProgress,
    TaskStatus.done => taskStatusDone,
    TaskStatus.cancelled => taskStatusCancelled,
  };

  String taskPriority(TaskPriority p) => switch (p) {
    TaskPriority.low => priorityLow,
    TaskPriority.normal => priorityNormal,
    TaskPriority.high => priorityHigh,
    TaskPriority.urgent => priorityUrgent,
  };

  String ticketCategory(TicketCategory c) => switch (c) {
    TicketCategory.hvac => catHvac,
    TicketCategory.electrical => catElectrical,
    TicketCategory.plumbing => catPlumbing,
    TicketCategory.furniture => catFurniture,
    TicketCategory.appliance => catAppliance,
    TicketCategory.itNetwork => catItNetwork,
    TicketCategory.structural => catStructural,
    TicketCategory.other => catOther,
  };

  String ticketPriority(TicketPriority p) => switch (p) {
    TicketPriority.low => tPriorityLow,
    TicketPriority.medium => tPriorityMedium,
    TicketPriority.high => tPriorityHigh,
    TicketPriority.critical => tPriorityCritical,
  };

  String ticketStatus(TicketStatus s) => switch (s) {
    TicketStatus.open => tStatusOpen,
    TicketStatus.assigned => tStatusAssigned,
    TicketStatus.inProgress => tStatusInProgress,
    TicketStatus.onHold => tStatusOnHold,
    TicketStatus.resolved => tStatusResolved,
    TicketStatus.closed => tStatusClosed,
    TicketStatus.cancelled => tStatusCancelled,
  };

  String energyType(EnergyType t) => switch (t) {
    EnergyType.electricity => energyElectricity,
    EnergyType.water => energyWater,
    EnergyType.gas => energyGas,
  };

  String inventoryCategory(InventoryCategory c) => switch (c) {
    InventoryCategory.guestAmenities => invCatGuestAmenities,
    InventoryCategory.linen => invCatLinen,
    InventoryCategory.cleaningSupplies => invCatCleaningSupplies,
    InventoryCategory.foodAndBeverage => invCatFoodAndBeverage,
    InventoryCategory.maintenanceParts => invCatMaintenanceParts,
    InventoryCategory.office => invCatOffice,
    InventoryCategory.other => invCatOther,
  };

  String movementType(MovementType t) => switch (t) {
    MovementType.receive => mvReceive,
    MovementType.issue => mvIssue,
    MovementType.adjust => mvAdjust,
    MovementType.waste => mvWaste,
  };

  String shiftType(ShiftType t) => switch (t) {
    ShiftType.morning => shiftMorning,
    ShiftType.evening => shiftEvening,
    ShiftType.night => shiftNight,
  };

  String shiftStatus(ShiftStatus s) => switch (s) {
    ShiftStatus.scheduled => shiftScheduled,
    ShiftStatus.checkedIn => shiftCheckedIn,
    ShiftStatus.completed => shiftCompleted,
    ShiftStatus.absent => shiftAbsent,
  };

  String severity(AlertSeverity s) => switch (s) {
    AlertSeverity.info => severityInfo,
    AlertSeverity.warning => severityWarning,
    AlertSeverity.critical => severityCritical,
  };

  String insightCategory(InsightCategory c) => switch (c) {
    InsightCategory.energy => insCatEnergy,
    InsightCategory.maintenance => insCatMaintenance,
    InsightCategory.housekeeping => insCatHousekeeping,
    InsightCategory.inventory => insCatInventory,
    InsightCategory.revenue => insCatRevenue,
    InsightCategory.staffing => insCatStaffing,
  };

  String reportType(ReportType t) => switch (t) {
    ReportType.executiveSummary => reportExecutive,
    ReportType.energy => reportEnergy,
    ReportType.maintenance => reportMaintenance,
    ReportType.housekeeping => reportHousekeeping,
    ReportType.inventory => reportInventory,
  };

  String userStatus(UserStatus s) => switch (s) {
    UserStatus.active => userStatusActive,
    UserStatus.suspended => userStatusSuspended,
    UserStatus.disabled => userStatusDisabled,
  };

  /// User-facing message for any failure raised by repositories / use cases.
  String failure(Object error) {
    return switch (error) {
      InvalidCredentialsFailure() => errorInvalidCredentials,
      AccountDisabledFailure() => errorAccountDisabled,
      AccountNotProvisionedFailure() => errorNotProvisioned,
      TooManyRequestsFailure() => errorTooManyRequests,
      PermissionDeniedFailure() => errorPermission,
      NotFoundFailure() => errorNotFound,
      NetworkFailure() => errorNetwork,
      SessionExpiredFailure() => errorSessionExpired,
      UnsupportedFailure() => errorUnsupported,
      ValidationFailure(:final code) => switch (code) {
        'room_status_changed' => errorRoomStatusChanged,
        'insufficient_stock' => errorInsufficientStock,
        'occupied_exceeds_available' => errorOccupiedExceeds,
        'national_id_exists' => errorNationalIdExists,
        'invalid_national_id' => nationalIdInvalid,
        'task_status_changed' ||
        'task_not_pending' ||
        'task_not_in_progress' ||
        'ticket_status_changed' => errorTaskChanged,
        _ => errorValidation,
      },
      _ => errorGeneric,
    };
  }
}
