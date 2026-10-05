// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Persian (`fa`).
class AppLocalizationsFa extends AppLocalizations {
  AppLocalizationsFa([String locale = 'fa']) : super(locale);

  @override
  String get appName => 'زرین هوشمند';

  @override
  String get appTagline => 'پلتفرم هوشمند بهینه‌سازی هتل';

  @override
  String get demoBadge => 'نسخه نمایشی';

  @override
  String get retry => 'تلاش دوباره';

  @override
  String get cancel => 'انصراف';

  @override
  String get save => 'ذخیره';

  @override
  String get confirm => 'تأیید';

  @override
  String get close => 'بستن';

  @override
  String get seeAll => 'مشاهده همه';

  @override
  String get more => 'بیشتر';

  @override
  String get search => 'جستجو';

  @override
  String get filterAll => 'همه';

  @override
  String get today => 'امروز';

  @override
  String get yesterday => 'دیروز';

  @override
  String get tomorrow => 'فردا';

  @override
  String get justNow => 'همین الان';

  @override
  String minutesAgo(String n) {
    return '$n دقیقه پیش';
  }

  @override
  String hoursAgo(String n) {
    return '$n ساعت پیش';
  }

  @override
  String daysAgo(String n) {
    return '$n روز پیش';
  }

  @override
  String minutesValue(String n) {
    return '$n دقیقه';
  }

  @override
  String get currencyRial => 'ریال';

  @override
  String get optional => 'اختیاری';

  @override
  String get requiredField => 'این فیلد الزامی است';

  @override
  String get invalidNumber => 'عدد معتبر وارد کنید';

  @override
  String get savedSuccessfully => 'با موفقیت ذخیره شد';

  @override
  String get signOut => 'خروج از حساب';

  @override
  String get signOutConfirm => 'از حساب کاربری خارج می‌شوید؟';

  @override
  String get errorGeneric => 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';

  @override
  String get errorNetwork =>
      'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.';

  @override
  String get errorPermission => 'شما مجوز انجام این عملیات را ندارید.';

  @override
  String get errorNotFound => 'مورد درخواستی یافت نشد.';

  @override
  String get errorSessionExpired => 'نشست شما منقضی شده است. دوباره وارد شوید.';

  @override
  String get errorUnsupported => 'این قابلیت در این نسخه فعال نیست.';

  @override
  String get errorValidation => 'اطلاعات وارد شده معتبر نیست.';

  @override
  String get errorRoomStatusChanged =>
      'وضعیت اتاق هم‌زمان توسط شخص دیگری تغییر کرده است.';

  @override
  String get errorInsufficientStock => 'موجودی کافی نیست.';

  @override
  String get errorOccupiedExceeds =>
      'تعداد اتاق‌های اشغال بیش از اتاق‌های قابل فروش است.';

  @override
  String get errorNationalIdExists => 'کاربری با این کد ملی قبلاً ثبت شده است.';

  @override
  String get errorTaskChanged => 'وضعیت این وظیفه تغییر کرده است.';

  @override
  String get emptyGeneric => 'موردی برای نمایش وجود ندارد.';

  @override
  String get loginTitle => 'ورود به سامانه';

  @override
  String get loginSubtitle =>
      'با کد ملی و رمز عبوری که مدیر سیستم برای شما تعریف کرده وارد شوید.';

  @override
  String get nationalIdLabel => 'کد ملی';

  @override
  String get nationalIdHint => '۱۰ رقم بدون خط تیره';

  @override
  String get nationalIdInvalid => 'کد ملی معتبر نیست';

  @override
  String get passwordLabel => 'رمز عبور';

  @override
  String get passwordRequired => 'رمز عبور را وارد کنید';

  @override
  String get loginButton => 'ورود';

  @override
  String get showPassword => 'نمایش رمز';

  @override
  String get hidePassword => 'پنهان کردن رمز';

  @override
  String get errorInvalidCredentials => 'کد ملی یا رمز عبور نادرست است.';

  @override
  String get errorAccountDisabled =>
      'حساب شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.';

  @override
  String get errorNotProvisioned => 'نقش یا هتل برای حساب شما تعریف نشده است.';

  @override
  String get errorTooManyRequests =>
      'تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره تلاش کنید.';

  @override
  String get forgotPasswordHint =>
      'برای بازیابی رمز عبور با مدیر سیستم هتل تماس بگیرید.';

  @override
  String get demoAccountsTitle => 'ورود سریع با حساب نمایشی';

  @override
  String get demoAccountsHint =>
      'هر نقش، داشبورد و دسترسی‌های مخصوص به خود را می‌بیند.';

  @override
  String demoPasswordNote(String password) {
    return 'رمز همه حساب‌ها: $password';
  }

  @override
  String get loginFooter =>
      'دسترسی هر کاربر بر اساس نقش او در سرور کنترل می‌شود.';

  @override
  String get changePasswordTitle => 'تغییر رمز عبور';

  @override
  String get mustChangePasswordInfo =>
      'برای امنیت حساب، رمز موقت خود را تغییر دهید.';

  @override
  String get currentPassword => 'رمز فعلی';

  @override
  String get newPassword => 'رمز جدید';

  @override
  String get confirmPassword => 'تکرار رمز جدید';

  @override
  String get passwordTooWeak => 'حداقل ۸ کاراکتر شامل حرف و عدد';

  @override
  String get passwordsDontMatch => 'رمزها یکسان نیستند';

  @override
  String get passwordChanged => 'رمز عبور تغییر کرد';

  @override
  String get accessDeniedTitle => 'دسترسی مجاز نیست';

  @override
  String get accessDeniedBody =>
      'این بخش برای نقش شما فعال نیست. اگر فکر می‌کنید به آن نیاز دارید، با مدیر خود هماهنگ کنید.';

  @override
  String get goHome => 'بازگشت به خانه';

  @override
  String get sessionTimedOut => 'به دلیل عدم فعالیت از حساب خارج شدید.';

  @override
  String get navHome => 'خانه';

  @override
  String get navDashboard => 'داشبورد';

  @override
  String get navMyWork => 'کارهای من';

  @override
  String get navRooms => 'اتاق‌ها';

  @override
  String get navHousekeeping => 'خانه‌داری';

  @override
  String get navMaintenance => 'تعمیرات';

  @override
  String get navEnergy => 'انرژی';

  @override
  String get navInventory => 'انبار';

  @override
  String get navStaff => 'کارکنان';

  @override
  String get navReports => 'گزارش‌ها';

  @override
  String get navNotifications => 'اعلان‌ها';

  @override
  String get navInsights => 'پیشنهادهای هوشمند';

  @override
  String get navAssistant => 'دستیار هوشمند';

  @override
  String get navUsers => 'کاربران';

  @override
  String get navProfile => 'حساب کاربری';

  @override
  String get navDailyOps => 'آمار روزانه';

  @override
  String get navMore => 'بیشتر';

  @override
  String get roleSuperAdmin => 'مدیر سامانه';

  @override
  String get roleHotelOwner => 'مالک هتل';

  @override
  String get roleGeneralManager => 'مدیر کل هتل';

  @override
  String get roleOperationsManager => 'مدیر عملیات';

  @override
  String get roleEnergyManager => 'مدیر انرژی';

  @override
  String get roleMaintenanceManager => 'مدیر تعمیرات';

  @override
  String get roleHousekeepingManager => 'سرپرست خانه‌داری';

  @override
  String get roleRestaurantManager => 'مدیر رستوران';

  @override
  String get roleInventoryManager => 'مدیر انبار';

  @override
  String get roleHrManager => 'مدیر منابع انسانی';

  @override
  String get roleReceptionStaff => 'کارمند پذیرش';

  @override
  String get roleHousekeepingStaff => 'کارمند خانه‌داری';

  @override
  String get roleMaintenanceStaff => 'تکنسین تعمیرات';

  @override
  String get roleRestaurantStaff => 'کارمند رستوران';

  @override
  String get roleAnalyst => 'تحلیلگر';

  @override
  String get deptManagement => 'مدیریت';

  @override
  String get deptFrontOffice => 'پذیرش';

  @override
  String get deptHousekeeping => 'خانه‌داری';

  @override
  String get deptMaintenance => 'تعمیرات';

  @override
  String get deptEnergy => 'انرژی';

  @override
  String get deptFoodAndBeverage => 'رستوران و غذا';

  @override
  String get deptInventory => 'انبار';

  @override
  String get deptHumanResources => 'منابع انسانی';

  @override
  String get deptAnalytics => 'تحلیل داده';

  @override
  String greetingMorning(String name) {
    return 'صبح بخیر، $name';
  }

  @override
  String greetingAfternoon(String name) {
    return 'ظهر بخیر، $name';
  }

  @override
  String greetingEvening(String name) {
    return 'عصر بخیر، $name';
  }

  @override
  String dashboardSubtitle(String hotel) {
    return 'تصویر لحظه‌ای عملکرد $hotel';
  }

  @override
  String opsDashboardSubtitle(String department) {
    return 'کنسول $department';
  }

  @override
  String get kpiOccupancy => 'نرخ اشغال';

  @override
  String get kpiAdr => 'ADR (نرخ میانگین)';

  @override
  String get kpiRevpar => 'RevPAR (هر اتاق)';

  @override
  String get kpiRevenue => 'درآمد دیروز';

  @override
  String get kpiElectricity => 'مصرف برق دیروز';

  @override
  String get kpiEnergyIntensity => 'شدت مصرف برق';

  @override
  String get kpiEnergyIntensityUnit => 'kWh به ازای اتاق اشغال';

  @override
  String get kpiOpenTickets => 'خرابی‌های باز';

  @override
  String kpiOverdueTickets(String n) {
    return '$n مورد خارج از SLA';
  }

  @override
  String get kpiRoomsReady => 'اتاق آماده فروش';

  @override
  String kpiRoomsToClean(String n) {
    return '$n در انتظار نظافت';
  }

  @override
  String get kpiStaffOnDuty => 'کارکنان حاضر';

  @override
  String get kpiHousekeeping => 'پیشرفت خانه‌داری';

  @override
  String get kpiLowStock => 'اقلام زیر نقطه سفارش';

  @override
  String vsLastWeek(String value) {
    return '$value نسبت به هفته قبل';
  }

  @override
  String vsBaselineShort(String value) {
    return '$value نسبت به خط مبنا';
  }

  @override
  String get sectionAlerts => 'هشدارها';

  @override
  String get sectionInsights => 'پیشنهادهای هوشمند';

  @override
  String get sectionRoomStatus => 'وضعیت اتاق‌ها';

  @override
  String get sectionOccupancyTrend => 'روند اشغال — ۱۴ روز اخیر';

  @override
  String get sectionEnergyTrend => 'روند مصرف برق — ۱۴ روز اخیر';

  @override
  String get sectionRequests => 'درخواست‌های تعمیر باز';

  @override
  String get sectionToday => 'امروز';

  @override
  String get noAlerts => 'هشدار فعالی وجود ندارد.';

  @override
  String get acknowledge => 'تأیید دریافت';

  @override
  String acknowledgedBy(String name) {
    return 'تأیید شده توسط $name';
  }

  @override
  String get baselineLegend => 'خط مبنا';

  @override
  String get myWorkTitle => 'کارهای من';

  @override
  String myWorkProgress(String done, String total) {
    return '$done از $total کار امروز انجام شده';
  }

  @override
  String shiftToday(String start, String end) {
    return 'شیفت امروز: $start تا $end';
  }

  @override
  String get noShiftToday => 'امروز شیفتی برای شما ثبت نشده است.';

  @override
  String get quickActions => 'اقدام سریع';

  @override
  String get actionReportFault => 'گزارش خرابی';

  @override
  String get actionRooms => 'وضعیت اتاق‌ها';

  @override
  String get actionMyTickets => 'تیکت‌های من';

  @override
  String get actionRecordDaily => 'ثبت آمار امروز';

  @override
  String get allTasksDone => 'همه کارهای امروز انجام شد. خسته نباشید!';

  @override
  String get nextTask => 'کار بعدی';

  @override
  String get roomsTitle => 'وضعیت اتاق‌ها';

  @override
  String roomLabel(String number) {
    return 'اتاق $number';
  }

  @override
  String floorLabel(String n) {
    return 'طبقه $n';
  }

  @override
  String get roomStatusVacantClean => 'آماده';

  @override
  String get roomStatusVacantDirty => 'نیاز به نظافت';

  @override
  String get roomStatusCleaningInProgress => 'در حال نظافت';

  @override
  String get roomStatusOccupied => 'اشغال';

  @override
  String get roomStatusOutOfOrder => 'تعمیر';

  @override
  String get roomTypeSingle => 'یک‌تخته';

  @override
  String get roomTypeDouble => 'دوتخته';

  @override
  String get roomTypeTwin => 'دو تخت جدا';

  @override
  String get roomTypeSuite => 'سوئیت';

  @override
  String get roomTypeDeluxe => 'دلوکس';

  @override
  String get changeStatus => 'تغییر وضعیت';

  @override
  String changeStatusTo(String status) {
    return 'تغییر به «$status»';
  }

  @override
  String get statusUpdated => 'وضعیت به‌روزرسانی شد';

  @override
  String get noAllowedTransitions =>
      'تغییر وضعیت این اتاق برای نقش شما مجاز نیست.';

  @override
  String lastUpdatedBy(String time, String name) {
    return 'آخرین تغییر $time توسط $name';
  }

  @override
  String roomsCount(String n) {
    return '$n اتاق';
  }

  @override
  String get reportFaultForRoom => 'گزارش خرابی برای این اتاق';

  @override
  String get roomTasks => 'وظایف خانه‌داری امروز';

  @override
  String get hkTitle => 'خانه‌داری';

  @override
  String get hkMyTasks => 'وظایف من';

  @override
  String get hkAllTasks => 'همه وظایف';

  @override
  String get taskTypeCheckoutClean => 'نظافت پس از تخلیه';

  @override
  String get taskTypeStayoverClean => 'نظافت روزانه';

  @override
  String get taskTypeDeepClean => 'نظافت عمیق';

  @override
  String get taskTypeInspection => 'بازرسی';

  @override
  String get taskTypeTurndown => 'آماده‌سازی شبانه';

  @override
  String get taskStatusPending => 'در انتظار';

  @override
  String get taskStatusInProgress => 'در حال انجام';

  @override
  String get taskStatusDone => 'انجام شد';

  @override
  String get taskStatusCancelled => 'لغو شد';

  @override
  String get priorityLow => 'کم';

  @override
  String get priorityNormal => 'عادی';

  @override
  String get priorityHigh => 'بالا';

  @override
  String get priorityUrgent => 'فوری';

  @override
  String get startTask => 'شروع کار';

  @override
  String get completeTask => 'اتمام و ثبت';

  @override
  String get taskStarted => 'کار شروع شد';

  @override
  String get taskCompleted => 'کار ثبت شد. اتاق آماده است.';

  @override
  String taskDuration(String minutes) {
    return 'مدت انجام: $minutes دقیقه';
  }

  @override
  String taskElapsed(String minutes) {
    return 'سپری‌شده: $minutes دقیقه';
  }

  @override
  String taskTarget(String minutes) {
    return 'هدف: $minutes دقیقه';
  }

  @override
  String dueBy(String time) {
    return 'مهلت: $time';
  }

  @override
  String get assignee => 'مسئول';

  @override
  String get unassigned => 'تخصیص‌نیافته';

  @override
  String get newTask => 'وظیفه جدید';

  @override
  String get selectRoom => 'انتخاب اتاق';

  @override
  String get selectAssignee => 'انتخاب مسئول';

  @override
  String get taskTypeLabel => 'نوع کار';

  @override
  String get priorityLabel => 'اولویت';

  @override
  String get notesLabel => 'توضیحات';

  @override
  String get createTask => 'ایجاد وظیفه';

  @override
  String get taskCreated => 'وظیفه ایجاد شد';

  @override
  String get noTasksToday => 'برای امروز وظیفه‌ای ثبت نشده است.';

  @override
  String get overdue => 'تأخیر';

  @override
  String get completionNotesHint => 'نکته‌ای برای سرپرست (اختیاری)';

  @override
  String get mntTitle => 'تعمیرات و نگهداری';

  @override
  String get mntNewTicket => 'ثبت خرابی';

  @override
  String get ticketTitleLabel => 'عنوان خرابی';

  @override
  String get ticketTitleHint => 'مثلاً: کولر اتاق خنک نمی‌کند';

  @override
  String get ticketDescriptionLabel => 'شرح';

  @override
  String get ticketCategoryLabel => 'دسته';

  @override
  String get ticketLocationLabel => 'محل';

  @override
  String get locationRoom => 'اتاق';

  @override
  String get locationArea => 'فضای عمومی';

  @override
  String get areaHint => 'مثلاً: لابی، آشپزخانه، موتورخانه';

  @override
  String get addPhoto => 'افزودن عکس';

  @override
  String get takePhoto => 'گرفتن عکس';

  @override
  String get chooseFromGallery => 'انتخاب از گالری';

  @override
  String photosCount(String n) {
    return '$n عکس پیوست شد';
  }

  @override
  String get submitTicket => 'ثبت و ارسال';

  @override
  String get ticketCreated => 'خرابی ثبت شد و به تیم تعمیرات اطلاع داده شد.';

  @override
  String get catHvac => 'تهویه و سرمایش';

  @override
  String get catElectrical => 'برق';

  @override
  String get catPlumbing => 'لوله‌کشی';

  @override
  String get catFurniture => 'مبلمان';

  @override
  String get catAppliance => 'تجهیزات';

  @override
  String get catItNetwork => 'شبکه و IT';

  @override
  String get catStructural => 'ساختمانی';

  @override
  String get catOther => 'سایر';

  @override
  String get tPriorityLow => 'کم';

  @override
  String get tPriorityMedium => 'متوسط';

  @override
  String get tPriorityHigh => 'بالا';

  @override
  String get tPriorityCritical => 'بحرانی';

  @override
  String get tStatusOpen => 'باز';

  @override
  String get tStatusAssigned => 'ارجاع شده';

  @override
  String get tStatusInProgress => 'در حال تعمیر';

  @override
  String get tStatusOnHold => 'متوقف';

  @override
  String get tStatusResolved => 'رفع شد';

  @override
  String get tStatusClosed => 'بسته شد';

  @override
  String get tStatusCancelled => 'لغو شد';

  @override
  String slaDue(String time) {
    return 'مهلت رفع: $time';
  }

  @override
  String get slaOverdue => 'خارج از SLA';

  @override
  String get assignTo => 'ارجاع به تکنسین';

  @override
  String get ticketAssigned => 'تیکت ارجاع شد';

  @override
  String reportedBy(String name) {
    return 'گزارش‌دهنده: $name';
  }

  @override
  String get timeline => 'تاریخچه';

  @override
  String get eventCreated => 'ثبت شد';

  @override
  String eventAssigned(String name) {
    return 'ارجاع به $name';
  }

  @override
  String eventStatus(String from, String to) {
    return '$from ← $to';
  }

  @override
  String get eventComment => 'یادداشت';

  @override
  String get resolutionNoteHint => 'شرح اقدام انجام‌شده';

  @override
  String get tabActive => 'فعال';

  @override
  String get tabMine => 'مربوط به من';

  @override
  String get tabAll => 'همه';

  @override
  String get noTickets => 'تیکتی وجود ندارد.';

  @override
  String get ticketStatusChanged => 'وضعیت تیکت تغییر کرد';

  @override
  String get energyTitle => 'مدیریت انرژی';

  @override
  String get energyElectricity => 'برق';

  @override
  String get energyWater => 'آب';

  @override
  String get energyGas => 'گاز';

  @override
  String get recordReading => 'ثبت مصرف روزانه';

  @override
  String consumptionLabel(String unit) {
    return 'مصرف روز ($unit)';
  }

  @override
  String get meterValueLabel => 'عدد کنتور';

  @override
  String get dateLabel => 'تاریخ';

  @override
  String get readingSaved => 'مصرف ثبت شد';

  @override
  String get last30Days => '۳۰ روز اخیر';

  @override
  String get totalConsumption => 'مصرف کل';

  @override
  String get dailyAverage => 'میانگین روزانه';

  @override
  String get baseline => 'خط مبنا';

  @override
  String vsPreviousPeriod(String value) {
    return '$value نسبت به دوره قبل';
  }

  @override
  String get energyIntensity => 'شدت مصرف';

  @override
  String perOccupiedRoom(String value, String unit) {
    return '$value $unit / اتاق اشغال';
  }

  @override
  String get estimatedCost => 'هزینه تخمینی';

  @override
  String anomalyDays(String n) {
    return '$n روز بالاتر از آستانه هشدار';
  }

  @override
  String get noReadings => 'هنوز مصرفی ثبت نشده است.';

  @override
  String get energyInsightCta => 'تحلیل علت با دستیار هوشمند';

  @override
  String get invTitle => 'انبار و موجودی';

  @override
  String get lowStock => 'کمبود';

  @override
  String get outOfStock => 'ناموجود';

  @override
  String get onHand => 'موجودی';

  @override
  String get reorderLevel => 'نقطه سفارش';

  @override
  String get stockValue => 'ارزش موجودی';

  @override
  String get recordMovement => 'ثبت ورود / خروج';

  @override
  String get mvReceive => 'ورود به انبار';

  @override
  String get mvIssue => 'خروج / مصرف';

  @override
  String get mvAdjust => 'اصلاح موجودی';

  @override
  String get mvWaste => 'ضایعات';

  @override
  String quantityLabel(String unit) {
    return 'مقدار ($unit)';
  }

  @override
  String get reasonLabel => 'علت / مقصد';

  @override
  String get movementSaved => 'گردش کالا ثبت شد';

  @override
  String get movements => 'گردش کالا';

  @override
  String get invCatGuestAmenities => 'اقلام مهمان';

  @override
  String get invCatLinen => 'البسه و ملحفه';

  @override
  String get invCatCleaningSupplies => 'مواد شوینده';

  @override
  String get invCatFoodAndBeverage => 'غذا و نوشیدنی';

  @override
  String get invCatMaintenanceParts => 'قطعات فنی';

  @override
  String get invCatOffice => 'اداری';

  @override
  String get invCatOther => 'سایر';

  @override
  String get newItem => 'کالای جدید';

  @override
  String get itemName => 'نام کالا';

  @override
  String get skuLabel => 'کد کالا';

  @override
  String get unitLabel => 'واحد';

  @override
  String get initialQuantity => 'موجودی اولیه';

  @override
  String get unitCost => 'قیمت واحد (ریال)';

  @override
  String get locationLabel => 'محل نگهداری';

  @override
  String get itemCreated => 'کالا تعریف شد';

  @override
  String get filterLowStock => 'فقط کمبودها';

  @override
  String get noMovements => 'گردشی ثبت نشده است.';

  @override
  String get staffTitle => 'کارکنان و شیفت‌ها';

  @override
  String get shiftsTab => 'شیفت‌ها';

  @override
  String get staffTab => 'کارکنان';

  @override
  String get shiftMorning => 'صبح';

  @override
  String get shiftEvening => 'عصر';

  @override
  String get shiftNight => 'شب';

  @override
  String get shiftScheduled => 'برنامه‌ریزی شده';

  @override
  String get shiftCheckedIn => 'حاضر';

  @override
  String get shiftCompleted => 'پایان یافته';

  @override
  String get shiftAbsent => 'غایب';

  @override
  String get addShift => 'افزودن شیفت';

  @override
  String get selectStaff => 'انتخاب کارمند';

  @override
  String get shiftTypeLabel => 'نوبت کاری';

  @override
  String get shiftCreated => 'شیفت ثبت شد';

  @override
  String get checkIn => 'ثبت حضور';

  @override
  String get checkOut => 'پایان شیفت';

  @override
  String get markAbsent => 'ثبت غیبت';

  @override
  String get noShifts => 'شیفتی برای این روز ثبت نشده است.';

  @override
  String onDutyCount(String n) {
    return '$n نفر حاضر';
  }

  @override
  String get noAppAccount => 'بدون حساب کاربری';

  @override
  String get dailyOpsTitle => 'ثبت آمار روزانه';

  @override
  String get dailyOpsHint =>
      'تا پیش از اتصال به PMS، آمار اشغال و درآمد هر روز اینجا ثبت می‌شود.';

  @override
  String get roomsAvailable => 'اتاق قابل فروش';

  @override
  String get roomsOccupied => 'اتاق فروخته‌شده';

  @override
  String get guestsLabel => 'تعداد مهمان';

  @override
  String get roomRevenue => 'درآمد اتاق (ریال)';

  @override
  String get fnbRevenue => 'درآمد رستوران (ریال)';

  @override
  String get otherRevenue => 'سایر درآمدها (ریال)';

  @override
  String get reportsTitle => 'گزارش‌ها';

  @override
  String get reportExecutive => 'خلاصه مدیریتی';

  @override
  String get reportEnergy => 'گزارش انرژی';

  @override
  String get reportMaintenance => 'گزارش تعمیرات';

  @override
  String get reportHousekeeping => 'گزارش خانه‌داری';

  @override
  String get reportInventory => 'گزارش انبار';

  @override
  String get reportPeriod => 'بازه گزارش';

  @override
  String get last7Days => '۷ روز اخیر';

  @override
  String get generatePdf => 'تولید گزارش PDF';

  @override
  String get generating => 'در حال تولید…';

  @override
  String get reportReady => 'گزارش آماده شد';

  @override
  String get recentReports => 'گزارش‌های اخیر';

  @override
  String get noReports => 'هنوز گزارشی تولید نشده است.';

  @override
  String reportBy(String date, String name) {
    return '$date — $name';
  }

  @override
  String get notificationsTitle => 'اعلان‌ها';

  @override
  String get markAllRead => 'علامت‌گذاری همه به‌عنوان خوانده‌شده';

  @override
  String get noNotifications => 'اعلان تازه‌ای ندارید.';

  @override
  String get severityInfo => 'اطلاع';

  @override
  String get severityWarning => 'هشدار';

  @override
  String get severityCritical => 'بحرانی';

  @override
  String get insightsTitle => 'پیشنهادهای هوشمند';

  @override
  String get insightsSubtitle =>
      'تحلیل خودکار داده‌ها؛ تصمیم نهایی با مدیر است.';

  @override
  String get insCatEnergy => 'انرژی';

  @override
  String get insCatMaintenance => 'نگهداری';

  @override
  String get insCatHousekeeping => 'خانه‌داری';

  @override
  String get insCatInventory => 'انبار';

  @override
  String get insCatRevenue => 'درآمد';

  @override
  String get insCatStaffing => 'نیروی انسانی';

  @override
  String confidenceLabel(String value) {
    return 'اطمینان $value';
  }

  @override
  String estimatedSaving(String amount) {
    return 'صرفه‌جویی تخمینی ماهانه: $amount';
  }

  @override
  String get evidenceLabel => 'شواهد';

  @override
  String get recommendationLabel => 'اقدام پیشنهادی';

  @override
  String get acceptInsight => 'پذیرش';

  @override
  String get dismissInsight => 'رد';

  @override
  String get implementedInsight => 'اجرا شد';

  @override
  String get insightUpdated => 'وضعیت پیشنهاد ثبت شد';

  @override
  String get noInsights => 'پیشنهاد فعالی وجود ندارد.';

  @override
  String get sourceRuleEngine => 'موتور تحلیل';

  @override
  String get sourceLlm => 'هوش مصنوعی';

  @override
  String get assistantTitle => 'دستیار هوشمند';

  @override
  String get assistantWelcome =>
      'سلام! من دستیار تحلیلی زرین هستم. درباره انرژی، اتاق‌ها، تعمیرات، انبار یا درآمد هتل بپرسید.';

  @override
  String get assistantHint => 'سؤال خود را بنویسید…';

  @override
  String get assistantSuggestion1 => 'چرا مصرف برق زیاد شده؟';

  @override
  String get assistantSuggestion2 => 'کدام بخش بیشترین اتلاف را دارد؟';

  @override
  String get assistantSuggestion3 => 'وضعیت تعمیرات چطور است؟';

  @override
  String get assistantSuggestion4 => 'چه اقلامی رو به اتمام است؟';

  @override
  String get assistantDisclaimer =>
      'پاسخ‌ها بر اساس داده‌های ثبت‌شده تولید می‌شوند؛ تصمیم نهایی با شماست.';

  @override
  String get assistantError => 'پاسخ دریافت نشد. دوباره تلاش کنید.';

  @override
  String get basedOn => 'بر اساس داده‌ها:';

  @override
  String get send => 'ارسال';

  @override
  String get thinking => 'در حال تحلیل…';

  @override
  String get usersTitle => 'کاربران و دسترسی‌ها';

  @override
  String get newUser => 'کاربر جدید';

  @override
  String get fullNameLabel => 'نام و نام خانوادگی';

  @override
  String get phoneLabel => 'تلفن همراه';

  @override
  String get roleLabel => 'نقش';

  @override
  String get temporaryPassword => 'رمز موقت';

  @override
  String get generatePassword => 'تولید رمز';

  @override
  String get createUser => 'ایجاد کاربر';

  @override
  String get userCreated =>
      'کاربر ایجاد شد. رمز موقت را به‌صورت حضوری تحویل دهید.';

  @override
  String get suspendUser => 'تعلیق';

  @override
  String get activateUser => 'فعال‌سازی';

  @override
  String get resetPassword => 'بازنشانی رمز';

  @override
  String passwordResetDone(String password) {
    return 'رمز موقت جدید: $password';
  }

  @override
  String get userStatusActive => 'فعال';

  @override
  String get userStatusSuspended => 'معلق';

  @override
  String get userStatusDisabled => 'غیرفعال';

  @override
  String lastLogin(String time) {
    return 'آخرین ورود: $time';
  }

  @override
  String get neverLoggedIn => 'هنوز وارد نشده';

  @override
  String get assignableRolesHint =>
      'فقط نقش‌هایی که شما مجاز به تعریف آن هستید نمایش داده می‌شود.';

  @override
  String get profileTitle => 'حساب کاربری';

  @override
  String get languageLabel => 'زبان';

  @override
  String get languageFa => 'فارسی';

  @override
  String get languageEn => 'English';

  @override
  String get activeSessions => 'دستگاه‌های فعال';

  @override
  String get revokeAllSessions => 'خروج از همه دستگاه‌ها';

  @override
  String get sessionsRevoked => 'همه نشست‌ها باطل شد';

  @override
  String get thisDevice => 'این دستگاه';

  @override
  String permissionsCount(String n) {
    return '$n مجوز فعال';
  }

  @override
  String get myPermissions => 'مجوزهای من';

  @override
  String appVersionLabel(String version) {
    return 'نسخه $version';
  }

  @override
  String get hotelLabel => 'هتل';

  @override
  String get statusLabel => 'وضعیت';

  @override
  String get roomTypeLabel => 'نوع اتاق';

  @override
  String get recentReadings => 'ثبت‌های اخیر';
}
