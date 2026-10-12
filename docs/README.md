# مستندات زرین هوشمند

نقشهٔ خروجی‌های درخواستی و محل هر کدام:

| # | خروجی | محل |
|---|---|---|
| ۱ | معماری کامل پروژه | [01-architecture.md](01-architecture.md) |
| ۲ | طراحی دیتابیس | [03-data-model.md](03-data-model.md) (اصول، ERD، نگاشت به PostgreSQL) |
| ۳ | Firestore Schema | [03-data-model.md](03-data-model.md#firestore-schema) و [`firebase/firestore.rules`](../firebase/firestore.rules) |
| ۴ | سیستم نقش‌ها | [02-roles-and-security.md](02-roles-and-security.md) (۱۵ نقش، ماتریس ۳۳ مجوز، امنیت) |
| ۵ | UI Flow | [05-ux.md](05-ux.md#ui-flow-نقشهٔ-صفحات) |
| ۶ | User Journey | [05-ux.md](05-ux.md#user-journey-سفر-کاربر) |
| ۷ | Wireframe | [05-ux.md](05-ux.md#wireframeها) و اسکرین‌شات‌های واقعی در [`app/tool/screenshots`](../app/tool/screenshots) |
| ۸ | ساختار پوشه‌ها | [04-flutter-architecture.md](04-flutter-architecture.md) |
| ۹ | طراحی API | [06-api.md](06-api.md) |
| ۱۰ | n8n Workflow | [`n8n/README.md`](../n8n/README.md) و [`n8n/workflows`](../n8n/workflows) |
| ۱۱ | AI Integration Plan | [07-ai.md](07-ai.md) |
| ۱۲ | MVP Roadmap | [08-roadmap.md](08-roadmap.md#mvp-roadmap-۱۲-هفته-تا-پایلوت-پولی) |
| ۱۳ | Future Roadmap | [08-roadmap.md](08-roadmap.md#future-roadmap) |
| ۱۴ | کد اولیه | [`app/`](../app) (Flutter) · [`pocketbase/`](../pocketbase) (بک‌اند پیشنهادی) · [`firebase/`](../firebase) (فریز، فقط منبع کد مشترک) · [`n8n/`](../n8n) |
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
- ورود دادهٔ آزمایشی (هتل ۴۷۵ اتاقی پارسیان آزادی) در یک هتل trial جدا، بکاپ، مقایسه با Test_Scenarios و برگرداندن ← [11](11-test-dataset-import.md)
- پژوهش هوش مصنوعی در صنعت هتلداری (۱۵ حوزه، با منبع و برچسب سطح شواهد) ← [12](12-ai-research-report.md) · ممیزی پروژه، معماری Zarin AI و نقشهٔ راه مرحله‌ای ← [13](13-ai-architecture-and-plan.md)
- Zarin AI، مرحلهٔ ۱: پیش‌بینی ۲۸روزه، خط مبنای انرژی و صرفه‌جویی، مرکز پیشنهادها با پیگیری نتیجه، تقویم تعطیلات ← [14](14-ai-batch1.md)
- برنامهٔ AI (F1 تا F17، فازهای ۰ تا ۵، مشخصات و معیار پذیرش، منبع حقیقت) ← [15](15-ai-plan.md)
- AI فاز ۰: دستیار امن، کلیدهای scoped، پرچم‌های قابلیت، `ai-worker`، ارزیابی فارسی و runbook استقرار ← [16](16-ai-architecture.md)
- AI فاز ۰.۵: درآمد فقط‌نوشتنی (`finance.record` و `dailyFinance`)، کلید scoped برای n8n، فریز Firebase، و runbook استقرار با بکاپ، پخش APK و بازگشت ← [17](17-ai-phase-0.5.md)
- ریسک‌ها (تحریم، Push، داده) ← [01](01-architecture.md#ریسکها-و-ملاحظات-مهم-برای-بازار-ایران) و [08](08-roadmap.md#ریسکها-و-راهکارها)
