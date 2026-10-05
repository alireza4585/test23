import 'dart:async';

extension SwitchMap<T> on Stream<T> {
  /// Like `asyncExpand`, but cancels the previous inner stream as soon as a
  /// new outer event arrives (Rx `switchMap`). Needed for "auth state →
  /// profile document" chains where the inner stream never completes.
  Stream<R> switchMap<R>(Stream<R> Function(T value) mapper) {
    StreamSubscription<T>? outer;
    StreamSubscription<R>? inner;
    late final StreamController<R> controller;

    controller = StreamController<R>(
      onListen: () {
        outer = listen(
          (value) {
            unawaited(inner?.cancel());
            inner = mapper(value).listen(
              controller.add,
              onError: controller.addError,
            );
          },
          onError: controller.addError,
          onDone: () async {
            await inner?.cancel();
            await controller.close();
          },
        );
      },
      onPause: () {
        outer?.pause();
        inner?.pause();
      },
      onResume: () {
        outer?.resume();
        inner?.resume();
      },
      onCancel: () async {
        await inner?.cancel();
        await outer?.cancel();
      },
    );
    return controller.stream;
  }
}

/// Merges several list streams into one, emitting the concatenation of the
/// latest value of each once all have emitted at least once.
Stream<List<T>> combineLatestLists<T>(List<Stream<List<T>>> streams) {
  if (streams.length == 1) return streams.first;
  final latest = List<List<T>?>.filled(streams.length, null);
  final subscriptions = <StreamSubscription<List<T>>>[];
  late final StreamController<List<T>> controller;

  controller = StreamController<List<T>>(
    onListen: () {
      for (var i = 0; i < streams.length; i++) {
        subscriptions.add(
          streams[i].listen((value) {
            latest[i] = value;
            if (latest.every((l) => l != null)) {
              controller.add([for (final l in latest) ...l!]);
            }
          }, onError: controller.addError),
        );
      }
    },
    onCancel: () async {
      for (final s in subscriptions) {
        await s.cancel();
      }
    },
  );
  return controller.stream;
}
