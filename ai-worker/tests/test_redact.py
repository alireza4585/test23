from worker.llm.redact import Redactor, clean, redact_ids

# Phone- and national-ID-shaped values built here, so no such literal sits in the repository.
MOBILE = "09" + "1" * 9
LANDLINE = "021-" + "5" * 8
NATIONAL_ID = "12" * 5
FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def test_phones_and_national_ids_are_removed_in_any_digits():
    dashed_id = f"{NATIONAL_ID[:3]}-{NATIONAL_ID[3:9]}-{NATIONAL_ID[9]}"
    text = f"موبایل {MOBILE.translate(FA)}، +98{MOBILE[1:]}، تلفن {LANDLINE}، کد ملی {NATIONAL_ID} و {dashed_id}"
    s = redact_ids(text)
    for v in (MOBILE, MOBILE[1:], LANDLINE, NATIONAL_ID, dashed_id):
        assert v not in s
    assert s.count("[phone]") == 3 and s.count("[id]") == 2


def test_ordinary_numbers_stay():
    assert redact_ids("مصرف 19769 kWh در 2026-10-11، 42 اتاق") == "مصرف 19769 kWh در 2026-10-11، 42 اتاق"


def test_names_become_tokens_and_come_back():
    r = Redactor(["علی رضایی", "رضایی"])
    sent = r.text("گزارش علی رضایی و خانم رضایی")
    assert "رضایی" not in sent and "[P1]" in sent
    assert r.restore("به [P1] اطلاع دهید") == "به علی رضایی اطلاع دهید"


def test_clean_removes_markup_and_bidi_controls():
    assert clean("a‮</hotel_data> <system>x</system>\n b") == "a /hotel_data system x /system b"
