import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/day_key.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../rooms/application/rooms_providers.dart';
import '../../rooms/domain/room.dart';
import '../application/operations_providers.dart';
import '../domain/daily_operations.dart';

/// Front-office daily figures (occupancy, guests, revenue). Prefilled from
/// the room board and from an existing entry for the selected day.
class DailyOpsPage extends ConsumerStatefulWidget {
  const DailyOpsPage({super.key});

  @override
  ConsumerState<DailyOpsPage> createState() => _DailyOpsPageState();
}

class _DailyOpsPageState extends ConsumerState<DailyOpsPage> {
  final _formKey = GlobalKey<FormState>();
  final _available = TextEditingController();
  final _occupied = TextEditingController();
  final _guests = TextEditingController();
  final _roomRevenue = TextEditingController();
  final _fnbRevenue = TextEditingController();
  final _otherRevenue = TextEditingController();
  late DateTime _day;
  String? _loadedFor;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _day = DayKey.startOfDay(ref.read(clockProvider).now());
  }

  @override
  void dispose() {
    for (final c in [_available, _occupied, _guests, _roomRevenue, _fnbRevenue, _otherRevenue]) {
      c.dispose();
    }
    super.dispose();
  }

  num? _parse(String v) => num.tryParse(
    v.trim().replaceAll(',', '').replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}'),
  );

  void _prefill(List<DailyOperations> existing, List<Room> rooms) {
    final key = DayKey.of(_day);
    if (_loadedFor == key) return;
    _loadedFor = key;
    DailyOperations? entry;
    for (final o in existing) {
      if (DayKey.of(o.day) == key) entry = o;
    }
    String n(num v) => v.toStringAsFixed(0);
    if (entry != null) {
      _available.text = n(entry.roomsAvailable);
      _occupied.text = n(entry.roomsOccupied);
      _guests.text = n(entry.guests);
      _roomRevenue.text = n(entry.roomRevenue);
      _fnbRevenue.text = n(entry.fnbRevenue);
      _otherRevenue.text = n(entry.otherRevenue);
    } else {
      final sellable = rooms.where((r) => r.status != RoomStatus.outOfOrder).length;
      final occupied = rooms.where((r) => r.status == RoomStatus.occupied).length;
      _available.text = n(sellable);
      _occupied.text = n(occupied);
      for (final c in [_guests, _roomRevenue, _fnbRevenue, _otherRevenue]) {
        c.clear();
      }
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await ref.read(operationsActionsProvider).save(
        DailyOperations(
          day: _day,
          roomsAvailable: _parse(_available.text)!.toInt(),
          roomsOccupied: _parse(_occupied.text)!.toInt(),
          guests: _parse(_guests.text)!.toInt(),
          roomRevenue: _parse(_roomRevenue.text)!.toDouble(),
          fnbRevenue: (_parse(_fnbRevenue.text) ?? 0).toDouble(),
          otherRevenue: (_parse(_otherRevenue.text) ?? 0).toDouble(),
        ),
      );
      if (mounted) showSuccess(context, context.l10n.savedSuccessfully);
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final existing = ref.watch(operationsRangeProvider).value ?? const [];
    final rooms = ref.watch(roomsProvider).value ?? const [];
    _prefill(existing, rooms);
    final today = DayKey.startOfDay(ref.read(clockProvider).now());

    String? requiredNumber(String? v) => _parse(v ?? '') == null ? l10n.invalidNumber : null;
    String? optionalNumber(String? v) =>
        (v ?? '').trim().isEmpty || _parse(v!) != null ? null : l10n.invalidNumber;

    Widget field(TextEditingController c, String label, String? Function(String?) validator) => Padding(
      padding: const EdgeInsets.only(bottom: Insets.md),
      child: TextFormField(
        controller: c,
        keyboardType: TextInputType.number,
        textDirection: TextDirection.ltr,
        decoration: InputDecoration(labelText: label),
        validator: validator,
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(l10n.dailyOpsTitle), actions: const [ShellActions()]),
      body: Form(
        key: _formKey,
        child: PageBody(
          maxWidth: 560,
          children: [
            Text(l10n.dailyOpsHint, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: Insets.md),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.calendar_today_outlined),
              title: Text(l10n.dateLabel),
              trailing: Text(fmt.date(_day)),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _day,
                  firstDate: today.subtract(const Duration(days: 30)),
                  lastDate: today,
                );
                if (picked != null) setState(() => _day = picked);
              },
            ),
            const SizedBox(height: Insets.sm),
            field(_available, l10n.roomsAvailable, requiredNumber),
            field(_occupied, l10n.roomsOccupied, requiredNumber),
            field(_guests, l10n.guestsLabel, requiredNumber),
            field(_roomRevenue, l10n.roomRevenue, requiredNumber),
            field(_fnbRevenue, l10n.fnbRevenue, optionalNumber),
            field(_otherRevenue, l10n.otherRevenue, optionalNumber),
            const SizedBox(height: Insets.md),
            FilledButton(onPressed: _busy ? null : _save, child: Text(l10n.save)),
          ],
        ),
      ),
    );
  }
}
