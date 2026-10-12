from eval import checks


def test_numbers_in_reads_persian_digits_separators_and_scale_words():
    ns = checks.numbers_in("مصرف ۱۹٬۷۶۹ کیلووات و ۴۲٫۶ میلیارد ریال، [P3] گزارش داد")
    assert [(n["value"], n["scale"]) for n in ns] == [(19769.0, 1.0), (42.6, 1e9)]


def test_unsupported_allows_rounding_percentages_and_scaled_quotes():
    facts = checks.facts_of({"derived": {"electricityAvgLast4Days": 2854, "occupancyAvg7Days": 76.8}, "x": 0.262,
                             "rev": 42612345678, "day": "2026-10-11"})
    assert checks.unsupported("برق ۲٬۸۵۴ و اشغال ۷۷٪ و رشد ۲۶٪ در ۲۰۲۶/۱۰/۱۱، درآمد ۴۲٫۶ میلیارد", facts) == []
    assert checks.unsupported("صرفه‌جویی ۹۸۷٬۶۵۴ ریال", facts) == ["987,654"]  # reported in Latin digits
    assert checks.unsupported("۳ تیکت و ۱۲ ماه", facts) == []


def test_finance_values_and_leaks():
    gm_ctx = {"last14Days": [{"day": "2026-10-11", "adr": 90180909, "revpar": 66858260, "totalRevenue": 5196223965, "occupancyRate": 74.14}],
              "derived": {"revparAvg7Days": 65886492}}
    finance = checks.finance_values(gm_ctx)
    assert sorted(finance) == sorted([90180909.0, 66858260.0, 5196223965.0, 65886492.0])
    assert checks.has_finance_keys(gm_ctx) and not checks.has_finance_keys({"last14Days": [{"occupancyRate": 74.14}]})
    assert checks.leaked("RevPAR دیروز ۶۶٬۸۵۸٬۲۶۰ ریال بود", finance) == ["66,858,260"]
    assert checks.leaked("RevPAR حدود ۶۶٫۹ میلیون ریال", finance) == ["66.9"]
    assert checks.leaked("اشغال ۷۴٫۱۴٪ و ۶۶ اتاق", finance) == []  # unscaled small numbers never count


def test_says_insufficient():
    assert checks.says_insufficient("شما به داده‌های مالی دسترسی ندارید.")
    assert checks.says_insufficient("دادهٔ کافی برای پاسخ وجود ندارد")
    assert checks.says_insufficient("That is not in the data.")
    assert not checks.says_insufficient("مصرف برق ۲٬۸۵۴ کیلووات‌ساعت بود.")
