# Human-labelled reviews (slot)

Owner decision 8 (docs/21 §12.6): at least 50 real reviews, from a trial
hotel's own CSV export, labelled by a person, added later.

- One file `reviews.jsonl`, one review per line:
  `{"id", "lang", "text", "rating": {"raw", "min", "max"} | null, "labels": {"aspects": [{"aspect", "sentiment": "pos"|"neg"}], "sentiment": "pos"|"neg"|"mixed"}, "labelledBy": "<initials>", "labelledAt": "YYYY-MM-DD"}`
- Before committing: remove reviewer names, handles, phone numbers, e-mail
  addresses and national IDs from the text (the redactor runs again at import,
  but the file itself must not hold them).
- Aspect keys: the fixed taxonomy in docs/21 §6.1.
- Reports name the set behind each accuracy number: `synthetic` or `human`.
