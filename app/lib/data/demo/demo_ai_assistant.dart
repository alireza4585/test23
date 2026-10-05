import '../../core/utils/day_key.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/energy/domain/energy_analytics.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import 'demo_store.dart';

/// Offline stand-in for the LLM assistant.
///
/// It answers the most common management questions from live demo data using
/// deterministic analytics — the same numbers the production assistant
/// receives as grounding context from the `aiAssistant` Cloud Function before
/// the LLM phrases the answer.
class DemoAiAssistantRepository implements AiAssistantRepository {
  DemoAiAssistantRepository(this._store);

  final DemoStore _store;

  @override
  Future<AssistantReply> ask({
    required String hotelId,
    required String question,
    required List<ChatMessage> history,
    required String localeCode,
  }) async {
    await _store.latency();
    await _store.latency();
    final fa = localeCode == 'fa';
    final q = question.toLowerCase();

    bool has(List<String> words) => words.any(q.contains);

    final AssistantReply reply;
    if (has(['اتلاف', 'هدر', 'waste', 'بیشترین', 'most'])) {
      reply = _waste(fa);
    } else if (has(['برق', 'انرژی', 'electric', 'energy', 'گاز', 'آب', 'water', 'gas'])) {
      reply = _energy(fa);
    } else if (has(['تعمیر', 'خرابی', 'تیکت', 'maintenance', 'ticket', 'repair'])) {
      reply = _maintenance(fa);
    } else if (has(['موجودی', 'انبار', 'inventory', 'stock', 'اتمام'])) {
      reply = _inventory(fa);
    } else if (has(['نظافت', 'housekeeping', 'clean', 'اتاق'])) {
      reply = _housekeeping(fa);
    } else if (has(['اشغال', 'درآمد', 'occupancy', 'revenue', 'adr', 'revpar'])) {
      reply = _revenue(fa);
    } else {
      reply = _summary(fa);
    }
    if (!fa) return reply;
    return AssistantReply(
      text: _persianDigits(reply.text),
      dataPoints: [for (final d in reply.dataPoints) _persianDigits(d)],
    );
  }

  static String _persianDigits(String input) {
    const digits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    final b = StringBuffer();
    for (final c in input.codeUnits) {
      if (c >= 48 && c <= 57) {
        b.write(digits[c - 48]);
      } else if (c == 44) {
        b.write('٬');
      } else {
        b.write(String.fromCharCode(c));
      }
    }
    return b.toString().replaceAllMapped(RegExp('([۰-۹])\\.([۰-۹])'), (m) => '${m[1]}٫${m[2]}');
  }

  EnergySummary _electricity({int days = 4}) {
    final today = DayKey.startOfDay(_store.clock.now());
    final hotel = _store.hotels.all.first;
    return EnergyAnalytics.summarize(
      type: EnergyType.electricity,
      readings: _store.energy.all.toList(),
      from: today.subtract(Duration(days: days)),
      to: today.subtract(const Duration(days: 1)),
      baseline: hotel.settings.energyDailyBaseline['electricity'] ?? 0,
      alertThresholdPct: hotel.settings.energyAlertThresholdPct,
      tariff: hotel.settings.energyTariff['electricity'],
      operations: _store.operations.all.toList(),
    );
  }

  AssistantReply _energy(bool fa) {
    final recent = _electricity();
    final month = _electricity(days: 30);
    final hvacTickets = _store.tickets.all
        .where((t) => t.category == TicketCategory.hvac && t.status.isActive)
        .toList();
    final change = recent.vsBaselinePct ?? 0;
    final intensityNow = recent.perOccupiedRoom ?? 0;
    final intensityMonth = month.perOccupiedRoom ?? 0;
    final extraKwh = (recent.dailyAverage - recent.baseline).clamp(0, double.infinity);
    final tariff = _store.hotels.all.first.settings.energyTariff['electricity'] ?? 0;
    final monthlyCost = extraKwh * 30 * tariff;

    final text = fa
        ? 'مصرف برق در ۴ روز اخیر به‌طور میانگین ${recent.dailyAverage.toStringAsFixed(0)} کیلووات‌ساعت در روز بوده که '
            '${change.toStringAsFixed(0)}٪ بالاتر از خط مبنا (${recent.baseline.toStringAsFixed(0)}) است.\n\n'
            'نکته مهم: این افزایش با نرخ اشغال توضیح داده نمی‌شود؛ شدت مصرف به ازای هر اتاق اشغال‌شده از '
            '${intensityMonth.toStringAsFixed(1)} به ${intensityNow.toStringAsFixed(1)} کیلووات‌ساعت رسیده است.\n\n'
            '${hvacTickets.isEmpty ? '' : 'محتمل‌ترین علت: ${hvacTickets.length} تیکت باز HVAC، از جمله «${hvacTickets.first.title}». افت راندمان چیلر معمولاً مصرف کمپرسور را ۱۵ تا ۲۵ درصد بالا می‌برد.\n\n'}'
            'پیشنهاد:\n'
            '۱. سرویس فوری چیلر و بررسی فشار مبرد\n'
            '۲. تنظیم نقطه کار سرمایش اتاق‌های خالی روی ۲۶ درجه\n'
            '۳. پایش روزانه شدت مصرف تا بازگشت به خط مبنا\n\n'
            'اگر روند ادامه یابد، هزینه اضافه ماهانه حدود ${_money(monthlyCost)} ریال خواهد بود.'
        : 'Electricity averaged ${recent.dailyAverage.toStringAsFixed(0)} kWh/day over the last 4 days — '
            '${change.toStringAsFixed(0)}% above the ${recent.baseline.toStringAsFixed(0)} kWh baseline.\n\n'
            'Occupancy does not explain it: intensity rose from ${intensityMonth.toStringAsFixed(1)} to '
            '${intensityNow.toStringAsFixed(1)} kWh per occupied room.\n\n'
            '${hvacTickets.isEmpty ? '' : 'Most likely cause: ${hvacTickets.length} open HVAC ticket(s), incl. "${hvacTickets.first.title}".\n\n'}'
            'Recommended: service the chiller, set vacant-room cooling to 26°C, track intensity daily.\n'
            'If the trend continues the extra monthly cost is ≈ ${_money(monthlyCost)} IRR.';
    return AssistantReply(
      text: text,
      dataPoints: fa
          ? [
              'میانگین ${recent.dailyAverage.toStringAsFixed(0)} kWh در روز',
              'خط مبنا ${recent.baseline.toStringAsFixed(0)} kWh',
              'شدت مصرف ${intensityNow.toStringAsFixed(1)} kWh/اتاق',
              'تیکت‌های باز HVAC: ${hvacTickets.length}',
            ]
          : [
              'avg ${recent.dailyAverage.toStringAsFixed(0)} kWh/day',
              'baseline ${recent.baseline.toStringAsFixed(0)} kWh/day',
              'intensity ${intensityNow.toStringAsFixed(1)} kWh/occupied room',
              'open HVAC tickets: ${hvacTickets.length}',
            ],
    );
  }

  AssistantReply _waste(bool fa) {
    final hotel = _store.hotels.all.first;
    final e = _electricity();
    final energyWaste = (e.dailyAverage - e.baseline).clamp(0, double.infinity) *
        30 * (hotel.settings.energyTariff['electricity'] ?? 0);

    final doneCheckouts = _store.tasks.all.where(
      (t) => t.type == HousekeepingTaskType.checkoutClean && t.duration != null,
    );
    final avgClean = doneCheckouts.isEmpty
        ? 0.0
        : doneCheckouts.fold<int>(0, (s, t) => s + t.duration!.inMinutes) /
              doneCheckouts.length;
    final target = hotel.settings.targetCleanMinutes['checkoutClean'] ?? 35;

    final now = _store.clock.now();
    final overdue = _store.tickets.all.where((t) => t.isOverdue(now)).length;
    final outOfOrder = _store.rooms.all.where((r) => r.status.name == 'outOfOrder').length;
    final lostRevenue = outOfOrder * 85000000.0 * 0.75 * 30;

    final ranked = [
      (fa ? 'انرژی (برق)' : 'Energy (electricity)', energyWaste),
      (fa ? 'اتاق‌های خارج از سرویس' : 'Out-of-order rooms', lostRevenue),
    ]..sort((a, b) => b.$2.compareTo(a.$2));

    final text = fa
        ? 'بر اساس داده‌های ۳۰ روز اخیر، بیشترین اتلاف به ترتیب:\n\n'
            '۱. ${ranked[0].$1}: حدود ${_money(ranked[0].$2)} ریال در ماه\n'
            '۲. ${ranked[1].$1}: حدود ${_money(ranked[1].$2)} ریال در ماه\n'
            '۳. بهره‌وری نظافت: میانگین ${avgClean.toStringAsFixed(0)} دقیقه در برابر هدف $target دقیقه\n'
            '۴. نگهداری: $overdue تیکت از SLA عبور کرده‌اند\n\n'
            'اقدام با بیشترین بازده: رفع خرابی‌های اتاق‌های خارج از سرویس و سرویس چیلر — هر دو در ماژول تعمیرات باز هستند.'
        : 'Largest losses over the last 30 days:\n\n'
            '1. ${ranked[0].$1}: ≈ ${_money(ranked[0].$2)} IRR/month\n'
            '2. ${ranked[1].$1}: ≈ ${_money(ranked[1].$2)} IRR/month\n'
            '3. Housekeeping productivity: ${avgClean.toStringAsFixed(0)} min vs $target min target\n'
            '4. Maintenance: $overdue tickets past SLA';
    return AssistantReply(
      text: text,
      dataPoints: fa
          ? ['انرژی ≈ ${_money(energyWaste)} ریال', 'اتاق خارج از سرویس: $outOfOrder', 'تیکت معوق: $overdue']
          : ['energy ≈ ${_money(energyWaste)}', 'out of order rooms: $outOfOrder', 'overdue tickets: $overdue'],
    );
  }

  AssistantReply _maintenance(bool fa) {
    final now = _store.clock.now();
    final active = _store.tickets.all.where((t) => t.status.isActive).toList()
      ..sort((a, b) => b.priority.index.compareTo(a.priority.index));
    final overdue = active.where((t) => t.isOverdue(now)).toList();
    final lines = active.take(4).map((t) => '• ${t.title} (${t.locationLabel})').join('\n');
    final text = fa
        ? '${active.length} تیکت فعال داریم که ${overdue.length} مورد از SLA عبور کرده‌اند.\n\nاولویت‌دارترین موارد:\n$lines'
        : '${active.length} active tickets, ${overdue.length} past SLA.\n\nTop priorities:\n$lines';
    return AssistantReply(
      text: text,
      dataPoints: fa
          ? ['فعال: ${active.length}', 'معوق: ${overdue.length}']
          : ['active ${active.length}', 'overdue ${overdue.length}'],
    );
  }

  AssistantReply _inventory(bool fa) {
    final low = _store.items.all.where((i) => i.isLowStock).toList();
    final lines = low.map((i) => '• ${i.name}: ${i.quantity.toStringAsFixed(0)} ${i.unit}').join('\n');
    final text = fa
        ? '${low.length} قلم زیر نقطه سفارش هستند:\n$lines\n\nپیشنهاد: سفارش تجمیعی امروز برای کاهش هزینه حمل.'
        : '${low.length} items are below reorder level:\n$lines';
    return AssistantReply(text: text, dataPoints: [fa ? 'زیر نقطه سفارش: ${low.length}' : 'low stock ${low.length}']);
  }

  AssistantReply _housekeeping(bool fa) {
    final key = DayKey.of(_store.clock.now());
    final today = _store.tasks.all.where((t) => DayKey.of(t.createdAt) == key).toList();
    final done = today.where((t) => t.status == TaskStatus.done).length;
    final dirty = _store.rooms.all.where((r) => r.status.name == 'vacantDirty').length;
    final text = fa
        ? 'امروز $done از ${today.length} وظیفه نظافت انجام شده و $dirty اتاق در انتظار نظافت است. '
            'برای آماده‌سازی به‌موقع اتاق‌های ورودی، اولویت را به اتاق‌های فوری بدهید.'
        : '$done of ${today.length} housekeeping tasks are done; $dirty rooms are waiting to be cleaned.';
    return AssistantReply(
      text: text,
      dataPoints: fa ? ['انجام‌شده $done از ${today.length}', 'در انتظار نظافت: $dirty'] : ['done $done/${today.length}', 'dirty $dirty'],
    );
  }

  AssistantReply _revenue(bool fa) {
    final ops = _store.operations.all.toList()..sort((a, b) => a.day.compareTo(b.day));
    final last7 = ops.length > 7 ? ops.sublist(ops.length - 7) : ops;
    final occ = last7.fold<double>(0, (s, o) => s + o.occupancyRate) / last7.length;
    final adr = last7.fold<double>(0, (s, o) => s + o.adr) / last7.length;
    final revpar = last7.fold<double>(0, (s, o) => s + o.revpar) / last7.length;
    final text = fa
        ? 'میانگین ۷ روز اخیر: نرخ اشغال ${occ.toStringAsFixed(1)}٪، ADR ${_money(adr)} ریال و RevPAR ${_money(revpar)} ریال. '
            'روزهای پنجشنبه و جمعه بیشترین اشغال را دارند؛ قیمت‌گذاری پویا برای روزهای میانی هفته پیشنهاد می‌شود.'
        : '7-day average: occupancy ${occ.toStringAsFixed(1)}%, ADR ${_money(adr)} IRR, RevPAR ${_money(revpar)} IRR.';
    return AssistantReply(text: text, dataPoints: [fa ? 'اشغال ${occ.toStringAsFixed(1)}٪' : 'occupancy ${occ.toStringAsFixed(1)}%']);
  }

  AssistantReply _summary(bool fa) {
    final e = _energy(fa);
    final m = _maintenance(fa);
    return AssistantReply(
      text: fa
          ? 'خلاصه وضعیت امروز:\n\n${m.text}\n\n— انرژی —\n${e.text.split('\n').first}\n\n'
              'می‌توانید بپرسید: «چرا مصرف برق زیاد شده؟» یا «کدام بخش بیشترین اتلاف را دارد؟»'
          : 'Today at a glance:\n\n${m.text}\n\n${e.text.split('\n').first}',
      dataPoints: [...m.dataPoints, ...e.dataPoints.take(2)],
    );
  }

  static String _money(num value) {
    final s = value.round().toString();
    final buffer = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buffer.write(',');
      buffer.write(s[i]);
    }
    return buffer.toString();
  }
}
