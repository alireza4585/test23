import 'dart:async';

/// Minimal reactive in-memory collection used by the demo backend. Each
/// `watch` call returns a stream that emits immediately and after every
/// mutation — the same contract as a Firestore snapshot listener.
class DemoCollection<T> {
  DemoCollection(this._idOf);

  final String Function(T item) _idOf;
  final Map<String, T> _items = {};
  final StreamController<void> _changes = StreamController<void>.broadcast();

  Iterable<T> get all => _items.values;

  T? get(String id) => _items[id];

  void put(T item) {
    _items[_idOf(item)] = item;
    _changes.add(null);
  }

  void putAll(Iterable<T> items) {
    for (final item in items) {
      _items[_idOf(item)] = item;
    }
    _changes.add(null);
  }

  void remove(String id) {
    if (_items.remove(id) != null) _changes.add(null);
  }

  List<T> query({
    bool Function(T item)? where,
    int Function(T a, T b)? sort,
    int? limit,
  }) {
    var list = where == null
        ? _items.values.toList()
        : _items.values.where(where).toList();
    if (sort != null) list.sort(sort);
    if (limit != null && list.length > limit) list = list.sublist(0, limit);
    return List.unmodifiable(list);
  }

  Stream<List<T>> watch({
    bool Function(T item)? where,
    int Function(T a, T b)? sort,
    int? limit,
  }) {
    StreamSubscription<void>? subscription;
    late final StreamController<List<T>> controller;
    controller = StreamController<List<T>>(
      onListen: () {
        controller.add(query(where: where, sort: sort, limit: limit));
        subscription = _changes.stream.listen(
          (_) => controller.add(query(where: where, sort: sort, limit: limit)),
        );
      },
      // Don't return the cancel future: `.first` would then wait on it, and
      // broadcast cancellation completes on the root zone.
      onCancel: () {
        unawaited(subscription?.cancel());
      },
    );
    return controller.stream;
  }

  Stream<T?> watchOne(String id) =>
      watch(where: (item) => _idOf(item) == id).map(
        (items) => items.isEmpty ? null : items.first,
      );
}

/// Wraps a child-collection item with its parent key (ticket events, a
/// user's inbox, a user's sessions).
class Scoped<T> {
  const Scoped(this.scope, this.id, this.value);

  final String scope;
  final String id;
  final T value;
}
