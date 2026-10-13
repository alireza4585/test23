// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Zarin Hooshmand';

  @override
  String get appTagline => 'Smart Optimization Platform for Hospitality';

  @override
  String get demoBadge => 'Demo';

  @override
  String get retry => 'Retry';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get confirm => 'Confirm';

  @override
  String get close => 'Close';

  @override
  String get seeAll => 'See all';

  @override
  String get more => 'More';

  @override
  String get search => 'Search';

  @override
  String get filterAll => 'All';

  @override
  String get today => 'Today';

  @override
  String get yesterday => 'Yesterday';

  @override
  String get tomorrow => 'Tomorrow';

  @override
  String get justNow => 'Just now';

  @override
  String minutesAgo(String n) {
    return '$n min ago';
  }

  @override
  String hoursAgo(String n) {
    return '$n h ago';
  }

  @override
  String daysAgo(String n) {
    return '$n d ago';
  }

  @override
  String minutesValue(String n) {
    return '$n min';
  }

  @override
  String get currencyRial => 'IRR';

  @override
  String get optional => 'Optional';

  @override
  String get requiredField => 'This field is required';

  @override
  String get invalidNumber => 'Enter a valid number';

  @override
  String get savedSuccessfully => 'Saved successfully';

  @override
  String get signOut => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of your account?';

  @override
  String get errorGeneric => 'Something went wrong. Please try again.';

  @override
  String get errorNetwork => 'Can\'t reach the server. Check your connection.';

  @override
  String get errorPermission => 'You don\'t have permission to do this.';

  @override
  String get errorNotFound => 'The requested item was not found.';

  @override
  String get errorSessionExpired =>
      'Your session expired. Please sign in again.';

  @override
  String get errorUnsupported =>
      'This feature isn\'t available in this edition.';

  @override
  String get errorValidation => 'The submitted data is invalid.';

  @override
  String get errorRoomStatusChanged =>
      'The room status was changed by someone else.';

  @override
  String get errorInsufficientStock => 'Insufficient stock.';

  @override
  String get errorOccupiedExceeds => 'Occupied rooms exceed available rooms.';

  @override
  String get errorNationalIdExists =>
      'A user with this national ID already exists.';

  @override
  String get errorTaskChanged => 'This task was changed meanwhile.';

  @override
  String get emptyGeneric => 'Nothing to show yet.';

  @override
  String get loginTitle => 'Sign in';

  @override
  String get loginSubtitle =>
      'Use the national ID and password issued by your administrator.';

  @override
  String get nationalIdLabel => 'National ID';

  @override
  String get nationalIdHint => '10 digits';

  @override
  String get nationalIdInvalid => 'Invalid national ID';

  @override
  String get passwordLabel => 'Password';

  @override
  String get passwordRequired => 'Enter your password';

  @override
  String get loginButton => 'Sign in';

  @override
  String get showPassword => 'Show password';

  @override
  String get hidePassword => 'Hide password';

  @override
  String get errorInvalidCredentials => 'Incorrect national ID or password.';

  @override
  String get errorAccountDisabled =>
      'Your account is disabled. Contact your administrator.';

  @override
  String get errorNotProvisioned =>
      'Your account has no role or hotel assigned yet.';

  @override
  String get errorTooManyRequests =>
      'Too many attempts. Try again in a few minutes.';

  @override
  String get forgotPasswordHint =>
      'To reset your password, contact your hotel administrator.';

  @override
  String get demoAccountsTitle => 'Quick sign-in with a demo account';

  @override
  String get demoAccountsHint =>
      'Each role gets its own dashboard and permissions.';

  @override
  String demoPasswordNote(String password) {
    return 'Password for all accounts: $password';
  }

  @override
  String get loginFooter =>
      'Access is enforced server-side based on each user\'s role.';

  @override
  String get changePasswordTitle => 'Change password';

  @override
  String get mustChangePasswordInfo =>
      'For security, please replace your temporary password.';

  @override
  String get currentPassword => 'Current password';

  @override
  String get newPassword => 'New password';

  @override
  String get confirmPassword => 'Confirm new password';

  @override
  String get passwordTooWeak => 'At least 8 characters with letters and digits';

  @override
  String get passwordsDontMatch => 'Passwords don\'t match';

  @override
  String get passwordChanged => 'Password changed';

  @override
  String get accessDeniedTitle => 'Access denied';

  @override
  String get accessDeniedBody =>
      'This area isn\'t available for your role. Ask your manager if you need access.';

  @override
  String get goHome => 'Go home';

  @override
  String get sessionTimedOut => 'You were signed out due to inactivity.';

  @override
  String get navHome => 'Home';

  @override
  String get navDashboard => 'Dashboard';

  @override
  String get navMyWork => 'My work';

  @override
  String get navRooms => 'Rooms';

  @override
  String get navHousekeeping => 'Housekeeping';

  @override
  String get navMaintenance => 'Maintenance';

  @override
  String get navEnergy => 'Energy';

  @override
  String get navInventory => 'Inventory';

  @override
  String get navStaff => 'Staff';

  @override
  String get navReports => 'Reports';

  @override
  String get navNotifications => 'Notifications';

  @override
  String get navInsights => 'Recommendations';

  @override
  String get navAssistant => 'AI assistant';

  @override
  String get navUsers => 'Users';

  @override
  String get navProfile => 'Profile';

  @override
  String get navDailyOps => 'Daily figures';

  @override
  String get navMore => 'More';

  @override
  String get roleSuperAdmin => 'Super admin';

  @override
  String get roleHotelOwner => 'Hotel owner';

  @override
  String get roleGeneralManager => 'General manager';

  @override
  String get roleOperationsManager => 'Operations manager';

  @override
  String get roleEnergyManager => 'Energy manager';

  @override
  String get roleMaintenanceManager => 'Maintenance manager';

  @override
  String get roleHousekeepingManager => 'Housekeeping manager';

  @override
  String get roleRestaurantManager => 'Restaurant manager';

  @override
  String get roleInventoryManager => 'Inventory manager';

  @override
  String get roleHrManager => 'HR manager';

  @override
  String get roleReceptionStaff => 'Reception staff';

  @override
  String get roleHousekeepingStaff => 'Housekeeping staff';

  @override
  String get roleMaintenanceStaff => 'Maintenance technician';

  @override
  String get roleRestaurantStaff => 'Restaurant staff';

  @override
  String get roleAnalyst => 'Analyst';

  @override
  String get deptManagement => 'Management';

  @override
  String get deptFrontOffice => 'Front office';

  @override
  String get deptHousekeeping => 'Housekeeping';

  @override
  String get deptMaintenance => 'Maintenance';

  @override
  String get deptEnergy => 'Energy';

  @override
  String get deptFoodAndBeverage => 'Food & beverage';

  @override
  String get deptInventory => 'Inventory';

  @override
  String get deptHumanResources => 'Human resources';

  @override
  String get deptAnalytics => 'Analytics';

  @override
  String greetingMorning(String name) {
    return 'Good morning, $name';
  }

  @override
  String greetingAfternoon(String name) {
    return 'Good afternoon, $name';
  }

  @override
  String greetingEvening(String name) {
    return 'Good evening, $name';
  }

  @override
  String dashboardSubtitle(String hotel) {
    return 'Live performance of $hotel';
  }

  @override
  String opsDashboardSubtitle(String department) {
    return '$department console';
  }

  @override
  String get kpiOccupancy => 'Occupancy';

  @override
  String get kpiAdr => 'ADR';

  @override
  String get kpiRevpar => 'RevPAR';

  @override
  String get kpiRevenue => 'Revenue (yesterday)';

  @override
  String get kpiElectricity => 'Electricity (yesterday)';

  @override
  String get kpiEnergyIntensity => 'Energy intensity';

  @override
  String get kpiEnergyIntensityUnit => 'kWh per occupied room';

  @override
  String get kpiOpenTickets => 'Open tickets';

  @override
  String kpiOverdueTickets(String n) {
    return '$n past SLA';
  }

  @override
  String get kpiRoomsReady => 'Rooms ready';

  @override
  String kpiRoomsToClean(String n) {
    return '$n to clean';
  }

  @override
  String get kpiStaffOnDuty => 'Staff on duty';

  @override
  String get kpiHousekeeping => 'Housekeeping progress';

  @override
  String get kpiLowStock => 'Items below reorder';

  @override
  String vsLastWeek(String value) {
    return '$value vs last week';
  }

  @override
  String vsBaselineShort(String value) {
    return '$value vs baseline';
  }

  @override
  String get sectionAlerts => 'Alerts';

  @override
  String get sectionInsights => 'AI insights';

  @override
  String get sectionRoomStatus => 'Room status';

  @override
  String get sectionOccupancyTrend => 'Occupancy — last 14 days';

  @override
  String get sectionEnergyTrend => 'Electricity — last 14 days';

  @override
  String get sectionRequests => 'Open maintenance requests';

  @override
  String get sectionToday => 'Today';

  @override
  String get noAlerts => 'No active alerts.';

  @override
  String get acknowledge => 'Acknowledge';

  @override
  String acknowledgedBy(String name) {
    return 'Acknowledged by $name';
  }

  @override
  String get baselineLegend => 'Baseline';

  @override
  String get myWorkTitle => 'My work';

  @override
  String myWorkProgress(String done, String total) {
    return '$done of $total tasks done today';
  }

  @override
  String shiftToday(String start, String end) {
    return 'Today\'s shift: $start–$end';
  }

  @override
  String get noShiftToday => 'No shift scheduled for you today.';

  @override
  String get quickActions => 'Quick actions';

  @override
  String get actionReportFault => 'Report a fault';

  @override
  String get actionRooms => 'Room board';

  @override
  String get actionMyTickets => 'My tickets';

  @override
  String get actionRecordDaily => 'Enter today\'s figures';

  @override
  String get allTasksDone => 'All of today\'s work is done. Great job!';

  @override
  String get nextTask => 'Next up';

  @override
  String get roomsTitle => 'Room board';

  @override
  String roomLabel(String number) {
    return 'Room $number';
  }

  @override
  String floorLabel(String n) {
    return 'Floor $n';
  }

  @override
  String get roomStatusVacantClean => 'Ready';

  @override
  String get roomStatusVacantDirty => 'Needs cleaning';

  @override
  String get roomStatusCleaningInProgress => 'Cleaning';

  @override
  String get roomStatusOccupied => 'Occupied';

  @override
  String get roomStatusOutOfOrder => 'Out of order';

  @override
  String get roomTypeSingle => 'Single';

  @override
  String get roomTypeDouble => 'Double';

  @override
  String get roomTypeTwin => 'Twin';

  @override
  String get roomTypeSuite => 'Suite';

  @override
  String get roomTypeDeluxe => 'Deluxe';

  @override
  String get changeStatus => 'Change status';

  @override
  String changeStatusTo(String status) {
    return 'Set to “$status”';
  }

  @override
  String get statusUpdated => 'Status updated';

  @override
  String get noAllowedTransitions =>
      'Your role can\'t change this room\'s status.';

  @override
  String lastUpdatedBy(String time, String name) {
    return 'Updated $time by $name';
  }

  @override
  String roomsCount(String n) {
    return '$n rooms';
  }

  @override
  String get reportFaultForRoom => 'Report a fault in this room';

  @override
  String get roomTasks => 'Today\'s housekeeping';

  @override
  String get hkTitle => 'Housekeeping';

  @override
  String get hkMyTasks => 'My tasks';

  @override
  String get hkAllTasks => 'All tasks';

  @override
  String get taskTypeCheckoutClean => 'Checkout clean';

  @override
  String get taskTypeStayoverClean => 'Stay-over clean';

  @override
  String get taskTypeDeepClean => 'Deep clean';

  @override
  String get taskTypeInspection => 'Inspection';

  @override
  String get taskTypeTurndown => 'Turndown';

  @override
  String get taskStatusPending => 'Pending';

  @override
  String get taskStatusInProgress => 'In progress';

  @override
  String get taskStatusDone => 'Done';

  @override
  String get taskStatusCancelled => 'Cancelled';

  @override
  String get priorityLow => 'Low';

  @override
  String get priorityNormal => 'Normal';

  @override
  String get priorityHigh => 'High';

  @override
  String get priorityUrgent => 'Urgent';

  @override
  String get startTask => 'Start';

  @override
  String get completeTask => 'Complete';

  @override
  String get taskStarted => 'Task started';

  @override
  String get taskCompleted => 'Task completed';

  @override
  String taskDuration(String minutes) {
    return 'Took $minutes min';
  }

  @override
  String taskElapsed(String minutes) {
    return 'Elapsed: $minutes min';
  }

  @override
  String taskTarget(String minutes) {
    return 'Target: $minutes min';
  }

  @override
  String dueBy(String time) {
    return 'Due $time';
  }

  @override
  String get assignee => 'Assignee';

  @override
  String get unassigned => 'Unassigned';

  @override
  String get newTask => 'New task';

  @override
  String get selectRoom => 'Select room';

  @override
  String get selectAssignee => 'Select assignee';

  @override
  String get taskTypeLabel => 'Task type';

  @override
  String get priorityLabel => 'Priority';

  @override
  String get notesLabel => 'Notes';

  @override
  String get createTask => 'Create task';

  @override
  String get taskCreated => 'Task created';

  @override
  String get noTasksToday => 'No tasks for today.';

  @override
  String get overdue => 'Overdue';

  @override
  String get completionNotesHint => 'Note for supervisor (optional)';

  @override
  String get mntTitle => 'Maintenance';

  @override
  String get mntNewTicket => 'Report a fault';

  @override
  String get ticketTitleLabel => 'What\'s broken?';

  @override
  String get ticketTitleHint => 'e.g. Room AC isn\'t cooling';

  @override
  String get ticketDescriptionLabel => 'Description';

  @override
  String get ticketCategoryLabel => 'Category';

  @override
  String get ticketLocationLabel => 'Location';

  @override
  String get locationRoom => 'Room';

  @override
  String get locationArea => 'Public area';

  @override
  String get areaHint => 'e.g. Lobby, kitchen, plant room';

  @override
  String get addPhoto => 'Add photo';

  @override
  String get takePhoto => 'Take photo';

  @override
  String get chooseFromGallery => 'Choose from gallery';

  @override
  String photosCount(String n) {
    return '$n photo(s) attached';
  }

  @override
  String get submitTicket => 'Submit';

  @override
  String get ticketCreated => 'Fault reported. Maintenance has been notified.';

  @override
  String get catHvac => 'HVAC';

  @override
  String get catElectrical => 'Electrical';

  @override
  String get catPlumbing => 'Plumbing';

  @override
  String get catFurniture => 'Furniture';

  @override
  String get catAppliance => 'Appliance';

  @override
  String get catItNetwork => 'IT & network';

  @override
  String get catStructural => 'Structural';

  @override
  String get catOther => 'Other';

  @override
  String get tPriorityLow => 'Low';

  @override
  String get tPriorityMedium => 'Medium';

  @override
  String get tPriorityHigh => 'High';

  @override
  String get tPriorityCritical => 'Critical';

  @override
  String get tStatusOpen => 'Open';

  @override
  String get tStatusAssigned => 'Assigned';

  @override
  String get tStatusInProgress => 'In progress';

  @override
  String get tStatusOnHold => 'On hold';

  @override
  String get tStatusResolved => 'Resolved';

  @override
  String get tStatusClosed => 'Closed';

  @override
  String get tStatusCancelled => 'Cancelled';

  @override
  String slaDue(String time) {
    return 'SLA due $time';
  }

  @override
  String get slaOverdue => 'Past SLA';

  @override
  String get assignTo => 'Assign technician';

  @override
  String get ticketAssigned => 'Ticket assigned';

  @override
  String reportedBy(String name) {
    return 'Reported by $name';
  }

  @override
  String get timeline => 'Timeline';

  @override
  String get eventCreated => 'Created';

  @override
  String eventAssigned(String name) {
    return 'Assigned to $name';
  }

  @override
  String eventStatus(String from, String to) {
    return '$from → $to';
  }

  @override
  String get eventComment => 'Comment';

  @override
  String get resolutionNoteHint => 'What was done?';

  @override
  String get tabActive => 'Active';

  @override
  String get tabMine => 'Mine';

  @override
  String get tabAll => 'All';

  @override
  String get noTickets => 'No tickets.';

  @override
  String get ticketStatusChanged => 'Ticket updated';

  @override
  String get energyTitle => 'Energy';

  @override
  String get energyElectricity => 'Electricity';

  @override
  String get energyWater => 'Water';

  @override
  String get energyGas => 'Gas';

  @override
  String get recordReading => 'Record daily usage';

  @override
  String consumptionLabel(String unit) {
    return 'Daily usage ($unit)';
  }

  @override
  String get meterValueLabel => 'Meter reading';

  @override
  String get dateLabel => 'Date';

  @override
  String get readingSaved => 'Reading saved';

  @override
  String get last30Days => 'Last 30 days';

  @override
  String get totalConsumption => 'Total';

  @override
  String get dailyAverage => 'Daily average';

  @override
  String get baseline => 'Baseline';

  @override
  String vsPreviousPeriod(String value) {
    return '$value vs previous period';
  }

  @override
  String get energyIntensity => 'Intensity';

  @override
  String perOccupiedRoom(String value, String unit) {
    return '$value $unit / occupied room';
  }

  @override
  String get estimatedCost => 'Estimated cost';

  @override
  String anomalyDays(String n) {
    return '$n day(s) above alert threshold';
  }

  @override
  String get noReadings => 'No readings yet.';

  @override
  String get energyInsightCta => 'Ask the AI assistant why';

  @override
  String get invTitle => 'Inventory';

  @override
  String get lowStock => 'Low';

  @override
  String get outOfStock => 'Out of stock';

  @override
  String get onHand => 'On hand';

  @override
  String get reorderLevel => 'Reorder level';

  @override
  String get stockValue => 'Stock value';

  @override
  String get recordMovement => 'Record movement';

  @override
  String get mvReceive => 'Receive';

  @override
  String get mvIssue => 'Issue';

  @override
  String get mvAdjust => 'Adjust';

  @override
  String get mvWaste => 'Waste';

  @override
  String quantityLabel(String unit) {
    return 'Quantity ($unit)';
  }

  @override
  String get reasonLabel => 'Reason / destination';

  @override
  String get movementSaved => 'Movement recorded';

  @override
  String get movements => 'Movements';

  @override
  String get invCatGuestAmenities => 'Guest amenities';

  @override
  String get invCatLinen => 'Linen';

  @override
  String get invCatCleaningSupplies => 'Cleaning supplies';

  @override
  String get invCatFoodAndBeverage => 'Food & beverage';

  @override
  String get invCatMaintenanceParts => 'Maintenance parts';

  @override
  String get invCatOffice => 'Office';

  @override
  String get invCatOther => 'Other';

  @override
  String get newItem => 'New item';

  @override
  String get itemName => 'Item name';

  @override
  String get skuLabel => 'SKU';

  @override
  String get unitLabel => 'Unit';

  @override
  String get initialQuantity => 'Opening quantity';

  @override
  String get unitCost => 'Unit cost (IRR)';

  @override
  String get locationLabel => 'Storage location';

  @override
  String get itemCreated => 'Item created';

  @override
  String get filterLowStock => 'Low stock only';

  @override
  String get noMovements => 'No movements yet.';

  @override
  String get staffTitle => 'Staff & shifts';

  @override
  String get shiftsTab => 'Shifts';

  @override
  String get staffTab => 'Staff';

  @override
  String get shiftMorning => 'Morning';

  @override
  String get shiftEvening => 'Evening';

  @override
  String get shiftNight => 'Night';

  @override
  String get shiftScheduled => 'Scheduled';

  @override
  String get shiftCheckedIn => 'On duty';

  @override
  String get shiftCompleted => 'Completed';

  @override
  String get shiftAbsent => 'Absent';

  @override
  String get addShift => 'Add shift';

  @override
  String get selectStaff => 'Select employee';

  @override
  String get shiftTypeLabel => 'Shift';

  @override
  String get shiftCreated => 'Shift added';

  @override
  String get checkIn => 'Check in';

  @override
  String get checkOut => 'Check out';

  @override
  String get markAbsent => 'Mark absent';

  @override
  String get noShifts => 'No shifts for this day.';

  @override
  String onDutyCount(String n) {
    return '$n on duty';
  }

  @override
  String get noAppAccount => 'No app account';

  @override
  String get dailyOpsTitle => 'Daily figures';

  @override
  String get dailyOpsHint =>
      'Until the PMS integration is live, enter occupancy and revenue here daily.';

  @override
  String get roomsAvailable => 'Rooms available';

  @override
  String get roomsOccupied => 'Rooms sold';

  @override
  String get guestsLabel => 'Guests';

  @override
  String get roomRevenue => 'Room revenue (IRR)';

  @override
  String get fnbRevenue => 'F&B revenue (IRR)';

  @override
  String get otherRevenue => 'Other revenue (IRR)';

  @override
  String get reportsTitle => 'Reports';

  @override
  String get reportExecutive => 'Executive summary';

  @override
  String get reportEnergy => 'Energy report';

  @override
  String get reportMaintenance => 'Maintenance report';

  @override
  String get reportHousekeeping => 'Housekeeping report';

  @override
  String get reportInventory => 'Inventory report';

  @override
  String get reportPeriod => 'Period';

  @override
  String get last7Days => 'Last 7 days';

  @override
  String get generatePdf => 'Generate PDF';

  @override
  String get generating => 'Generating…';

  @override
  String get reportReady => 'Report ready';

  @override
  String get recentReports => 'Recent reports';

  @override
  String get noReports => 'No reports yet.';

  @override
  String reportBy(String date, String name) {
    return '$date — $name';
  }

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get markAllRead => 'Mark all as read';

  @override
  String get noNotifications => 'You\'re all caught up.';

  @override
  String get severityInfo => 'Info';

  @override
  String get severityWarning => 'Warning';

  @override
  String get severityCritical => 'Critical';

  @override
  String get insightsTitle => 'AI insights';

  @override
  String get insightsSubtitle => 'Automated analysis — managers make the call.';

  @override
  String get insCatEnergy => 'Energy';

  @override
  String get insCatMaintenance => 'Maintenance';

  @override
  String get insCatHousekeeping => 'Housekeeping';

  @override
  String get insCatInventory => 'Inventory';

  @override
  String get insCatRevenue => 'Revenue';

  @override
  String get insCatStaffing => 'Staffing';

  @override
  String confidenceLabel(String value) {
    return '$value confidence';
  }

  @override
  String estimatedSaving(String amount) {
    return 'Est. monthly saving: $amount';
  }

  @override
  String get evidenceLabel => 'Evidence';

  @override
  String get recommendationLabel => 'Recommendation';

  @override
  String get acceptInsight => 'Accept';

  @override
  String get dismissInsight => 'Dismiss';

  @override
  String get implementedInsight => 'Implemented';

  @override
  String get insightUpdated => 'Insight updated';

  @override
  String get noInsights => 'No active insights.';

  @override
  String get sourceRuleEngine => 'Analytics engine';

  @override
  String get sourceLlm => 'AI model';

  @override
  String get assistantTitle => 'AI assistant';

  @override
  String get assistantWelcome =>
      'Hi! I\'m Zarin\'s analytics assistant. Ask me about energy, rooms, maintenance, inventory or revenue.';

  @override
  String get assistantHint => 'Ask a question…';

  @override
  String get assistantSuggestion1 => 'Why is electricity usage up?';

  @override
  String get assistantSuggestion2 => 'Which area has the most waste?';

  @override
  String get assistantSuggestion3 => 'How is maintenance doing?';

  @override
  String get assistantSuggestion4 => 'What is running low in stock?';

  @override
  String get assistantDisclaimer =>
      'Answers are generated from recorded data — you make the final call.';

  @override
  String get assistantError => 'Couldn\'t get an answer. Please try again.';

  @override
  String get basedOn => 'Based on:';

  @override
  String get send => 'Send';

  @override
  String get thinking => 'Analyzing…';

  @override
  String get usersTitle => 'Users & access';

  @override
  String get newUser => 'New user';

  @override
  String get fullNameLabel => 'Full name';

  @override
  String get phoneLabel => 'Mobile';

  @override
  String get roleLabel => 'Role';

  @override
  String get temporaryPassword => 'Temporary password';

  @override
  String get generatePassword => 'Generate';

  @override
  String get createUser => 'Create user';

  @override
  String get userCreated =>
      'User created. Hand over the temporary password in person.';

  @override
  String get suspendUser => 'Suspend';

  @override
  String get activateUser => 'Activate';

  @override
  String get resetPassword => 'Reset password';

  @override
  String passwordResetDone(String password) {
    return 'New temporary password: $password';
  }

  @override
  String get userStatusActive => 'Active';

  @override
  String get userStatusSuspended => 'Suspended';

  @override
  String get userStatusDisabled => 'Disabled';

  @override
  String lastLogin(String time) {
    return 'Last sign-in: $time';
  }

  @override
  String get neverLoggedIn => 'Never signed in';

  @override
  String get assignableRolesHint =>
      'Only roles you are allowed to assign are listed.';

  @override
  String get profileTitle => 'Profile';

  @override
  String get languageLabel => 'Language';

  @override
  String get languageFa => 'فارسی';

  @override
  String get languageEn => 'English';

  @override
  String get activeSessions => 'Active devices';

  @override
  String get revokeAllSessions => 'Sign out all devices';

  @override
  String get sessionsRevoked => 'All sessions revoked';

  @override
  String get thisDevice => 'This device';

  @override
  String permissionsCount(String n) {
    return '$n permissions';
  }

  @override
  String get myPermissions => 'My permissions';

  @override
  String appVersionLabel(String version) {
    return 'Version $version';
  }

  @override
  String get hotelLabel => 'Hotel';

  @override
  String get statusLabel => 'Status';

  @override
  String get roomTypeLabel => 'Room type';

  @override
  String get recentReadings => 'Recent readings';

  @override
  String get recommendationCenterTitle => 'Recommendation center';

  @override
  String get recommendationCenterSubtitle =>
      'Decide, assign the work and see what each recommendation actually changed.';

  @override
  String get tabOpen => 'Open';

  @override
  String get tabDecided => 'Decided';

  @override
  String get tabClosed => 'Closed';

  @override
  String get nothingHereYet => 'Nothing here yet.';

  @override
  String expectedSavingOpen(String amount) {
    return 'Expected monthly savings (open): $amount';
  }

  @override
  String measuredSaving(String amount) {
    return 'Measured monthly savings: $amount';
  }

  @override
  String get measuredSavingNote =>
      'Only evaluations that pass the statistical check are counted.';

  @override
  String get expectedImpactLabel => 'Expected impact';

  @override
  String impactFromTo(String from, String to, String unit) {
    return '$from → $to $unit';
  }

  @override
  String get decideAction => 'Decide';

  @override
  String get decisionTitle => 'Decision';

  @override
  String get decisionNoteHint => 'Note: why, who, by when';

  @override
  String get createLinkedTicket => 'Open a maintenance ticket for this';

  @override
  String get decisionSaved => 'Decision saved';

  @override
  String decidedByLine(String status, String name, String date) {
    return '$status by $name · $date';
  }

  @override
  String get openLinkedTicket => 'Linked ticket';

  @override
  String get evaluationLabel => 'Measured result';

  @override
  String evaluationPending(String date) {
    return 'Will be measured after $date';
  }

  @override
  String get evaluationImproved => 'Improvement confirmed';

  @override
  String get evaluationWorse => 'Worse than before';

  @override
  String get evaluationNoProblem => 'The problem did not occur';

  @override
  String get evaluationProblemHappened => 'The problem still occurred';

  @override
  String get evaluationInconclusive =>
      'Inconclusive: the change is within normal variation';

  @override
  String get evaluationInsufficient => 'Not enough data to evaluate';

  @override
  String get evaluationNotSupported => 'No automatic evaluation for this type';

  @override
  String beforeAfter(String before, String after, String unit) {
    return 'Before $before · after $after $unit';
  }

  @override
  String get evaluationLimitEnergy =>
      'Compared with the expected use for each day\'s occupancy and season; weather and other changes are not modelled.';

  @override
  String get evaluationLimitBeforeAfter =>
      'Simple before/after comparison; other changes in the same period are not controlled for.';

  @override
  String get evaluationLimitOutcome =>
      'Shows whether the problem occurred, not how much the action contributed.';

  @override
  String get closedNotDetected =>
      'Closed automatically: no longer detected in the latest analysis.';

  @override
  String get insStatusActive => 'Open';

  @override
  String get insStatusAccepted => 'Accepted';

  @override
  String get insStatusDismissed => 'Dismissed';

  @override
  String get insStatusImplemented => 'Implemented';

  @override
  String get insStatusResolved => 'Resolved';

  @override
  String get insPriorityLow => 'Low priority';

  @override
  String get insPriorityMedium => 'Medium priority';

  @override
  String get insPriorityHigh => 'High priority';

  @override
  String get unitMinutes => 'min';

  @override
  String get unitTickets => 'tickets';

  @override
  String get unitRooms => 'rooms';

  @override
  String get unitDays => 'days';

  @override
  String get unitPoints => 'pts';

  @override
  String get navForecasts => 'Forecasts';

  @override
  String get forecastsTitle => 'Forecasts';

  @override
  String get forecastsSubtitle =>
      'The next 28 days, from the hotel\'s own history. Each model is tested on past data before it is used.';

  @override
  String get forecastIsEstimate =>
      'Forecasts are estimates with a range, not confirmed figures.';

  @override
  String get seriesOccupancy => 'Occupancy';

  @override
  String get seriesRoomRevenue => 'Room revenue';

  @override
  String get seriesTotalRevenue => 'Total revenue';

  @override
  String get modelSeasonalNaive => 'Same weekday last week';

  @override
  String get modelHoltWinters => 'Weekly exponential smoothing (Holt-Winters)';

  @override
  String get modelCalendarRegression =>
      'Calendar regression (weekday, holidays, season)';

  @override
  String forecastAccuracy(String mape, String naive) {
    return 'Backtest error $mape · simple benchmark $naive';
  }

  @override
  String forecastLive(String mape, String days) {
    return 'Next-day forecasts so far: $mape error over $days days';
  }

  @override
  String get forecastNoData => 'No data yet';

  @override
  String get forecastShortHistory => 'Needs at least 5 weeks of data';

  @override
  String get forecastGaps => 'Too many missing days';

  @override
  String get forecastStale => 'No data recorded in the last week';

  @override
  String get forecastNotRun => 'Not computed yet';

  @override
  String get forecastRange => '80% range';

  @override
  String get forecastNext7 => 'Next 7 days, average';

  @override
  String get forecastNext7Total => 'Next 7 days, total';

  @override
  String get refreshForecasts => 'Recompute';

  @override
  String get forecastsRefreshed => 'Forecasts updated';

  @override
  String get forecastLabel => 'Forecast';

  @override
  String get actualLabel => 'Actual';

  @override
  String get baselineSection => 'Baseline and savings';

  @override
  String get baselineExplain =>
      'Expected use for each day\'s occupancy, learned from the year before this period.';

  @override
  String baselineFit(String cv, String nmbe) {
    return 'Fit: CV(RMSE) $cv · NMBE $nmbe · limit 25%';
  }

  @override
  String get baselineInvalid =>
      'The model is too imprecise for savings claims.';

  @override
  String get baselineMissing =>
      'Not enough history for a baseline yet (28 days with occupancy needed).';

  @override
  String get expectedLabel => 'Expected';

  @override
  String get cusumTitle => 'Cumulative difference from expected (CUSUM)';

  @override
  String savingsResult(String amount, String unc) {
    return 'Savings $amount ± $unc';
  }

  @override
  String overuseResult(String amount, String unc) {
    return 'Over-use $amount ± $unc';
  }

  @override
  String get withinNormalVariation => 'Within normal variation';

  @override
  String costPerOccupiedRoom(String amount) {
    return '$amount per occupied room';
  }

  @override
  String carbonPerOccupiedRoom(String kg) {
    return '$kg kg CO₂ per occupied room';
  }

  @override
  String carbonTotal(String kg) {
    return '$kg kg CO₂ in total';
  }

  @override
  String emissionFactorNote(String kind, String source) {
    return 'Emission factor ($kind): $source';
  }

  @override
  String get assumptionLabel => 'assumption';

  @override
  String get navCalendar => 'Calendar';

  @override
  String get calendarTitle => 'Holidays and events';

  @override
  String get calendarSubtitle =>
      'Fixed public holidays are built in. Add religious (lunar) holidays from the official calendar, and local events; forecasts use them.';

  @override
  String get calendarAdd => 'Add event';

  @override
  String get eventTitleLabel => 'Title';

  @override
  String get eventKindLabel => 'Type';

  @override
  String get eventFromLabel => 'From';

  @override
  String get eventToLabel => 'To (optional)';

  @override
  String get eventKindPublicHoliday => 'Public holiday';

  @override
  String get eventKindReligious => 'Religious holiday';

  @override
  String get eventKindSchool => 'School holiday';

  @override
  String get eventKindLocalEvent => 'Local event';

  @override
  String get eventKindClosure => 'Closure';

  @override
  String get eventKindOther => 'Other';

  @override
  String get builtInHolidays => 'Built-in public holidays (next 12 months)';

  @override
  String get hotelEvents => 'Added by the hotel';

  @override
  String get noEvents => 'No events added yet.';

  @override
  String get eventSaved => 'Event saved';

  @override
  String get eventDeleted => 'Event deleted';

  @override
  String get deleteAction => 'Delete';

  @override
  String get eventDateOrder =>
      'The end date must not be before the start date.';

  @override
  String get billionRialUnit => 'billion IRR';

  @override
  String get forecastCardTitle => 'Forecast';

  @override
  String forecastOccupancyNext7(String value) {
    return 'Occupancy, next 7 days: $value';
  }

  @override
  String forecastRevenueNext7(String value) {
    return 'Room revenue, next 7 days: $value';
  }

  @override
  String get forecastOpenAll => 'All forecasts';

  @override
  String forecastModelLine(String model) {
    return 'Model: $model';
  }

  @override
  String get revenueSectionTitle => 'Day\'s revenue (record only)';

  @override
  String get revenueWriteOnlyHint =>
      'Recorded amounts are never shown. To correct them, enter the amounts again in full.';

  @override
  String get revenueRecorded => 'Revenue for this day has been recorded.';

  @override
  String get revenueNotRecorded =>
      'No revenue has been recorded for this day yet.';

  @override
  String get revenueNeedsRoom => 'Enter room revenue to record revenue.';

  @override
  String get confirmRevenueTitle => 'Confirm revenue';

  @override
  String confirmRevenueBody(String day) {
    return 'These amounts will be recorded for $day and cannot be viewed afterwards:';
  }

  @override
  String get revenueTotal => 'Total';

  @override
  String get confirmAndSave => 'Confirm and save';

  @override
  String get editValues => 'Edit';

  @override
  String get tabActions => 'Actions';

  @override
  String get actionsSubtitle =>
      'Typed actions for each recommendation. Nothing runs without the approval of that department\'s manager; each action\'s effect is measured after its window.';

  @override
  String get noActions => 'No actions yet.';

  @override
  String get actionApprove => 'Approve and run';

  @override
  String get actionReject => 'Reject';

  @override
  String get actionRejectNote => 'Reason (required)';

  @override
  String get actionApproved => 'Action approved and run.';

  @override
  String get actionRejected => 'Action rejected.';

  @override
  String get actionNotYours =>
      'This action is for the manager of its department to decide.';

  @override
  String get actionOutcomeInconclusive =>
      'The effect could not be told apart from normal variation.';

  @override
  String get actionOutcomeNotMeasurable =>
      'Not enough data to measure the effect.';

  @override
  String get actionOutcomePending => 'The effect is measured after its window.';

  @override
  String get actionOutcomeLabel =>
      'Before/after comparison: observational, not causal.';

  @override
  String get briefingTitle => 'Morning briefing';

  @override
  String get briefingSourceRules => 'Rule-based';

  @override
  String get briefingSourceLlm => 'AI-worded, numbers checked';

  @override
  String get briefingNone => 'Today\'s briefing is not ready yet.';

  @override
  String get briefingUseful => 'Useful';

  @override
  String get briefingNotUseful => 'Not useful';

  @override
  String get briefingThanks => 'Thanks for the feedback.';

  @override
  String get energyModelSection => 'Energy model';

  @override
  String get energyModelExplain =>
      'Each day\'s expected use given occupancy and temperature; alerts only when use leaves the expected band.';

  @override
  String get energyModelNone => 'No model for this meter yet.';

  @override
  String get energyModelWeather => 'with temperature and occupancy';

  @override
  String get energyModelNoWeather => 'with occupancy, without temperature data';

  @override
  String get flagSpike => 'Spike';

  @override
  String get flagDrift => 'Drift';

  @override
  String get flagExcluded => 'Excluded';

  @override
  String get energyExclusionsTitle => 'Days kept out of the model';

  @override
  String get energyNoExclusions => 'No days are kept out.';

  @override
  String get energyExcludeDays => 'Keep days out';

  @override
  String get energyExcludeHint =>
      'Only for known events (an exhibition, planned works). At most 5 days a month; the days only leave the model fit and are still checked and alerted on. Runs after approval in Actions.';

  @override
  String get energyExcludeReason => 'Reason (required, at least 10 characters)';

  @override
  String get energyExcludeSubmit => 'Send for approval';

  @override
  String get energyExcludeSent => 'Sent: it waits for approval in Actions.';

  @override
  String actionStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'proposed': 'Pending',
      'executed': 'Executed',
      'failed': 'Failed',
      'rejected': 'Rejected',
      'expired': 'Expired',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String actionType(String type) {
    String _temp0 = intl.Intl.selectLogic(type, {
      'createTicket': 'Maintenance ticket',
      'createTask': 'Housekeeping task',
      'notifyRole': 'Notification',
      'adjustBaseline': 'Keep days out of the energy model',
      'other': '$type',
    });
    return '$_temp0';
  }

  @override
  String actionDepartment(String department) {
    String _temp0 = intl.Intl.selectLogic(department, {
      'energy': 'Energy',
      'maintenance': 'Maintenance',
      'housekeeping': 'Housekeeping',
      'inventory': 'Inventory',
      'restaurant': 'Restaurant',
      'operations': 'Operations',
      'other': '$department',
    });
    return '$_temp0';
  }

  @override
  String actionDecidedBy(String name, String when) {
    return 'Decided by $name, $when';
  }

  @override
  String actionFailedReason(String code) {
    return 'Execution failed: $code';
  }

  @override
  String actionOutcomeMeasured(String value, String low, String high) {
    return 'Measured effect: $value (95% interval $low to $high)';
  }

  @override
  String energyModelValid(String kind, String cv) {
    return 'Valid model $kind; monthly CV(RMSE) $cv% (below 15%).';
  }

  @override
  String energyModelInvalid(String reason) {
    return 'The model is not reliable yet ($reason); alerts use the previous baseline.';
  }

  @override
  String energyModelInsufficient(String reason) {
    return 'Not enough data ($reason); at least 90 days of use and occupancy are needed.';
  }

  @override
  String energyModelWeatherSource(String source) {
    return 'Temperature source: $source';
  }

  @override
  String energyExpectedRange(String expected, String low, String high) {
    return 'Expected $expected (band $low to $high)';
  }

  @override
  String get showLess => 'Show less';

  @override
  String showAll(int count) {
    return 'Show all $count';
  }
}
