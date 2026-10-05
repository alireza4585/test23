/// Injectable time source so that SLA, session-timeout and analytics logic is
/// deterministic in tests.
class Clock {
  const Clock();

  DateTime now() => DateTime.now();
}

class FixedClock extends Clock {
  const FixedClock(this._now);

  final DateTime _now;

  @override
  DateTime now() => _now;
}
