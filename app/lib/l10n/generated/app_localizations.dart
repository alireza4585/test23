import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fa.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('fa'),
  ];

  /// No description provided for @appName.
  ///
  /// In fa, this message translates to:
  /// **'زرین هوشمند'**
  String get appName;

  /// No description provided for @appTagline.
  ///
  /// In fa, this message translates to:
  /// **'پلتفرم هوشمند بهینه‌سازی هتل'**
  String get appTagline;

  /// No description provided for @demoBadge.
  ///
  /// In fa, this message translates to:
  /// **'نسخه نمایشی'**
  String get demoBadge;

  /// No description provided for @retry.
  ///
  /// In fa, this message translates to:
  /// **'تلاش دوباره'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In fa, this message translates to:
  /// **'انصراف'**
  String get cancel;

  /// No description provided for @save.
  ///
  /// In fa, this message translates to:
  /// **'ذخیره'**
  String get save;

  /// No description provided for @confirm.
  ///
  /// In fa, this message translates to:
  /// **'تأیید'**
  String get confirm;

  /// No description provided for @close.
  ///
  /// In fa, this message translates to:
  /// **'بستن'**
  String get close;

  /// No description provided for @seeAll.
  ///
  /// In fa, this message translates to:
  /// **'مشاهده همه'**
  String get seeAll;

  /// No description provided for @more.
  ///
  /// In fa, this message translates to:
  /// **'بیشتر'**
  String get more;

  /// No description provided for @search.
  ///
  /// In fa, this message translates to:
  /// **'جستجو'**
  String get search;

  /// No description provided for @filterAll.
  ///
  /// In fa, this message translates to:
  /// **'همه'**
  String get filterAll;

  /// No description provided for @today.
  ///
  /// In fa, this message translates to:
  /// **'امروز'**
  String get today;

  /// No description provided for @yesterday.
  ///
  /// In fa, this message translates to:
  /// **'دیروز'**
  String get yesterday;

  /// No description provided for @tomorrow.
  ///
  /// In fa, this message translates to:
  /// **'فردا'**
  String get tomorrow;

  /// No description provided for @justNow.
  ///
  /// In fa, this message translates to:
  /// **'همین الان'**
  String get justNow;

  /// No description provided for @minutesAgo.
  ///
  /// In fa, this message translates to:
  /// **'{n} دقیقه پیش'**
  String minutesAgo(String n);

  /// No description provided for @hoursAgo.
  ///
  /// In fa, this message translates to:
  /// **'{n} ساعت پیش'**
  String hoursAgo(String n);

  /// No description provided for @daysAgo.
  ///
  /// In fa, this message translates to:
  /// **'{n} روز پیش'**
  String daysAgo(String n);

  /// No description provided for @minutesValue.
  ///
  /// In fa, this message translates to:
  /// **'{n} دقیقه'**
  String minutesValue(String n);

  /// No description provided for @currencyRial.
  ///
  /// In fa, this message translates to:
  /// **'ریال'**
  String get currencyRial;

  /// No description provided for @optional.
  ///
  /// In fa, this message translates to:
  /// **'اختیاری'**
  String get optional;

  /// No description provided for @requiredField.
  ///
  /// In fa, this message translates to:
  /// **'این فیلد الزامی است'**
  String get requiredField;

  /// No description provided for @invalidNumber.
  ///
  /// In fa, this message translates to:
  /// **'عدد معتبر وارد کنید'**
  String get invalidNumber;

  /// No description provided for @savedSuccessfully.
  ///
  /// In fa, this message translates to:
  /// **'با موفقیت ذخیره شد'**
  String get savedSuccessfully;

  /// No description provided for @signOut.
  ///
  /// In fa, this message translates to:
  /// **'خروج از حساب'**
  String get signOut;

  /// No description provided for @signOutConfirm.
  ///
  /// In fa, this message translates to:
  /// **'از حساب کاربری خارج می‌شوید؟'**
  String get signOutConfirm;

  /// No description provided for @errorGeneric.
  ///
  /// In fa, this message translates to:
  /// **'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.'**
  String get errorGeneric;

  /// No description provided for @errorNetwork.
  ///
  /// In fa, this message translates to:
  /// **'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'**
  String get errorNetwork;

  /// No description provided for @errorPermission.
  ///
  /// In fa, this message translates to:
  /// **'شما مجوز انجام این عملیات را ندارید.'**
  String get errorPermission;

  /// No description provided for @errorNotFound.
  ///
  /// In fa, this message translates to:
  /// **'مورد درخواستی یافت نشد.'**
  String get errorNotFound;

  /// No description provided for @errorSessionExpired.
  ///
  /// In fa, this message translates to:
  /// **'نشست شما منقضی شده است. دوباره وارد شوید.'**
  String get errorSessionExpired;

  /// No description provided for @errorUnsupported.
  ///
  /// In fa, this message translates to:
  /// **'این قابلیت در این نسخه فعال نیست.'**
  String get errorUnsupported;

  /// No description provided for @errorValidation.
  ///
  /// In fa, this message translates to:
  /// **'اطلاعات وارد شده معتبر نیست.'**
  String get errorValidation;

  /// No description provided for @errorRoomStatusChanged.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت اتاق هم‌زمان توسط شخص دیگری تغییر کرده است.'**
  String get errorRoomStatusChanged;

  /// No description provided for @errorInsufficientStock.
  ///
  /// In fa, this message translates to:
  /// **'موجودی کافی نیست.'**
  String get errorInsufficientStock;

  /// No description provided for @errorOccupiedExceeds.
  ///
  /// In fa, this message translates to:
  /// **'تعداد اتاق‌های اشغال بیش از اتاق‌های قابل فروش است.'**
  String get errorOccupiedExceeds;

  /// No description provided for @errorNationalIdExists.
  ///
  /// In fa, this message translates to:
  /// **'کاربری با این کد ملی قبلاً ثبت شده است.'**
  String get errorNationalIdExists;

  /// No description provided for @errorTaskChanged.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت این وظیفه تغییر کرده است.'**
  String get errorTaskChanged;

  /// No description provided for @emptyGeneric.
  ///
  /// In fa, this message translates to:
  /// **'موردی برای نمایش وجود ندارد.'**
  String get emptyGeneric;

  /// No description provided for @loginTitle.
  ///
  /// In fa, this message translates to:
  /// **'ورود به سامانه'**
  String get loginTitle;

  /// No description provided for @loginSubtitle.
  ///
  /// In fa, this message translates to:
  /// **'با کد ملی و رمز عبوری که مدیر سیستم برای شما تعریف کرده وارد شوید.'**
  String get loginSubtitle;

  /// No description provided for @nationalIdLabel.
  ///
  /// In fa, this message translates to:
  /// **'کد ملی'**
  String get nationalIdLabel;

  /// No description provided for @nationalIdHint.
  ///
  /// In fa, this message translates to:
  /// **'۱۰ رقم بدون خط تیره'**
  String get nationalIdHint;

  /// No description provided for @nationalIdInvalid.
  ///
  /// In fa, this message translates to:
  /// **'کد ملی معتبر نیست'**
  String get nationalIdInvalid;

  /// No description provided for @passwordLabel.
  ///
  /// In fa, this message translates to:
  /// **'رمز عبور'**
  String get passwordLabel;

  /// No description provided for @passwordRequired.
  ///
  /// In fa, this message translates to:
  /// **'رمز عبور را وارد کنید'**
  String get passwordRequired;

  /// No description provided for @loginButton.
  ///
  /// In fa, this message translates to:
  /// **'ورود'**
  String get loginButton;

  /// No description provided for @showPassword.
  ///
  /// In fa, this message translates to:
  /// **'نمایش رمز'**
  String get showPassword;

  /// No description provided for @hidePassword.
  ///
  /// In fa, this message translates to:
  /// **'پنهان کردن رمز'**
  String get hidePassword;

  /// No description provided for @errorInvalidCredentials.
  ///
  /// In fa, this message translates to:
  /// **'کد ملی یا رمز عبور نادرست است.'**
  String get errorInvalidCredentials;

  /// No description provided for @errorAccountDisabled.
  ///
  /// In fa, this message translates to:
  /// **'حساب شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.'**
  String get errorAccountDisabled;

  /// No description provided for @errorNotProvisioned.
  ///
  /// In fa, this message translates to:
  /// **'نقش یا هتل برای حساب شما تعریف نشده است.'**
  String get errorNotProvisioned;

  /// No description provided for @errorTooManyRequests.
  ///
  /// In fa, this message translates to:
  /// **'تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره تلاش کنید.'**
  String get errorTooManyRequests;

  /// No description provided for @forgotPasswordHint.
  ///
  /// In fa, this message translates to:
  /// **'برای بازیابی رمز عبور با مدیر سیستم هتل تماس بگیرید.'**
  String get forgotPasswordHint;

  /// No description provided for @demoAccountsTitle.
  ///
  /// In fa, this message translates to:
  /// **'ورود سریع با حساب نمایشی'**
  String get demoAccountsTitle;

  /// No description provided for @demoAccountsHint.
  ///
  /// In fa, this message translates to:
  /// **'هر نقش، داشبورد و دسترسی‌های مخصوص به خود را می‌بیند.'**
  String get demoAccountsHint;

  /// No description provided for @demoPasswordNote.
  ///
  /// In fa, this message translates to:
  /// **'رمز همه حساب‌ها: {password}'**
  String demoPasswordNote(String password);

  /// No description provided for @loginFooter.
  ///
  /// In fa, this message translates to:
  /// **'دسترسی هر کاربر بر اساس نقش او در سرور کنترل می‌شود.'**
  String get loginFooter;

  /// No description provided for @changePasswordTitle.
  ///
  /// In fa, this message translates to:
  /// **'تغییر رمز عبور'**
  String get changePasswordTitle;

  /// No description provided for @mustChangePasswordInfo.
  ///
  /// In fa, this message translates to:
  /// **'برای امنیت حساب، رمز موقت خود را تغییر دهید.'**
  String get mustChangePasswordInfo;

  /// No description provided for @currentPassword.
  ///
  /// In fa, this message translates to:
  /// **'رمز فعلی'**
  String get currentPassword;

  /// No description provided for @newPassword.
  ///
  /// In fa, this message translates to:
  /// **'رمز جدید'**
  String get newPassword;

  /// No description provided for @confirmPassword.
  ///
  /// In fa, this message translates to:
  /// **'تکرار رمز جدید'**
  String get confirmPassword;

  /// No description provided for @passwordTooWeak.
  ///
  /// In fa, this message translates to:
  /// **'حداقل ۸ کاراکتر شامل حرف و عدد'**
  String get passwordTooWeak;

  /// No description provided for @passwordsDontMatch.
  ///
  /// In fa, this message translates to:
  /// **'رمزها یکسان نیستند'**
  String get passwordsDontMatch;

  /// No description provided for @passwordChanged.
  ///
  /// In fa, this message translates to:
  /// **'رمز عبور تغییر کرد'**
  String get passwordChanged;

  /// No description provided for @accessDeniedTitle.
  ///
  /// In fa, this message translates to:
  /// **'دسترسی مجاز نیست'**
  String get accessDeniedTitle;

  /// No description provided for @accessDeniedBody.
  ///
  /// In fa, this message translates to:
  /// **'این بخش برای نقش شما فعال نیست. اگر فکر می‌کنید به آن نیاز دارید، با مدیر خود هماهنگ کنید.'**
  String get accessDeniedBody;

  /// No description provided for @goHome.
  ///
  /// In fa, this message translates to:
  /// **'بازگشت به خانه'**
  String get goHome;

  /// No description provided for @sessionTimedOut.
  ///
  /// In fa, this message translates to:
  /// **'به دلیل عدم فعالیت از حساب خارج شدید.'**
  String get sessionTimedOut;

  /// No description provided for @navHome.
  ///
  /// In fa, this message translates to:
  /// **'خانه'**
  String get navHome;

  /// No description provided for @navDashboard.
  ///
  /// In fa, this message translates to:
  /// **'داشبورد'**
  String get navDashboard;

  /// No description provided for @navMyWork.
  ///
  /// In fa, this message translates to:
  /// **'کارهای من'**
  String get navMyWork;

  /// No description provided for @navRooms.
  ///
  /// In fa, this message translates to:
  /// **'اتاق‌ها'**
  String get navRooms;

  /// No description provided for @navHousekeeping.
  ///
  /// In fa, this message translates to:
  /// **'خانه‌داری'**
  String get navHousekeeping;

  /// No description provided for @navMaintenance.
  ///
  /// In fa, this message translates to:
  /// **'تعمیرات'**
  String get navMaintenance;

  /// No description provided for @navEnergy.
  ///
  /// In fa, this message translates to:
  /// **'انرژی'**
  String get navEnergy;

  /// No description provided for @navInventory.
  ///
  /// In fa, this message translates to:
  /// **'انبار'**
  String get navInventory;

  /// No description provided for @navStaff.
  ///
  /// In fa, this message translates to:
  /// **'کارکنان'**
  String get navStaff;

  /// No description provided for @navReports.
  ///
  /// In fa, this message translates to:
  /// **'گزارش‌ها'**
  String get navReports;

  /// No description provided for @navNotifications.
  ///
  /// In fa, this message translates to:
  /// **'اعلان‌ها'**
  String get navNotifications;

  /// No description provided for @navInsights.
  ///
  /// In fa, this message translates to:
  /// **'پیشنهادهای هوشمند'**
  String get navInsights;

  /// No description provided for @navAssistant.
  ///
  /// In fa, this message translates to:
  /// **'دستیار هوشمند'**
  String get navAssistant;

  /// No description provided for @navUsers.
  ///
  /// In fa, this message translates to:
  /// **'کاربران'**
  String get navUsers;

  /// No description provided for @navProfile.
  ///
  /// In fa, this message translates to:
  /// **'حساب کاربری'**
  String get navProfile;

  /// No description provided for @navDailyOps.
  ///
  /// In fa, this message translates to:
  /// **'آمار روزانه'**
  String get navDailyOps;

  /// No description provided for @navMore.
  ///
  /// In fa, this message translates to:
  /// **'بیشتر'**
  String get navMore;

  /// No description provided for @roleSuperAdmin.
  ///
  /// In fa, this message translates to:
  /// **'مدیر سامانه'**
  String get roleSuperAdmin;

  /// No description provided for @roleHotelOwner.
  ///
  /// In fa, this message translates to:
  /// **'مالک هتل'**
  String get roleHotelOwner;

  /// No description provided for @roleGeneralManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر کل هتل'**
  String get roleGeneralManager;

  /// No description provided for @roleOperationsManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر عملیات'**
  String get roleOperationsManager;

  /// No description provided for @roleEnergyManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر انرژی'**
  String get roleEnergyManager;

  /// No description provided for @roleMaintenanceManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر تعمیرات'**
  String get roleMaintenanceManager;

  /// No description provided for @roleHousekeepingManager.
  ///
  /// In fa, this message translates to:
  /// **'سرپرست خانه‌داری'**
  String get roleHousekeepingManager;

  /// No description provided for @roleRestaurantManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر رستوران'**
  String get roleRestaurantManager;

  /// No description provided for @roleInventoryManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر انبار'**
  String get roleInventoryManager;

  /// No description provided for @roleHrManager.
  ///
  /// In fa, this message translates to:
  /// **'مدیر منابع انسانی'**
  String get roleHrManager;

  /// No description provided for @roleReceptionStaff.
  ///
  /// In fa, this message translates to:
  /// **'کارمند پذیرش'**
  String get roleReceptionStaff;

  /// No description provided for @roleHousekeepingStaff.
  ///
  /// In fa, this message translates to:
  /// **'کارمند خانه‌داری'**
  String get roleHousekeepingStaff;

  /// No description provided for @roleMaintenanceStaff.
  ///
  /// In fa, this message translates to:
  /// **'تکنسین تعمیرات'**
  String get roleMaintenanceStaff;

  /// No description provided for @roleRestaurantStaff.
  ///
  /// In fa, this message translates to:
  /// **'کارمند رستوران'**
  String get roleRestaurantStaff;

  /// No description provided for @roleAnalyst.
  ///
  /// In fa, this message translates to:
  /// **'تحلیلگر'**
  String get roleAnalyst;

  /// No description provided for @deptManagement.
  ///
  /// In fa, this message translates to:
  /// **'مدیریت'**
  String get deptManagement;

  /// No description provided for @deptFrontOffice.
  ///
  /// In fa, this message translates to:
  /// **'پذیرش'**
  String get deptFrontOffice;

  /// No description provided for @deptHousekeeping.
  ///
  /// In fa, this message translates to:
  /// **'خانه‌داری'**
  String get deptHousekeeping;

  /// No description provided for @deptMaintenance.
  ///
  /// In fa, this message translates to:
  /// **'تعمیرات'**
  String get deptMaintenance;

  /// No description provided for @deptEnergy.
  ///
  /// In fa, this message translates to:
  /// **'انرژی'**
  String get deptEnergy;

  /// No description provided for @deptFoodAndBeverage.
  ///
  /// In fa, this message translates to:
  /// **'رستوران و غذا'**
  String get deptFoodAndBeverage;

  /// No description provided for @deptInventory.
  ///
  /// In fa, this message translates to:
  /// **'انبار'**
  String get deptInventory;

  /// No description provided for @deptHumanResources.
  ///
  /// In fa, this message translates to:
  /// **'منابع انسانی'**
  String get deptHumanResources;

  /// No description provided for @deptAnalytics.
  ///
  /// In fa, this message translates to:
  /// **'تحلیل داده'**
  String get deptAnalytics;

  /// No description provided for @greetingMorning.
  ///
  /// In fa, this message translates to:
  /// **'صبح بخیر، {name}'**
  String greetingMorning(String name);

  /// No description provided for @greetingAfternoon.
  ///
  /// In fa, this message translates to:
  /// **'ظهر بخیر، {name}'**
  String greetingAfternoon(String name);

  /// No description provided for @greetingEvening.
  ///
  /// In fa, this message translates to:
  /// **'عصر بخیر، {name}'**
  String greetingEvening(String name);

  /// No description provided for @dashboardSubtitle.
  ///
  /// In fa, this message translates to:
  /// **'تصویر لحظه‌ای عملکرد {hotel}'**
  String dashboardSubtitle(String hotel);

  /// No description provided for @opsDashboardSubtitle.
  ///
  /// In fa, this message translates to:
  /// **'کنسول {department}'**
  String opsDashboardSubtitle(String department);

  /// No description provided for @kpiOccupancy.
  ///
  /// In fa, this message translates to:
  /// **'نرخ اشغال'**
  String get kpiOccupancy;

  /// No description provided for @kpiAdr.
  ///
  /// In fa, this message translates to:
  /// **'ADR (نرخ میانگین)'**
  String get kpiAdr;

  /// No description provided for @kpiRevpar.
  ///
  /// In fa, this message translates to:
  /// **'RevPAR (هر اتاق)'**
  String get kpiRevpar;

  /// No description provided for @kpiRevenue.
  ///
  /// In fa, this message translates to:
  /// **'درآمد دیروز'**
  String get kpiRevenue;

  /// No description provided for @kpiElectricity.
  ///
  /// In fa, this message translates to:
  /// **'مصرف برق دیروز'**
  String get kpiElectricity;

  /// No description provided for @kpiEnergyIntensity.
  ///
  /// In fa, this message translates to:
  /// **'شدت مصرف برق'**
  String get kpiEnergyIntensity;

  /// No description provided for @kpiEnergyIntensityUnit.
  ///
  /// In fa, this message translates to:
  /// **'kWh به ازای اتاق اشغال'**
  String get kpiEnergyIntensityUnit;

  /// No description provided for @kpiOpenTickets.
  ///
  /// In fa, this message translates to:
  /// **'خرابی‌های باز'**
  String get kpiOpenTickets;

  /// No description provided for @kpiOverdueTickets.
  ///
  /// In fa, this message translates to:
  /// **'{n} مورد خارج از SLA'**
  String kpiOverdueTickets(String n);

  /// No description provided for @kpiRoomsReady.
  ///
  /// In fa, this message translates to:
  /// **'اتاق آماده فروش'**
  String get kpiRoomsReady;

  /// No description provided for @kpiRoomsToClean.
  ///
  /// In fa, this message translates to:
  /// **'{n} در انتظار نظافت'**
  String kpiRoomsToClean(String n);

  /// No description provided for @kpiStaffOnDuty.
  ///
  /// In fa, this message translates to:
  /// **'کارکنان حاضر'**
  String get kpiStaffOnDuty;

  /// No description provided for @kpiHousekeeping.
  ///
  /// In fa, this message translates to:
  /// **'پیشرفت خانه‌داری'**
  String get kpiHousekeeping;

  /// No description provided for @kpiLowStock.
  ///
  /// In fa, this message translates to:
  /// **'اقلام زیر نقطه سفارش'**
  String get kpiLowStock;

  /// No description provided for @vsLastWeek.
  ///
  /// In fa, this message translates to:
  /// **'{value} نسبت به هفته قبل'**
  String vsLastWeek(String value);

  /// No description provided for @vsBaselineShort.
  ///
  /// In fa, this message translates to:
  /// **'{value} نسبت به خط مبنا'**
  String vsBaselineShort(String value);

  /// No description provided for @sectionAlerts.
  ///
  /// In fa, this message translates to:
  /// **'هشدارها'**
  String get sectionAlerts;

  /// No description provided for @sectionInsights.
  ///
  /// In fa, this message translates to:
  /// **'پیشنهادهای هوشمند'**
  String get sectionInsights;

  /// No description provided for @sectionRoomStatus.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت اتاق‌ها'**
  String get sectionRoomStatus;

  /// No description provided for @sectionOccupancyTrend.
  ///
  /// In fa, this message translates to:
  /// **'روند اشغال — ۱۴ روز اخیر'**
  String get sectionOccupancyTrend;

  /// No description provided for @sectionEnergyTrend.
  ///
  /// In fa, this message translates to:
  /// **'روند مصرف برق — ۱۴ روز اخیر'**
  String get sectionEnergyTrend;

  /// No description provided for @sectionRequests.
  ///
  /// In fa, this message translates to:
  /// **'درخواست‌های تعمیر باز'**
  String get sectionRequests;

  /// No description provided for @sectionToday.
  ///
  /// In fa, this message translates to:
  /// **'امروز'**
  String get sectionToday;

  /// No description provided for @noAlerts.
  ///
  /// In fa, this message translates to:
  /// **'هشدار فعالی وجود ندارد.'**
  String get noAlerts;

  /// No description provided for @acknowledge.
  ///
  /// In fa, this message translates to:
  /// **'تأیید دریافت'**
  String get acknowledge;

  /// No description provided for @acknowledgedBy.
  ///
  /// In fa, this message translates to:
  /// **'تأیید شده توسط {name}'**
  String acknowledgedBy(String name);

  /// No description provided for @baselineLegend.
  ///
  /// In fa, this message translates to:
  /// **'خط مبنا'**
  String get baselineLegend;

  /// No description provided for @myWorkTitle.
  ///
  /// In fa, this message translates to:
  /// **'کارهای من'**
  String get myWorkTitle;

  /// No description provided for @myWorkProgress.
  ///
  /// In fa, this message translates to:
  /// **'{done} از {total} کار امروز انجام شده'**
  String myWorkProgress(String done, String total);

  /// No description provided for @shiftToday.
  ///
  /// In fa, this message translates to:
  /// **'شیفت امروز: {start} تا {end}'**
  String shiftToday(String start, String end);

  /// No description provided for @noShiftToday.
  ///
  /// In fa, this message translates to:
  /// **'امروز شیفتی برای شما ثبت نشده است.'**
  String get noShiftToday;

  /// No description provided for @quickActions.
  ///
  /// In fa, this message translates to:
  /// **'اقدام سریع'**
  String get quickActions;

  /// No description provided for @actionReportFault.
  ///
  /// In fa, this message translates to:
  /// **'گزارش خرابی'**
  String get actionReportFault;

  /// No description provided for @actionRooms.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت اتاق‌ها'**
  String get actionRooms;

  /// No description provided for @actionMyTickets.
  ///
  /// In fa, this message translates to:
  /// **'تیکت‌های من'**
  String get actionMyTickets;

  /// No description provided for @actionRecordDaily.
  ///
  /// In fa, this message translates to:
  /// **'ثبت آمار امروز'**
  String get actionRecordDaily;

  /// No description provided for @allTasksDone.
  ///
  /// In fa, this message translates to:
  /// **'همه کارهای امروز انجام شد. خسته نباشید!'**
  String get allTasksDone;

  /// No description provided for @nextTask.
  ///
  /// In fa, this message translates to:
  /// **'کار بعدی'**
  String get nextTask;

  /// No description provided for @roomsTitle.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت اتاق‌ها'**
  String get roomsTitle;

  /// No description provided for @roomLabel.
  ///
  /// In fa, this message translates to:
  /// **'اتاق {number}'**
  String roomLabel(String number);

  /// No description provided for @floorLabel.
  ///
  /// In fa, this message translates to:
  /// **'طبقه {n}'**
  String floorLabel(String n);

  /// No description provided for @roomStatusVacantClean.
  ///
  /// In fa, this message translates to:
  /// **'آماده'**
  String get roomStatusVacantClean;

  /// No description provided for @roomStatusVacantDirty.
  ///
  /// In fa, this message translates to:
  /// **'نیاز به نظافت'**
  String get roomStatusVacantDirty;

  /// No description provided for @roomStatusCleaningInProgress.
  ///
  /// In fa, this message translates to:
  /// **'در حال نظافت'**
  String get roomStatusCleaningInProgress;

  /// No description provided for @roomStatusOccupied.
  ///
  /// In fa, this message translates to:
  /// **'اشغال'**
  String get roomStatusOccupied;

  /// No description provided for @roomStatusOutOfOrder.
  ///
  /// In fa, this message translates to:
  /// **'تعمیر'**
  String get roomStatusOutOfOrder;

  /// No description provided for @roomTypeSingle.
  ///
  /// In fa, this message translates to:
  /// **'یک‌تخته'**
  String get roomTypeSingle;

  /// No description provided for @roomTypeDouble.
  ///
  /// In fa, this message translates to:
  /// **'دوتخته'**
  String get roomTypeDouble;

  /// No description provided for @roomTypeTwin.
  ///
  /// In fa, this message translates to:
  /// **'دو تخت جدا'**
  String get roomTypeTwin;

  /// No description provided for @roomTypeSuite.
  ///
  /// In fa, this message translates to:
  /// **'سوئیت'**
  String get roomTypeSuite;

  /// No description provided for @roomTypeDeluxe.
  ///
  /// In fa, this message translates to:
  /// **'دلوکس'**
  String get roomTypeDeluxe;

  /// No description provided for @changeStatus.
  ///
  /// In fa, this message translates to:
  /// **'تغییر وضعیت'**
  String get changeStatus;

  /// No description provided for @changeStatusTo.
  ///
  /// In fa, this message translates to:
  /// **'تغییر به «{status}»'**
  String changeStatusTo(String status);

  /// No description provided for @statusUpdated.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت به‌روزرسانی شد'**
  String get statusUpdated;

  /// No description provided for @noAllowedTransitions.
  ///
  /// In fa, this message translates to:
  /// **'تغییر وضعیت این اتاق برای نقش شما مجاز نیست.'**
  String get noAllowedTransitions;

  /// No description provided for @lastUpdatedBy.
  ///
  /// In fa, this message translates to:
  /// **'آخرین تغییر {time} توسط {name}'**
  String lastUpdatedBy(String time, String name);

  /// No description provided for @roomsCount.
  ///
  /// In fa, this message translates to:
  /// **'{n} اتاق'**
  String roomsCount(String n);

  /// No description provided for @reportFaultForRoom.
  ///
  /// In fa, this message translates to:
  /// **'گزارش خرابی برای این اتاق'**
  String get reportFaultForRoom;

  /// No description provided for @roomTasks.
  ///
  /// In fa, this message translates to:
  /// **'وظایف خانه‌داری امروز'**
  String get roomTasks;

  /// No description provided for @hkTitle.
  ///
  /// In fa, this message translates to:
  /// **'خانه‌داری'**
  String get hkTitle;

  /// No description provided for @hkMyTasks.
  ///
  /// In fa, this message translates to:
  /// **'وظایف من'**
  String get hkMyTasks;

  /// No description provided for @hkAllTasks.
  ///
  /// In fa, this message translates to:
  /// **'همه وظایف'**
  String get hkAllTasks;

  /// No description provided for @taskTypeCheckoutClean.
  ///
  /// In fa, this message translates to:
  /// **'نظافت پس از تخلیه'**
  String get taskTypeCheckoutClean;

  /// No description provided for @taskTypeStayoverClean.
  ///
  /// In fa, this message translates to:
  /// **'نظافت روزانه'**
  String get taskTypeStayoverClean;

  /// No description provided for @taskTypeDeepClean.
  ///
  /// In fa, this message translates to:
  /// **'نظافت عمیق'**
  String get taskTypeDeepClean;

  /// No description provided for @taskTypeInspection.
  ///
  /// In fa, this message translates to:
  /// **'بازرسی'**
  String get taskTypeInspection;

  /// No description provided for @taskTypeTurndown.
  ///
  /// In fa, this message translates to:
  /// **'آماده‌سازی شبانه'**
  String get taskTypeTurndown;

  /// No description provided for @taskStatusPending.
  ///
  /// In fa, this message translates to:
  /// **'در انتظار'**
  String get taskStatusPending;

  /// No description provided for @taskStatusInProgress.
  ///
  /// In fa, this message translates to:
  /// **'در حال انجام'**
  String get taskStatusInProgress;

  /// No description provided for @taskStatusDone.
  ///
  /// In fa, this message translates to:
  /// **'انجام شد'**
  String get taskStatusDone;

  /// No description provided for @taskStatusCancelled.
  ///
  /// In fa, this message translates to:
  /// **'لغو شد'**
  String get taskStatusCancelled;

  /// No description provided for @priorityLow.
  ///
  /// In fa, this message translates to:
  /// **'کم'**
  String get priorityLow;

  /// No description provided for @priorityNormal.
  ///
  /// In fa, this message translates to:
  /// **'عادی'**
  String get priorityNormal;

  /// No description provided for @priorityHigh.
  ///
  /// In fa, this message translates to:
  /// **'بالا'**
  String get priorityHigh;

  /// No description provided for @priorityUrgent.
  ///
  /// In fa, this message translates to:
  /// **'فوری'**
  String get priorityUrgent;

  /// No description provided for @startTask.
  ///
  /// In fa, this message translates to:
  /// **'شروع کار'**
  String get startTask;

  /// No description provided for @completeTask.
  ///
  /// In fa, this message translates to:
  /// **'اتمام و ثبت'**
  String get completeTask;

  /// No description provided for @taskStarted.
  ///
  /// In fa, this message translates to:
  /// **'کار شروع شد'**
  String get taskStarted;

  /// No description provided for @taskCompleted.
  ///
  /// In fa, this message translates to:
  /// **'کار ثبت شد. اتاق آماده است.'**
  String get taskCompleted;

  /// No description provided for @taskDuration.
  ///
  /// In fa, this message translates to:
  /// **'مدت انجام: {minutes} دقیقه'**
  String taskDuration(String minutes);

  /// No description provided for @taskElapsed.
  ///
  /// In fa, this message translates to:
  /// **'سپری‌شده: {minutes} دقیقه'**
  String taskElapsed(String minutes);

  /// No description provided for @taskTarget.
  ///
  /// In fa, this message translates to:
  /// **'هدف: {minutes} دقیقه'**
  String taskTarget(String minutes);

  /// No description provided for @dueBy.
  ///
  /// In fa, this message translates to:
  /// **'مهلت: {time}'**
  String dueBy(String time);

  /// No description provided for @assignee.
  ///
  /// In fa, this message translates to:
  /// **'مسئول'**
  String get assignee;

  /// No description provided for @unassigned.
  ///
  /// In fa, this message translates to:
  /// **'تخصیص‌نیافته'**
  String get unassigned;

  /// No description provided for @newTask.
  ///
  /// In fa, this message translates to:
  /// **'وظیفه جدید'**
  String get newTask;

  /// No description provided for @selectRoom.
  ///
  /// In fa, this message translates to:
  /// **'انتخاب اتاق'**
  String get selectRoom;

  /// No description provided for @selectAssignee.
  ///
  /// In fa, this message translates to:
  /// **'انتخاب مسئول'**
  String get selectAssignee;

  /// No description provided for @taskTypeLabel.
  ///
  /// In fa, this message translates to:
  /// **'نوع کار'**
  String get taskTypeLabel;

  /// No description provided for @priorityLabel.
  ///
  /// In fa, this message translates to:
  /// **'اولویت'**
  String get priorityLabel;

  /// No description provided for @notesLabel.
  ///
  /// In fa, this message translates to:
  /// **'توضیحات'**
  String get notesLabel;

  /// No description provided for @createTask.
  ///
  /// In fa, this message translates to:
  /// **'ایجاد وظیفه'**
  String get createTask;

  /// No description provided for @taskCreated.
  ///
  /// In fa, this message translates to:
  /// **'وظیفه ایجاد شد'**
  String get taskCreated;

  /// No description provided for @noTasksToday.
  ///
  /// In fa, this message translates to:
  /// **'برای امروز وظیفه‌ای ثبت نشده است.'**
  String get noTasksToday;

  /// No description provided for @overdue.
  ///
  /// In fa, this message translates to:
  /// **'تأخیر'**
  String get overdue;

  /// No description provided for @completionNotesHint.
  ///
  /// In fa, this message translates to:
  /// **'نکته‌ای برای سرپرست (اختیاری)'**
  String get completionNotesHint;

  /// No description provided for @mntTitle.
  ///
  /// In fa, this message translates to:
  /// **'تعمیرات و نگهداری'**
  String get mntTitle;

  /// No description provided for @mntNewTicket.
  ///
  /// In fa, this message translates to:
  /// **'ثبت خرابی'**
  String get mntNewTicket;

  /// No description provided for @ticketTitleLabel.
  ///
  /// In fa, this message translates to:
  /// **'عنوان خرابی'**
  String get ticketTitleLabel;

  /// No description provided for @ticketTitleHint.
  ///
  /// In fa, this message translates to:
  /// **'مثلاً: کولر اتاق خنک نمی‌کند'**
  String get ticketTitleHint;

  /// No description provided for @ticketDescriptionLabel.
  ///
  /// In fa, this message translates to:
  /// **'شرح'**
  String get ticketDescriptionLabel;

  /// No description provided for @ticketCategoryLabel.
  ///
  /// In fa, this message translates to:
  /// **'دسته'**
  String get ticketCategoryLabel;

  /// No description provided for @ticketLocationLabel.
  ///
  /// In fa, this message translates to:
  /// **'محل'**
  String get ticketLocationLabel;

  /// No description provided for @locationRoom.
  ///
  /// In fa, this message translates to:
  /// **'اتاق'**
  String get locationRoom;

  /// No description provided for @locationArea.
  ///
  /// In fa, this message translates to:
  /// **'فضای عمومی'**
  String get locationArea;

  /// No description provided for @areaHint.
  ///
  /// In fa, this message translates to:
  /// **'مثلاً: لابی، آشپزخانه، موتورخانه'**
  String get areaHint;

  /// No description provided for @addPhoto.
  ///
  /// In fa, this message translates to:
  /// **'افزودن عکس'**
  String get addPhoto;

  /// No description provided for @takePhoto.
  ///
  /// In fa, this message translates to:
  /// **'گرفتن عکس'**
  String get takePhoto;

  /// No description provided for @chooseFromGallery.
  ///
  /// In fa, this message translates to:
  /// **'انتخاب از گالری'**
  String get chooseFromGallery;

  /// No description provided for @photosCount.
  ///
  /// In fa, this message translates to:
  /// **'{n} عکس پیوست شد'**
  String photosCount(String n);

  /// No description provided for @submitTicket.
  ///
  /// In fa, this message translates to:
  /// **'ثبت و ارسال'**
  String get submitTicket;

  /// No description provided for @ticketCreated.
  ///
  /// In fa, this message translates to:
  /// **'خرابی ثبت شد و به تیم تعمیرات اطلاع داده شد.'**
  String get ticketCreated;

  /// No description provided for @catHvac.
  ///
  /// In fa, this message translates to:
  /// **'تهویه و سرمایش'**
  String get catHvac;

  /// No description provided for @catElectrical.
  ///
  /// In fa, this message translates to:
  /// **'برق'**
  String get catElectrical;

  /// No description provided for @catPlumbing.
  ///
  /// In fa, this message translates to:
  /// **'لوله‌کشی'**
  String get catPlumbing;

  /// No description provided for @catFurniture.
  ///
  /// In fa, this message translates to:
  /// **'مبلمان'**
  String get catFurniture;

  /// No description provided for @catAppliance.
  ///
  /// In fa, this message translates to:
  /// **'تجهیزات'**
  String get catAppliance;

  /// No description provided for @catItNetwork.
  ///
  /// In fa, this message translates to:
  /// **'شبکه و IT'**
  String get catItNetwork;

  /// No description provided for @catStructural.
  ///
  /// In fa, this message translates to:
  /// **'ساختمانی'**
  String get catStructural;

  /// No description provided for @catOther.
  ///
  /// In fa, this message translates to:
  /// **'سایر'**
  String get catOther;

  /// No description provided for @tPriorityLow.
  ///
  /// In fa, this message translates to:
  /// **'کم'**
  String get tPriorityLow;

  /// No description provided for @tPriorityMedium.
  ///
  /// In fa, this message translates to:
  /// **'متوسط'**
  String get tPriorityMedium;

  /// No description provided for @tPriorityHigh.
  ///
  /// In fa, this message translates to:
  /// **'بالا'**
  String get tPriorityHigh;

  /// No description provided for @tPriorityCritical.
  ///
  /// In fa, this message translates to:
  /// **'بحرانی'**
  String get tPriorityCritical;

  /// No description provided for @tStatusOpen.
  ///
  /// In fa, this message translates to:
  /// **'باز'**
  String get tStatusOpen;

  /// No description provided for @tStatusAssigned.
  ///
  /// In fa, this message translates to:
  /// **'ارجاع شده'**
  String get tStatusAssigned;

  /// No description provided for @tStatusInProgress.
  ///
  /// In fa, this message translates to:
  /// **'در حال تعمیر'**
  String get tStatusInProgress;

  /// No description provided for @tStatusOnHold.
  ///
  /// In fa, this message translates to:
  /// **'متوقف'**
  String get tStatusOnHold;

  /// No description provided for @tStatusResolved.
  ///
  /// In fa, this message translates to:
  /// **'رفع شد'**
  String get tStatusResolved;

  /// No description provided for @tStatusClosed.
  ///
  /// In fa, this message translates to:
  /// **'بسته شد'**
  String get tStatusClosed;

  /// No description provided for @tStatusCancelled.
  ///
  /// In fa, this message translates to:
  /// **'لغو شد'**
  String get tStatusCancelled;

  /// No description provided for @slaDue.
  ///
  /// In fa, this message translates to:
  /// **'مهلت رفع: {time}'**
  String slaDue(String time);

  /// No description provided for @slaOverdue.
  ///
  /// In fa, this message translates to:
  /// **'خارج از SLA'**
  String get slaOverdue;

  /// No description provided for @assignTo.
  ///
  /// In fa, this message translates to:
  /// **'ارجاع به تکنسین'**
  String get assignTo;

  /// No description provided for @ticketAssigned.
  ///
  /// In fa, this message translates to:
  /// **'تیکت ارجاع شد'**
  String get ticketAssigned;

  /// No description provided for @reportedBy.
  ///
  /// In fa, this message translates to:
  /// **'گزارش‌دهنده: {name}'**
  String reportedBy(String name);

  /// No description provided for @timeline.
  ///
  /// In fa, this message translates to:
  /// **'تاریخچه'**
  String get timeline;

  /// No description provided for @eventCreated.
  ///
  /// In fa, this message translates to:
  /// **'ثبت شد'**
  String get eventCreated;

  /// No description provided for @eventAssigned.
  ///
  /// In fa, this message translates to:
  /// **'ارجاع به {name}'**
  String eventAssigned(String name);

  /// No description provided for @eventStatus.
  ///
  /// In fa, this message translates to:
  /// **'{from} ← {to}'**
  String eventStatus(String from, String to);

  /// No description provided for @eventComment.
  ///
  /// In fa, this message translates to:
  /// **'یادداشت'**
  String get eventComment;

  /// No description provided for @resolutionNoteHint.
  ///
  /// In fa, this message translates to:
  /// **'شرح اقدام انجام‌شده'**
  String get resolutionNoteHint;

  /// No description provided for @tabActive.
  ///
  /// In fa, this message translates to:
  /// **'فعال'**
  String get tabActive;

  /// No description provided for @tabMine.
  ///
  /// In fa, this message translates to:
  /// **'مربوط به من'**
  String get tabMine;

  /// No description provided for @tabAll.
  ///
  /// In fa, this message translates to:
  /// **'همه'**
  String get tabAll;

  /// No description provided for @noTickets.
  ///
  /// In fa, this message translates to:
  /// **'تیکتی وجود ندارد.'**
  String get noTickets;

  /// No description provided for @ticketStatusChanged.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت تیکت تغییر کرد'**
  String get ticketStatusChanged;

  /// No description provided for @energyTitle.
  ///
  /// In fa, this message translates to:
  /// **'مدیریت انرژی'**
  String get energyTitle;

  /// No description provided for @energyElectricity.
  ///
  /// In fa, this message translates to:
  /// **'برق'**
  String get energyElectricity;

  /// No description provided for @energyWater.
  ///
  /// In fa, this message translates to:
  /// **'آب'**
  String get energyWater;

  /// No description provided for @energyGas.
  ///
  /// In fa, this message translates to:
  /// **'گاز'**
  String get energyGas;

  /// No description provided for @recordReading.
  ///
  /// In fa, this message translates to:
  /// **'ثبت مصرف روزانه'**
  String get recordReading;

  /// No description provided for @consumptionLabel.
  ///
  /// In fa, this message translates to:
  /// **'مصرف روز ({unit})'**
  String consumptionLabel(String unit);

  /// No description provided for @meterValueLabel.
  ///
  /// In fa, this message translates to:
  /// **'عدد کنتور'**
  String get meterValueLabel;

  /// No description provided for @dateLabel.
  ///
  /// In fa, this message translates to:
  /// **'تاریخ'**
  String get dateLabel;

  /// No description provided for @readingSaved.
  ///
  /// In fa, this message translates to:
  /// **'مصرف ثبت شد'**
  String get readingSaved;

  /// No description provided for @last30Days.
  ///
  /// In fa, this message translates to:
  /// **'۳۰ روز اخیر'**
  String get last30Days;

  /// No description provided for @totalConsumption.
  ///
  /// In fa, this message translates to:
  /// **'مصرف کل'**
  String get totalConsumption;

  /// No description provided for @dailyAverage.
  ///
  /// In fa, this message translates to:
  /// **'میانگین روزانه'**
  String get dailyAverage;

  /// No description provided for @baseline.
  ///
  /// In fa, this message translates to:
  /// **'خط مبنا'**
  String get baseline;

  /// No description provided for @vsPreviousPeriod.
  ///
  /// In fa, this message translates to:
  /// **'{value} نسبت به دوره قبل'**
  String vsPreviousPeriod(String value);

  /// No description provided for @energyIntensity.
  ///
  /// In fa, this message translates to:
  /// **'شدت مصرف'**
  String get energyIntensity;

  /// No description provided for @perOccupiedRoom.
  ///
  /// In fa, this message translates to:
  /// **'{value} {unit} / اتاق اشغال'**
  String perOccupiedRoom(String value, String unit);

  /// No description provided for @estimatedCost.
  ///
  /// In fa, this message translates to:
  /// **'هزینه تخمینی'**
  String get estimatedCost;

  /// No description provided for @anomalyDays.
  ///
  /// In fa, this message translates to:
  /// **'{n} روز بالاتر از آستانه هشدار'**
  String anomalyDays(String n);

  /// No description provided for @noReadings.
  ///
  /// In fa, this message translates to:
  /// **'هنوز مصرفی ثبت نشده است.'**
  String get noReadings;

  /// No description provided for @energyInsightCta.
  ///
  /// In fa, this message translates to:
  /// **'تحلیل علت با دستیار هوشمند'**
  String get energyInsightCta;

  /// No description provided for @invTitle.
  ///
  /// In fa, this message translates to:
  /// **'انبار و موجودی'**
  String get invTitle;

  /// No description provided for @lowStock.
  ///
  /// In fa, this message translates to:
  /// **'کمبود'**
  String get lowStock;

  /// No description provided for @outOfStock.
  ///
  /// In fa, this message translates to:
  /// **'ناموجود'**
  String get outOfStock;

  /// No description provided for @onHand.
  ///
  /// In fa, this message translates to:
  /// **'موجودی'**
  String get onHand;

  /// No description provided for @reorderLevel.
  ///
  /// In fa, this message translates to:
  /// **'نقطه سفارش'**
  String get reorderLevel;

  /// No description provided for @stockValue.
  ///
  /// In fa, this message translates to:
  /// **'ارزش موجودی'**
  String get stockValue;

  /// No description provided for @recordMovement.
  ///
  /// In fa, this message translates to:
  /// **'ثبت ورود / خروج'**
  String get recordMovement;

  /// No description provided for @mvReceive.
  ///
  /// In fa, this message translates to:
  /// **'ورود به انبار'**
  String get mvReceive;

  /// No description provided for @mvIssue.
  ///
  /// In fa, this message translates to:
  /// **'خروج / مصرف'**
  String get mvIssue;

  /// No description provided for @mvAdjust.
  ///
  /// In fa, this message translates to:
  /// **'اصلاح موجودی'**
  String get mvAdjust;

  /// No description provided for @mvWaste.
  ///
  /// In fa, this message translates to:
  /// **'ضایعات'**
  String get mvWaste;

  /// No description provided for @quantityLabel.
  ///
  /// In fa, this message translates to:
  /// **'مقدار ({unit})'**
  String quantityLabel(String unit);

  /// No description provided for @reasonLabel.
  ///
  /// In fa, this message translates to:
  /// **'علت / مقصد'**
  String get reasonLabel;

  /// No description provided for @movementSaved.
  ///
  /// In fa, this message translates to:
  /// **'گردش کالا ثبت شد'**
  String get movementSaved;

  /// No description provided for @movements.
  ///
  /// In fa, this message translates to:
  /// **'گردش کالا'**
  String get movements;

  /// No description provided for @invCatGuestAmenities.
  ///
  /// In fa, this message translates to:
  /// **'اقلام مهمان'**
  String get invCatGuestAmenities;

  /// No description provided for @invCatLinen.
  ///
  /// In fa, this message translates to:
  /// **'البسه و ملحفه'**
  String get invCatLinen;

  /// No description provided for @invCatCleaningSupplies.
  ///
  /// In fa, this message translates to:
  /// **'مواد شوینده'**
  String get invCatCleaningSupplies;

  /// No description provided for @invCatFoodAndBeverage.
  ///
  /// In fa, this message translates to:
  /// **'غذا و نوشیدنی'**
  String get invCatFoodAndBeverage;

  /// No description provided for @invCatMaintenanceParts.
  ///
  /// In fa, this message translates to:
  /// **'قطعات فنی'**
  String get invCatMaintenanceParts;

  /// No description provided for @invCatOffice.
  ///
  /// In fa, this message translates to:
  /// **'اداری'**
  String get invCatOffice;

  /// No description provided for @invCatOther.
  ///
  /// In fa, this message translates to:
  /// **'سایر'**
  String get invCatOther;

  /// No description provided for @newItem.
  ///
  /// In fa, this message translates to:
  /// **'کالای جدید'**
  String get newItem;

  /// No description provided for @itemName.
  ///
  /// In fa, this message translates to:
  /// **'نام کالا'**
  String get itemName;

  /// No description provided for @skuLabel.
  ///
  /// In fa, this message translates to:
  /// **'کد کالا'**
  String get skuLabel;

  /// No description provided for @unitLabel.
  ///
  /// In fa, this message translates to:
  /// **'واحد'**
  String get unitLabel;

  /// No description provided for @initialQuantity.
  ///
  /// In fa, this message translates to:
  /// **'موجودی اولیه'**
  String get initialQuantity;

  /// No description provided for @unitCost.
  ///
  /// In fa, this message translates to:
  /// **'قیمت واحد (ریال)'**
  String get unitCost;

  /// No description provided for @locationLabel.
  ///
  /// In fa, this message translates to:
  /// **'محل نگهداری'**
  String get locationLabel;

  /// No description provided for @itemCreated.
  ///
  /// In fa, this message translates to:
  /// **'کالا تعریف شد'**
  String get itemCreated;

  /// No description provided for @filterLowStock.
  ///
  /// In fa, this message translates to:
  /// **'فقط کمبودها'**
  String get filterLowStock;

  /// No description provided for @noMovements.
  ///
  /// In fa, this message translates to:
  /// **'گردشی ثبت نشده است.'**
  String get noMovements;

  /// No description provided for @staffTitle.
  ///
  /// In fa, this message translates to:
  /// **'کارکنان و شیفت‌ها'**
  String get staffTitle;

  /// No description provided for @shiftsTab.
  ///
  /// In fa, this message translates to:
  /// **'شیفت‌ها'**
  String get shiftsTab;

  /// No description provided for @staffTab.
  ///
  /// In fa, this message translates to:
  /// **'کارکنان'**
  String get staffTab;

  /// No description provided for @shiftMorning.
  ///
  /// In fa, this message translates to:
  /// **'صبح'**
  String get shiftMorning;

  /// No description provided for @shiftEvening.
  ///
  /// In fa, this message translates to:
  /// **'عصر'**
  String get shiftEvening;

  /// No description provided for @shiftNight.
  ///
  /// In fa, this message translates to:
  /// **'شب'**
  String get shiftNight;

  /// No description provided for @shiftScheduled.
  ///
  /// In fa, this message translates to:
  /// **'برنامه‌ریزی شده'**
  String get shiftScheduled;

  /// No description provided for @shiftCheckedIn.
  ///
  /// In fa, this message translates to:
  /// **'حاضر'**
  String get shiftCheckedIn;

  /// No description provided for @shiftCompleted.
  ///
  /// In fa, this message translates to:
  /// **'پایان یافته'**
  String get shiftCompleted;

  /// No description provided for @shiftAbsent.
  ///
  /// In fa, this message translates to:
  /// **'غایب'**
  String get shiftAbsent;

  /// No description provided for @addShift.
  ///
  /// In fa, this message translates to:
  /// **'افزودن شیفت'**
  String get addShift;

  /// No description provided for @selectStaff.
  ///
  /// In fa, this message translates to:
  /// **'انتخاب کارمند'**
  String get selectStaff;

  /// No description provided for @shiftTypeLabel.
  ///
  /// In fa, this message translates to:
  /// **'نوبت کاری'**
  String get shiftTypeLabel;

  /// No description provided for @shiftCreated.
  ///
  /// In fa, this message translates to:
  /// **'شیفت ثبت شد'**
  String get shiftCreated;

  /// No description provided for @checkIn.
  ///
  /// In fa, this message translates to:
  /// **'ثبت حضور'**
  String get checkIn;

  /// No description provided for @checkOut.
  ///
  /// In fa, this message translates to:
  /// **'پایان شیفت'**
  String get checkOut;

  /// No description provided for @markAbsent.
  ///
  /// In fa, this message translates to:
  /// **'ثبت غیبت'**
  String get markAbsent;

  /// No description provided for @noShifts.
  ///
  /// In fa, this message translates to:
  /// **'شیفتی برای این روز ثبت نشده است.'**
  String get noShifts;

  /// No description provided for @onDutyCount.
  ///
  /// In fa, this message translates to:
  /// **'{n} نفر حاضر'**
  String onDutyCount(String n);

  /// No description provided for @noAppAccount.
  ///
  /// In fa, this message translates to:
  /// **'بدون حساب کاربری'**
  String get noAppAccount;

  /// No description provided for @dailyOpsTitle.
  ///
  /// In fa, this message translates to:
  /// **'ثبت آمار روزانه'**
  String get dailyOpsTitle;

  /// No description provided for @dailyOpsHint.
  ///
  /// In fa, this message translates to:
  /// **'تا پیش از اتصال به PMS، آمار اشغال و درآمد هر روز اینجا ثبت می‌شود.'**
  String get dailyOpsHint;

  /// No description provided for @roomsAvailable.
  ///
  /// In fa, this message translates to:
  /// **'اتاق قابل فروش'**
  String get roomsAvailable;

  /// No description provided for @roomsOccupied.
  ///
  /// In fa, this message translates to:
  /// **'اتاق فروخته‌شده'**
  String get roomsOccupied;

  /// No description provided for @guestsLabel.
  ///
  /// In fa, this message translates to:
  /// **'تعداد مهمان'**
  String get guestsLabel;

  /// No description provided for @roomRevenue.
  ///
  /// In fa, this message translates to:
  /// **'درآمد اتاق (ریال)'**
  String get roomRevenue;

  /// No description provided for @fnbRevenue.
  ///
  /// In fa, this message translates to:
  /// **'درآمد رستوران (ریال)'**
  String get fnbRevenue;

  /// No description provided for @otherRevenue.
  ///
  /// In fa, this message translates to:
  /// **'سایر درآمدها (ریال)'**
  String get otherRevenue;

  /// No description provided for @reportsTitle.
  ///
  /// In fa, this message translates to:
  /// **'گزارش‌ها'**
  String get reportsTitle;

  /// No description provided for @reportExecutive.
  ///
  /// In fa, this message translates to:
  /// **'خلاصه مدیریتی'**
  String get reportExecutive;

  /// No description provided for @reportEnergy.
  ///
  /// In fa, this message translates to:
  /// **'گزارش انرژی'**
  String get reportEnergy;

  /// No description provided for @reportMaintenance.
  ///
  /// In fa, this message translates to:
  /// **'گزارش تعمیرات'**
  String get reportMaintenance;

  /// No description provided for @reportHousekeeping.
  ///
  /// In fa, this message translates to:
  /// **'گزارش خانه‌داری'**
  String get reportHousekeeping;

  /// No description provided for @reportInventory.
  ///
  /// In fa, this message translates to:
  /// **'گزارش انبار'**
  String get reportInventory;

  /// No description provided for @reportPeriod.
  ///
  /// In fa, this message translates to:
  /// **'بازه گزارش'**
  String get reportPeriod;

  /// No description provided for @last7Days.
  ///
  /// In fa, this message translates to:
  /// **'۷ روز اخیر'**
  String get last7Days;

  /// No description provided for @generatePdf.
  ///
  /// In fa, this message translates to:
  /// **'تولید گزارش PDF'**
  String get generatePdf;

  /// No description provided for @generating.
  ///
  /// In fa, this message translates to:
  /// **'در حال تولید…'**
  String get generating;

  /// No description provided for @reportReady.
  ///
  /// In fa, this message translates to:
  /// **'گزارش آماده شد'**
  String get reportReady;

  /// No description provided for @recentReports.
  ///
  /// In fa, this message translates to:
  /// **'گزارش‌های اخیر'**
  String get recentReports;

  /// No description provided for @noReports.
  ///
  /// In fa, this message translates to:
  /// **'هنوز گزارشی تولید نشده است.'**
  String get noReports;

  /// No description provided for @reportBy.
  ///
  /// In fa, this message translates to:
  /// **'{date} — {name}'**
  String reportBy(String date, String name);

  /// No description provided for @notificationsTitle.
  ///
  /// In fa, this message translates to:
  /// **'اعلان‌ها'**
  String get notificationsTitle;

  /// No description provided for @markAllRead.
  ///
  /// In fa, this message translates to:
  /// **'علامت‌گذاری همه به‌عنوان خوانده‌شده'**
  String get markAllRead;

  /// No description provided for @noNotifications.
  ///
  /// In fa, this message translates to:
  /// **'اعلان تازه‌ای ندارید.'**
  String get noNotifications;

  /// No description provided for @severityInfo.
  ///
  /// In fa, this message translates to:
  /// **'اطلاع'**
  String get severityInfo;

  /// No description provided for @severityWarning.
  ///
  /// In fa, this message translates to:
  /// **'هشدار'**
  String get severityWarning;

  /// No description provided for @severityCritical.
  ///
  /// In fa, this message translates to:
  /// **'بحرانی'**
  String get severityCritical;

  /// No description provided for @insightsTitle.
  ///
  /// In fa, this message translates to:
  /// **'پیشنهادهای هوشمند'**
  String get insightsTitle;

  /// No description provided for @insightsSubtitle.
  ///
  /// In fa, this message translates to:
  /// **'تحلیل خودکار داده‌ها؛ تصمیم نهایی با مدیر است.'**
  String get insightsSubtitle;

  /// No description provided for @insCatEnergy.
  ///
  /// In fa, this message translates to:
  /// **'انرژی'**
  String get insCatEnergy;

  /// No description provided for @insCatMaintenance.
  ///
  /// In fa, this message translates to:
  /// **'نگهداری'**
  String get insCatMaintenance;

  /// No description provided for @insCatHousekeeping.
  ///
  /// In fa, this message translates to:
  /// **'خانه‌داری'**
  String get insCatHousekeeping;

  /// No description provided for @insCatInventory.
  ///
  /// In fa, this message translates to:
  /// **'انبار'**
  String get insCatInventory;

  /// No description provided for @insCatRevenue.
  ///
  /// In fa, this message translates to:
  /// **'درآمد'**
  String get insCatRevenue;

  /// No description provided for @insCatStaffing.
  ///
  /// In fa, this message translates to:
  /// **'نیروی انسانی'**
  String get insCatStaffing;

  /// No description provided for @confidenceLabel.
  ///
  /// In fa, this message translates to:
  /// **'اطمینان {value}'**
  String confidenceLabel(String value);

  /// No description provided for @estimatedSaving.
  ///
  /// In fa, this message translates to:
  /// **'صرفه‌جویی تخمینی ماهانه: {amount}'**
  String estimatedSaving(String amount);

  /// No description provided for @evidenceLabel.
  ///
  /// In fa, this message translates to:
  /// **'شواهد'**
  String get evidenceLabel;

  /// No description provided for @recommendationLabel.
  ///
  /// In fa, this message translates to:
  /// **'اقدام پیشنهادی'**
  String get recommendationLabel;

  /// No description provided for @acceptInsight.
  ///
  /// In fa, this message translates to:
  /// **'پذیرش'**
  String get acceptInsight;

  /// No description provided for @dismissInsight.
  ///
  /// In fa, this message translates to:
  /// **'رد'**
  String get dismissInsight;

  /// No description provided for @implementedInsight.
  ///
  /// In fa, this message translates to:
  /// **'اجرا شد'**
  String get implementedInsight;

  /// No description provided for @insightUpdated.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت پیشنهاد ثبت شد'**
  String get insightUpdated;

  /// No description provided for @noInsights.
  ///
  /// In fa, this message translates to:
  /// **'پیشنهاد فعالی وجود ندارد.'**
  String get noInsights;

  /// No description provided for @sourceRuleEngine.
  ///
  /// In fa, this message translates to:
  /// **'موتور تحلیل'**
  String get sourceRuleEngine;

  /// No description provided for @sourceLlm.
  ///
  /// In fa, this message translates to:
  /// **'هوش مصنوعی'**
  String get sourceLlm;

  /// No description provided for @assistantTitle.
  ///
  /// In fa, this message translates to:
  /// **'دستیار هوشمند'**
  String get assistantTitle;

  /// No description provided for @assistantWelcome.
  ///
  /// In fa, this message translates to:
  /// **'سلام! من دستیار تحلیلی زرین هستم. درباره انرژی، اتاق‌ها، تعمیرات، انبار یا درآمد هتل بپرسید.'**
  String get assistantWelcome;

  /// No description provided for @assistantHint.
  ///
  /// In fa, this message translates to:
  /// **'سؤال خود را بنویسید…'**
  String get assistantHint;

  /// No description provided for @assistantSuggestion1.
  ///
  /// In fa, this message translates to:
  /// **'چرا مصرف برق زیاد شده؟'**
  String get assistantSuggestion1;

  /// No description provided for @assistantSuggestion2.
  ///
  /// In fa, this message translates to:
  /// **'کدام بخش بیشترین اتلاف را دارد؟'**
  String get assistantSuggestion2;

  /// No description provided for @assistantSuggestion3.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت تعمیرات چطور است؟'**
  String get assistantSuggestion3;

  /// No description provided for @assistantSuggestion4.
  ///
  /// In fa, this message translates to:
  /// **'چه اقلامی رو به اتمام است؟'**
  String get assistantSuggestion4;

  /// No description provided for @assistantDisclaimer.
  ///
  /// In fa, this message translates to:
  /// **'پاسخ‌ها بر اساس داده‌های ثبت‌شده تولید می‌شوند؛ تصمیم نهایی با شماست.'**
  String get assistantDisclaimer;

  /// No description provided for @assistantError.
  ///
  /// In fa, this message translates to:
  /// **'پاسخ دریافت نشد. دوباره تلاش کنید.'**
  String get assistantError;

  /// No description provided for @basedOn.
  ///
  /// In fa, this message translates to:
  /// **'بر اساس داده‌ها:'**
  String get basedOn;

  /// No description provided for @send.
  ///
  /// In fa, this message translates to:
  /// **'ارسال'**
  String get send;

  /// No description provided for @thinking.
  ///
  /// In fa, this message translates to:
  /// **'در حال تحلیل…'**
  String get thinking;

  /// No description provided for @usersTitle.
  ///
  /// In fa, this message translates to:
  /// **'کاربران و دسترسی‌ها'**
  String get usersTitle;

  /// No description provided for @newUser.
  ///
  /// In fa, this message translates to:
  /// **'کاربر جدید'**
  String get newUser;

  /// No description provided for @fullNameLabel.
  ///
  /// In fa, this message translates to:
  /// **'نام و نام خانوادگی'**
  String get fullNameLabel;

  /// No description provided for @phoneLabel.
  ///
  /// In fa, this message translates to:
  /// **'تلفن همراه'**
  String get phoneLabel;

  /// No description provided for @roleLabel.
  ///
  /// In fa, this message translates to:
  /// **'نقش'**
  String get roleLabel;

  /// No description provided for @temporaryPassword.
  ///
  /// In fa, this message translates to:
  /// **'رمز موقت'**
  String get temporaryPassword;

  /// No description provided for @generatePassword.
  ///
  /// In fa, this message translates to:
  /// **'تولید رمز'**
  String get generatePassword;

  /// No description provided for @createUser.
  ///
  /// In fa, this message translates to:
  /// **'ایجاد کاربر'**
  String get createUser;

  /// No description provided for @userCreated.
  ///
  /// In fa, this message translates to:
  /// **'کاربر ایجاد شد. رمز موقت را به‌صورت حضوری تحویل دهید.'**
  String get userCreated;

  /// No description provided for @suspendUser.
  ///
  /// In fa, this message translates to:
  /// **'تعلیق'**
  String get suspendUser;

  /// No description provided for @activateUser.
  ///
  /// In fa, this message translates to:
  /// **'فعال‌سازی'**
  String get activateUser;

  /// No description provided for @resetPassword.
  ///
  /// In fa, this message translates to:
  /// **'بازنشانی رمز'**
  String get resetPassword;

  /// No description provided for @passwordResetDone.
  ///
  /// In fa, this message translates to:
  /// **'رمز موقت جدید: {password}'**
  String passwordResetDone(String password);

  /// No description provided for @userStatusActive.
  ///
  /// In fa, this message translates to:
  /// **'فعال'**
  String get userStatusActive;

  /// No description provided for @userStatusSuspended.
  ///
  /// In fa, this message translates to:
  /// **'معلق'**
  String get userStatusSuspended;

  /// No description provided for @userStatusDisabled.
  ///
  /// In fa, this message translates to:
  /// **'غیرفعال'**
  String get userStatusDisabled;

  /// No description provided for @lastLogin.
  ///
  /// In fa, this message translates to:
  /// **'آخرین ورود: {time}'**
  String lastLogin(String time);

  /// No description provided for @neverLoggedIn.
  ///
  /// In fa, this message translates to:
  /// **'هنوز وارد نشده'**
  String get neverLoggedIn;

  /// No description provided for @assignableRolesHint.
  ///
  /// In fa, this message translates to:
  /// **'فقط نقش‌هایی که شما مجاز به تعریف آن هستید نمایش داده می‌شود.'**
  String get assignableRolesHint;

  /// No description provided for @profileTitle.
  ///
  /// In fa, this message translates to:
  /// **'حساب کاربری'**
  String get profileTitle;

  /// No description provided for @languageLabel.
  ///
  /// In fa, this message translates to:
  /// **'زبان'**
  String get languageLabel;

  /// No description provided for @languageFa.
  ///
  /// In fa, this message translates to:
  /// **'فارسی'**
  String get languageFa;

  /// No description provided for @languageEn.
  ///
  /// In fa, this message translates to:
  /// **'English'**
  String get languageEn;

  /// No description provided for @activeSessions.
  ///
  /// In fa, this message translates to:
  /// **'دستگاه‌های فعال'**
  String get activeSessions;

  /// No description provided for @revokeAllSessions.
  ///
  /// In fa, this message translates to:
  /// **'خروج از همه دستگاه‌ها'**
  String get revokeAllSessions;

  /// No description provided for @sessionsRevoked.
  ///
  /// In fa, this message translates to:
  /// **'همه نشست‌ها باطل شد'**
  String get sessionsRevoked;

  /// No description provided for @thisDevice.
  ///
  /// In fa, this message translates to:
  /// **'این دستگاه'**
  String get thisDevice;

  /// No description provided for @permissionsCount.
  ///
  /// In fa, this message translates to:
  /// **'{n} مجوز فعال'**
  String permissionsCount(String n);

  /// No description provided for @myPermissions.
  ///
  /// In fa, this message translates to:
  /// **'مجوزهای من'**
  String get myPermissions;

  /// No description provided for @appVersionLabel.
  ///
  /// In fa, this message translates to:
  /// **'نسخه {version}'**
  String appVersionLabel(String version);

  /// No description provided for @hotelLabel.
  ///
  /// In fa, this message translates to:
  /// **'هتل'**
  String get hotelLabel;

  /// No description provided for @statusLabel.
  ///
  /// In fa, this message translates to:
  /// **'وضعیت'**
  String get statusLabel;

  /// No description provided for @roomTypeLabel.
  ///
  /// In fa, this message translates to:
  /// **'نوع اتاق'**
  String get roomTypeLabel;

  /// No description provided for @recentReadings.
  ///
  /// In fa, this message translates to:
  /// **'ثبت‌های اخیر'**
  String get recentReadings;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'fa'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'fa':
      return AppLocalizationsFa();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
