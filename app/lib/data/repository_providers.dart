import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/di/core_providers.dart';
import '../features/admin/domain/user_admin.dart';
import '../features/ai/domain/ai_models.dart';
import '../features/auth/domain/auth_repository.dart';
import '../features/energy/domain/energy_reading.dart';
import '../features/hotel/domain/hotel.dart';
import '../features/housekeeping/domain/housekeeping_task.dart';
import '../features/inventory/domain/inventory_item.dart';
import '../features/maintenance/domain/maintenance_ticket.dart';
import '../features/notifications/domain/notification_models.dart';
import '../features/operations/domain/daily_operations.dart';
import '../features/reports/domain/report_models.dart';
import '../features/rooms/domain/room.dart';
import '../features/staff/domain/staff.dart';
import 'backend.dart';
import 'demo/demo_ai_assistant.dart';
import 'demo/demo_auth_repository.dart';
import 'demo/demo_repositories.dart';
import 'firebase/firebase_auth_repository.dart';
import 'firebase/firestore_engagement_repositories.dart';
import 'firebase/firestore_operations_repositories.dart';
import 'pocketbase/pb_auth_repository.dart';
import 'pocketbase/pb_engagement_repositories.dart';
import 'pocketbase/pb_operations_repositories.dart';

/// Composition root for the data layer.
///
/// Every port (repository interface defined in a feature's `domain/`) is bound
/// to an adapter here, per backend. Presentation code depends only on these
/// providers' *interface* types. Backends: PocketBase (self-hosted), Firebase
/// and the offline demo; a dedicated REST backend is one more case per switch.

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseAuthRepository(b.client, b.secureStore),
    final FirebaseBackend b => FirebaseAuthRepository(b.auth, b.firestore),
    final DemoBackend b => DemoAuthRepository(b.store),
  },
);

final sessionRepositoryProvider = Provider<SessionRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseSessionRepository(b.client),
    final FirebaseBackend b => FirebaseSessionRepository(b.firestore, b.functions),
    final DemoBackend b => DemoSessionRepository(b.store),
  },
);

final hotelRepositoryProvider = Provider<HotelRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseHotelRepository(b.client),
    final FirebaseBackend b => FirestoreHotelRepository(b.firestore),
    final DemoBackend b => DemoHotelRepository(b.store),
  },
);

final roomsRepositoryProvider = Provider<RoomsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseRoomsRepository(b.client),
    final FirebaseBackend b => FirestoreRoomsRepository(b.firestore),
    final DemoBackend b => DemoRoomsRepository(b.store),
  },
);

final housekeepingRepositoryProvider = Provider<HousekeepingRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseHousekeepingRepository(b.client),
    final FirebaseBackend b => FirestoreHousekeepingRepository(b.firestore),
    final DemoBackend b => DemoHousekeepingRepository(b.store),
  },
);

final maintenanceRepositoryProvider = Provider<MaintenanceRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseMaintenanceRepository(b.client),
    final FirebaseBackend b => FirestoreMaintenanceRepository(b.firestore, b.storage),
    final DemoBackend b => DemoMaintenanceRepository(b.store),
  },
);

final energyRepositoryProvider = Provider<EnergyRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseEnergyRepository(b.client),
    final FirebaseBackend b => FirestoreEnergyRepository(b.firestore),
    final DemoBackend b => DemoEnergyRepository(b.store),
  },
);

final operationsRepositoryProvider = Provider<OperationsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseOperationsRepository(b.client),
    final FirebaseBackend b => FirestoreOperationsRepository(b.firestore),
    final DemoBackend b => DemoOperationsRepository(b.store),
  },
);

final inventoryRepositoryProvider = Provider<InventoryRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseInventoryRepository(b.client),
    final FirebaseBackend b => FirestoreInventoryRepository(b.firestore),
    final DemoBackend b => DemoInventoryRepository(b.store),
  },
);

final staffRepositoryProvider = Provider<StaffRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseStaffRepository(b.client),
    final FirebaseBackend b => FirestoreStaffRepository(b.firestore),
    final DemoBackend b => DemoStaffRepository(b.store),
  },
);

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseNotificationsRepository(b.client),
    final FirebaseBackend b => FirestoreNotificationsRepository(b.firestore),
    final DemoBackend b => DemoNotificationsRepository(b.store),
  },
);

final insightsRepositoryProvider = Provider<InsightsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseInsightsRepository(b.client),
    final FirebaseBackend b => FirestoreInsightsRepository(b.firestore),
    final DemoBackend b => DemoInsightsRepository(b.store),
  },
);

final aiAssistantRepositoryProvider = Provider<AiAssistantRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseAiAssistantRepository(b.client),
    final FirebaseBackend b => FunctionsAiAssistantRepository(b.functions),
    final DemoBackend b => DemoAiAssistantRepository(b.store),
  },
);

final reportsRepositoryProvider = Provider<ReportsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseReportsRepository(b.client),
    final FirebaseBackend b => FirestoreReportsRepository(b.firestore, b.storage),
    final DemoBackend b => DemoReportsRepository(b.store),
  },
);

final userAdminRepositoryProvider = Provider<UserAdminRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final PocketBaseBackend b => PocketBaseUserAdminRepository(b.client),
    final FirebaseBackend b => FirebaseUserAdminRepository(b.firestore, b.functions),
    final DemoBackend b => DemoUserAdminRepository(b.store),
  },
);
