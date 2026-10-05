import '../security/app_role.dart';

/// Who performed an action. Stamped on every write so that audit logs,
/// timelines and "last updated by" labels work identically across backends.
class Actor {
  const Actor({required this.uid, required this.name, required this.role});

  /// Used by server-side automations (rule engine, n8n, IoT ingestion).
  const Actor.system()
    : uid = 'system',
      name = 'Zarin Automation',
      role = AppRole.superAdmin;

  final String uid;
  final String name;
  final AppRole role;

  Map<String, Object?> toMap() => {'uid': uid, 'name': name, 'role': role.code};
}
