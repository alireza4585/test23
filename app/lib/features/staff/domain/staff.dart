import '../../../core/domain/actor.dart';
import '../../../core/security/app_role.dart';

class StaffMember {
  const StaffMember({
    required this.id,
    required this.fullName,
    required this.department,
    required this.position,
    this.role,
    this.userId,
    this.phone,
    this.active = true,
  });

  final String id;
  final String fullName;
  final Department department;
  final String position;

  /// App role, when the employee has an account.
  final AppRole? role;
  final String? userId;
  final String? phone;
  final bool active;
}

enum ShiftType { morning, evening, night }

enum ShiftStatus { scheduled, checkedIn, completed, absent }

class Shift {
  const Shift({
    required this.id,
    required this.staffId,
    required this.staffName,
    required this.department,
    required this.day,
    required this.type,
    required this.startTime,
    required this.endTime,
    required this.status,
    this.userId,
  });

  final String id;
  final String staffId;
  final String staffName;
  final Department department;
  final DateTime day;
  final ShiftType type;

  /// `HH:mm` in hotel local time.
  final String startTime;
  final String endTime;
  final ShiftStatus status;
  final String? userId;
}

class ShiftDraft {
  const ShiftDraft({
    required this.staff,
    required this.day,
    required this.type,
  });

  final StaffMember staff;
  final DateTime day;
  final ShiftType type;

  (String, String) get hours => switch (type) {
    ShiftType.morning => ('07:00', '15:00'),
    ShiftType.evening => ('15:00', '23:00'),
    ShiftType.night => ('23:00', '07:00'),
  };
}

abstract interface class StaffRepository {
  Stream<List<StaffMember>> watchStaff(String hotelId);

  /// Shifts for [day]. Staff without `staff.view` must pass [userId].
  Stream<List<Shift>> watchShifts(
    String hotelId, {
    required DateTime day,
    String? userId,
  });

  Future<void> createShift(String hotelId, ShiftDraft draft, Actor actor);

  Future<void> updateShiftStatus(
    String hotelId, {
    required String shiftId,
    required ShiftStatus status,
    required Actor actor,
  });
}
