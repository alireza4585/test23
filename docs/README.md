# مستندات زرین هوشمند

نقشهٔ خروجی‌های درخواستی و محل هر کدام:

| # | خروجی | محل |
|---|---|---|
| ۱ | معماری کامل پروژه | [01-architecture.md](01-architecture.md) |
| ۲ | طراحی دیتابیس | [03-data-model.md](03-data-model.md) (اصول، ERD، نگاشت به PostgreSQL) |
| ۳ | Firestore Schema | [03-data-model.md](03-data-model.md#firestore-schema) و [`firebase/firestore.rules`](../firebase/firestore.rules) |
| ۴ | سیستم نقش‌ها | [02-roles-and-security.md](02-roles-and-security.md) (۱۵ نقش، ماتریس ۳۲ مجوز، امنیت) |
| ۵ | UI Flow | [05-ux.md](05-ux.md#ui-flow-نقشهٔ-صفحات) |
| ۶ | User Journey | [05-ux.md](05-ux.md#user-journey-سفر-کاربر) |
| ۷ | Wireframe | [05-ux.md](05-ux.md#wireframeها) و اسکرین‌شات‌های واقعی در [`app/tool/screenshots`](../app/tool/screenshots) |
| ۸ | ساختار پوشه‌ها | [04-flutter-architecture.md](04-flutter-architecture.md) |
| ۹ | طراحی API | [06-api.md](06-api.md) |
| ۱۰ | n8n Workflow | [`n8n/README.md`](../n8n/README.md) و [`n8n/workflows`](../n8n/workflows) |
| ۱۱ | AI Integration Plan | [07-ai.md](07-ai.md) |
| ۱۲ | MVP Roadmap | [08-roadmap.md](08-roadmap.md#mvp-roadmap-۱۲-هفته-تا-پایلوت-پولی) |
| ۱۳ | Future Roadmap | [08-roadmap.md](08-roadmap.md#future-roadmap) |
| ۱۴ | کد اولیه | [`app/`](../app) (Flutter) · [`pocketbase/`](../pocketbase) (بک‌اند پیشنهادی) · [`firebase/`](../firebase) (جایگزین) · [`n8n/`](../n8n) |
| ۱۵ | صفحات قابل اجرا | `cd app && flutter run` (بک‌اند دمو). راهنما در [README اصلی](../README.md). اتصال به سرور لیارا و ساخت APK ← [10](10-flutter-app.md) |

موضوعات تکمیلی درخواستی:

- Security Rules ← [02](02-roles-and-security.md#نکات-کلیدی-security-rules)
- Navigation و Routing ← [04](04-flutter-architecture.md#navigation-و-routing-go_router)
- State Management ← [04](04-flutter-architecture.md#state-management-riverpod-3)
- Dependency Injection ← [04](04-flutter-architecture.md#dependency-injection)
- Repository و Service Layer ← [04](04-flutter-architecture.md#repository--service-layer)
- Audit Log و Session Management ← [02](02-roles-and-security.md#audit-log)
- استقرار روی سرور (PocketBase) ← [`pocketbase/README.md`](../pocketbase/README.md)
- راه‌اندازی روی لیارا (PocketBase و n8n): به‌روزرسانی hookها، پاک کردن دادهٔ دمو، متغیرها، کانال‌ها، فعال‌سازی، آزمون و چک‌لیست امنیتی ← [09](09-liara-runbook.md)
- ریسک‌ها (تحریم، Push، داده) ← [01](01-architecture.md#ریسکها-و-ملاحظات-مهم-برای-بازار-ایران) و [08](08-roadmap.md#ریسکها-و-راهکارها)
