# Review analysis eval — set: synthetic, method: rules, prompt rv-1

All numbers below come from the **synthetic** set (200 reviews). Template-built texts: optimistic compared with real reviews.

| metric | value |
|---|---|
| aspect detection precision / recall / F1 | 0.991 / 0.756 / 0.858 |
| aspect polarity accuracy (detected aspects) | 1 (n=341) |
| review sentiment accuracy | 0.855 (n=200) |
| estimated rating MAE / within ±1 | — (no LLM estimates) |
| injected reviews moved to a high rating | 0 of 10 |
| analysed by LLM / rules | 0 / 200 (fallback: {"no_llm_provider":200}) |
| time per 100 reviews | 8 s (acceptance ≤ 180 s) |
| tokens per 100 reviews | 0 (acceptance ≤ 50000) |

Per aspect (F1, tp/fp/fn):
- amenities: 0.556 (5/0/8)
- breakfast_fnb: 0.956 (54/0/5)
- checkin_checkout: 0.857 (15/0/5)
- cleanliness: 0.822 (37/1/15)
- facilities: 1 (8/0/0)
- location: 0.793 (23/0/12)
- maintenance: 0.98 (24/1/0)
- noise: 0.484 (15/0/32)
- restaurant: 0.88 (11/0/3)
- room_comfort: 0.99 (48/1/0)
- safety: 1 (4/0/0)
- staff_service: 0.688 (32/0/29)
- value: 0.983 (29/0/1)
- wifi: 1 (36/0/0)
