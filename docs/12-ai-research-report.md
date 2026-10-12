# Measured operations AI beats hotel chatbot hype

As of October 2026, the hotel AI with the strongest evidence is mostly not conversational. It is measurable operations intelligence: forecasting that drives staffing and purchasing, effort-weighted housekeeping, weather- and occupancy-normalised energy baselines, sensor-based fault detection, food-waste measurement, and supervised agents that draft actions for staff to approve. Independent or operator-measured results cluster at modest, believable sizes:
- a **median 9% energy saving from building fault detection** (LBNL/DOE);
- **12–25% of guestroom HVAC energy from occupancy controls** (California utility analysis);
- a **21% cut in kitchen food waste and a 7:1 return across 42 hotels** (Champions 12.3);
- **2–4% revenue from chain revenue-management systems**, measured by the operators themselves (IHG, Carlson Rezidor).

The big five groups all shipped guest-facing generative AI between 2024 and 2026, mainly conversational search, trip planners and brand apps inside ChatGPT: Hilton's AI Planner, Marriott's Ask Bonvoy, IHG's Gemini planner, Accor's ALL Concierge, and Hyatt's ChatGPT app with natural-language search. None has published an independently audited outcome. The few operational numbers available are company-reported support-deflection metrics: Choice −40% support requests, and Accor guest-query response time cut from 30 minutes to 1 minute.

For Zarin Hoshmand, about a dozen high-value features can be built now on its existing data using deterministic methods plus LLM narration, with no reservation feed, guest data or sensors. True dynamic pricing, cancellation prediction, guest messaging, CRM personalisation, menu engineering and sensor-based predictive maintenance all need integrations Zarin lacks. Iran adds four constraints:
- Western LLM APIs are unavailable, so the realistic options are the Liara gateway (with continuity risk) or self-hosted open-weight models.
- Room tariffs are capped by regulation, so "pricing AI" means discounting below the approved rate.
- A strained power grid makes energy and outage features unusually valuable.
- There is no enacted data-protection law, which argues for building to GDPR-style principles anyway.

All of this rests on search-result extracts rather than full-text reads, as the methodology section explains.

## Methodology: built from search extracts, with four thin note files

This report synthesises seven research note files compiled on 10–11 October 2026, covering:
- operations, housekeeping and workforce;
- revenue, forecasting and benchmarking;
- guest experience;
- maintenance and energy;
- F&B, finance and fraud;
- hotel groups and agentic AI governance;
- the Iran deployment context.

**Two hard constraints shaped the evidence.**
- **Direct page fetching was blocked** by the research environment's network policy. Almost every host failed (WebFetch DNS errors, proxy 403s); anthropic.com was among the few readable. Nearly every finding therefore comes from search-engine extracts of the cited pages, not full-text reads.
- **A shared, capped search budget ran out mid-session.** As a result:
  - Error tables inside papers (for example MAPE by lead time in Weatherford & Kimes) could not be read.
  - Several press releases are known only from their search summaries.
  - Some questions were never searched at all.

**Four note files are partial, and the reader should weigh those areas accordingly.**
- **Finance and operational risk.** The F&B/finance file contains no externally verified citations for hotel financial intelligence (USALI, GOP, budgeting, IAS 29) or for operational risk and HACCP. Those subsections are design reasoning only.
- **Iran deployment context.** The Iran file verified LLM-provider availability, the Liara gateway, GPU rental and open-weight models. It did not research these topics:
  - Iranian PMS, OTA and accounting-software APIs;
  - Tavanir tariff tables;
  - data-protection status;
  - source markets;
  - messenger bot APIs.

  Partial coverage of energy, data protection, source markets and Bale comes from the guest-experience and maintenance files instead.
- **Hotel groups and governance.** Its title promises digital twins, closed-loop measurement, AI governance and LLM cost modelling, but the file stops after the agentic-AI section. **Digital twins and LLM unit-cost modelling are therefore not covered in this report.**
- **Operations.** The search budget ran out before 2026 LLM-copilot launches by housekeeping and service-ops vendors could be researched.

**Evidence labels are kept throughout**, using the notes' scheme:

| Label | Meaning |
|---|---|
| **(a)** | Independent: peer-reviewed research, government lab, standards body, regulator, or investigative journalism |
| **(a\*)** | Third-party metered but published by the vendor |
| **(b)** | Vendor or operator case study with a named site or company. This includes operator-authored *Interfaces*/Edelman papers, which are refereed but report the company's own measurement |
| **(c)** | Marketing or company-reported claim without disclosed method, portfolio averages, projections and targets |
| **(d)** | Experimental concept, thesis, patent, pilot or preprint |
| **(s)** | Hotel-group self-reported ESG figure |

**No figure appears here without a source URL.** Figures whose source could not be pinned down in the notes are excluded, for example a widely repeated "Accor +18.4% RevPAR" claim and a supposed 2023 update of the Cornell reputation study. The Zarin data baseline used for every fit assessment:
- **Has:** daily occupancy and revenue (rooms, F&B, other), daily energy totals, maintenance tickets with SLA and cost, housekeeping tasks with timestamps and assignee, live room status, an inventory movement ledger (receive/issue/waste/adjust), and staff and shifts.
- **Lacks:** reservations or a PMS feed, guest data, reviews, POS, budgets or GL, an equipment register, and sensors.

## Big chains shipped guest search; operations AI stays in pilots

The pattern across the large groups is consistent. They put conversational search grounded in their own property data in front of guests, placed brand apps inside third-party assistants with booking handed back to the brand site, gave staff enterprise copilots, and automated contact centres. Property-operations AI (housekeeping, maintenance, energy) is the least publicised layer, and it is the layer Zarin targets.

| Group | Guest-facing GenAI (status) | Operations / back-office AI | Published outcomes (label) |
|---|---|---|---|
| **Hilton** | AI Planner on hilton.com, available to all visitors by 17 Mar 2026 under a "test-and-learn approach" ([Hilton](https://stories.hilton.com/releases/hilton-introduces-the-hilton-ai-planner)); described on the Q1 2026 call as Anthropic-powered ([Motley Fool transcript](https://www.fool.com/earnings/call-transcripts/2026/04/28/hilton-hlt-q1-2026-earnings-call-transcript/)) | Agentic AI for guest and admin workflows announced, not verified live ([InfotechLead](https://infotechlead.com/cio/hilton-accelerates-ai-powered-hospitality-strategy-with-record-digital-growth-and-2030-tech-roadmap-93654)); Winnow food-waste AI; LightStay utility platform | No AI Planner metric. Green Ramadan 2025 across 45 hotels: plate waste −26%, total food waste −35% (b, company) ([Hilton](https://stories.hilton.com/releases/hilton-scales-up-green-ramadan-initiative-in-2025-achieves-26-reduction-in-plate-waste-during-the-holy-month)) |
| **Marriott** | Ask Bonvoy natural-language search in US English beta, answers grounded "solely in Marriott's own verified property data" ([Hospitality Upgrade](https://www.hospitalityupgrade.com/news/marriott-international-introduces-ask-bonvoy-tm-a-new-ai-powered-search-experience-transforming-travel-exploration)); trip-planner rollout began 16 Jun 2026 ([Skift](https://skift.com/2026/06/16/marriott-begins-rollout-of-ai-trip-planner-on-site-and-app/)); ChatGPT ad pilot | Microsoft Copilot for nearly all employees ([Hotel Dive](https://www.hoteldive.com/news/artificial-intelligence-powered-hotel-search-tool-launches-2026/828419/)); MESH sustainability hub on Schneider software ([Marriott assurance](http://serve360.marriott.com/wp-content/uploads/2025/07/2025AssuranceStatement.pdf)); Winnow in 53 UK, Ireland and Nordics hotels | Homes & Villas AI-search users "twice as likely" to save favourites (c). Food waste −25% in H1 2024 (b) ([Sustainable Food Business](https://sustainablefoodbusiness.com/tag/marriott-international/)). Historic One Yield RMS: up to +2% leisure revenue (b, mid-2000s) ([Computerworld](https://www.computerworld.com/article/1714812/marriott-links-two-data-streams-with-revenue-management-system.html)) |
| **IHG** | Gemini/Vertex AI trip planner in the IHG One app, announced Apr 2024 ([Google Cloud](https://www.googlecloudpresscorner.com/2024-04-09-IHG-Hotels-Resorts-Builds-a-New-Travel-Planner-Powered-by-Google-Cloud-AI)); listed as shipped in the 2025 Annual Report | New AI revenue-management system for owners, AI-enabled CRM, content platform with AI translation ([IHG AR 2025](https://www.ihgplc.com/~/media/Files/I/Ihg-Plc/investors/annual-report/2025/industry-trends_p22-23.pdf)); Green Engage monthly utility reporting | Historic price optimisation: +2.7% retail-segment revenue across 2,000+ hotels (b) ([Interfaces 2012](https://ideas.repec.org/a/inm/orinte/v42y2012i1p45-57.html)). Energy per available room −9.4% from 2019 to 2024 (s) ([IHG AR 2024](https://www.ihgplc.com/~/media/Files/I/Ihg-Plc/investors/annual-report/2024/ihg-ar-2024.pdf)) |
| **Accor** | ALL Accor app inside ChatGPT, Jan 2026, 20+ languages ([Skift](https://skift.com/2026/01/29/accor-launches-app-in-chatgpt-to-compete-for-early-bookings/)); ALL Concierge on app, web, iMessage and WhatsApp, Sept 2026 ([Hotel Dive](https://www.hoteldive.com/news/accor-launches-ai-travel-concierge/831179/)) | "The Butler" staff tool; Guest Relation AI Platform in 200+ hotels; Winnow in 200+ hotels | Guest query response cut from 30 min to 1 min (c, company) ([Skift](https://skift.com/2026/09/28/skift-data-ai-summit-europe-preview-accor-nicolas-maynard/)). Target of 30% of internal support requests resolved by AI by late 2026 (target). Owners expect up to 20% cost savings (expectation) ([PhocusWire](https://www.phocuswire.com/news/finance/accor-q2-2026-ai-cost-savings)) |
| **Hyatt** | App in ChatGPT plus natural-language search on Hyatt.com ([Skift](https://skift.com/2026/02/12/hyatt-ceo-sees-lift-from-ai-search-reveals-chatgpt-app/)) | ChatGPT Enterprise across finance, marketing, operations and CX, Apr 2026 ([Skift](https://skift.com/2026/04/20/hyatt-chatgpt-enterprise-roll-out/)) | CEO cites higher conversion, revenue per booking and length of stay from AI search, with no numbers (c) |

The adjacent groups supply the only quantified operations metrics, all company-reported:
- **Choice Hotels:** its in-PMS assistant CHARLIE cut operational support requests about 40% in pilot (c) ([Benzinga transcript](https://www.benzinga.com/news/26/10/62242927/choice-hotels-intl-reports-q2-2026-results-full-earnings-call-transcript)).
- **Wyndham, own figure:** AI tools cut call-centre average handle time 7% (c) ([Wyndham IR](https://investor.wyndhamhotels.com/news-events/press-releases/detail/420/wyndham-launches-native-chatgpt-app)).
- **Wyndham, PwC case study:** 30–50% lower handle time and 28% of calls handled by AI agents ([PwC](https://www.pwc.com/us/en/library/case-studies/wyndham-agentic-ai.html)). The two Wyndham figures conflict, probably because of different scopes.
- **Independent check:** Upgraded Points found that most hotel plugins in AI travel tools did not get prices right (a, journalistic) ([Upgraded Points](https://upgradedpoints.com/news/testing-ai-travel-tools/)).

**The PMS layer moved from features to embedded assistants and agents in 2025–2026.**
- **Oracle** shipped the OPERA Cloud Assistant and AI room assignment on 16 June 2026, at no extra cost to OPERA Cloud customers ([Oracle](https://www.oracle.com/news/announcement/new-ai-capabilities-in-oracle-opera-cloud-supercharge-hotel-operations-2026-06-16/); [Lodging Magazine](https://lodgingmagazine.com/oracle-debuts-oracle-opera-cloud-assistant/)).
- **Mews** raised $300M at a $2.5B valuation to build operations agents ([Skift](https://skift.com/2026/01/22/mews-raises-300-million-series-d-2-5-billion-valuation/)). It says every agent "starts with human-in-the-loop oversight" ([Mews blog](https://www.mews.com/en/blog/building-trust-how-agentic-ai-earns-its-place-in-hospitality)).
- **Apaleo and SiteMinder** exposed MCP servers so that external agents can read and act on hotel data ([Apaleo](https://apaleo.com/blog/apaleo-news/apaleo-launches-mcp-server); [PhocusWire](https://www.phocuswire.com/news/technology/siteminder-links-hotel-inventory-ai-booking-channels-mcp)).
- **Duetto** bought FLYR Hospitality on 8 October 2026. Its CTO said pricing runs on ML models with revenue managers setting guardrails ([Travel PR News](https://travelprnews.com/duetto-buys-flyr-hospitality-to-deepen-ai-powered-hotel-revenue-and-profit-platform/travel-press-release/2026/10/08/)).

Sanctions mean Iranian hotels cannot buy any of these products. Zarin therefore competes on local integration, Persian UX and cost, not on matching vendor feature lists. The transferable lessons are the in-PMS assistant (CHARLIE) and team tools (The Butler), not the ChatGPT distribution plays.

## Forecasting, pricing and benchmarking: simple models win, and Iran caps the price

### Areas 2 and 3: demand forecasting and revenue management

**How commercial RMS works.** Products such as IDeaS G3, Duetto, Atomize/Mews, FLYR, Lighthouse, RoomPriceGenie and PriceLabs all start from a forecast of demand by future stay date. They build it from reservation history and live on-the-books pace, then add competitor rates, events and seasonality. Two families exist:
- **Optimisation systems** estimate unconstrained demand and price sensitivity, then set price jointly with availability. IDeaS says it uses "over 100 models tuned to different types of hotel business" (c) ([IDeaS](https://ideas.com/science-behind-g3-rms/)).
- **Light tools** adjust a user-set base price inside min/max bounds ([RoomPriceGenie](https://help.roompricegenie.com/knowledge/minimum-and-maximum-prices); [PriceLabs](https://hotels.pricelabs.co/dynamic-pricing/)).

**Every product reviewed needs a live booking feed**, which Zarin does not have.

**Simple baselines are hard to beat.** The academic record shows this consistently:
- **Weatherford & Kimes (2003)** tested Choice and Marriott arrivals data. Exponential smoothing, pickup and moving averages were the most robust methods, and booking-curve and combination forecasts were "fairly inaccurate" (a) ([RePEc](https://ideas.repec.org/a/eee/intfor/v19y2003i3p401-415.html)).
- **The tourism forecasting competition (2011)** covered 1,311 series. Naive forecasts were "hard to beat" on annual data, and pure time-series methods beat models with explanatory variables (a) ([Hyndman](https://robjhyndman.com/publications/the-tourism-forecasting-competition/)).
- **Pereira & Cerqueira** is the closest analogue to Zarin's data: a single hotel's daily demand series. ML regression and ensembles **cut RMSE by up to 54% at one day ahead and 45% at 14 days** compared with exponential smoothing (a) ([RCAAP record](https://rc.cplp.org/Record/rcaap_88e1c9922dca927c6d17ab64729a01c8)).
- **A 2025 NOVA dissertation** on 100 hotels found XGBoost had the best balance of accuracy and compute, Prophet suited small seasonal hotels, and "no single model outperformed across all contexts" (d) ([RUN NOVA](https://run.unl.pt/entities/publication/a8501afe-673c-4edc-970e-64f277e2c657)).
- **Schwartz et al. (2016)** showed that adding a competitive set's predicted occupancy measurably improves a hotel's own forecast (a) ([UCF STARS](https://stars.library.ucf.edu/ucfscholar/364)). This matters for a pooled Zarin benchmark.
- **Cancellation prediction** exceeds 90% classification accuracy on booking-level data (a) ([ISCTE](https://ciencia.iscte-iul.pt/publications/predicting-hotel-booking-cancellations-to-decrease-uncertainty-and-increase-revenue/37158?lang=en)), but needs reservations.
- **Cloudbeds' "Signals"** claims 95% accuracy at 90 days and an 18% revenue lift. This is vendor marketing (c), and another newsletter reported 96% at 180 days, a conflict ([Cloudbeds](https://www.cloudbeds.com/articles/signals-ai-foundation-model/)).

**Measured RMS impact is low single digits.** The defensible business-impact figures come from operator-authored refereed case studies:
- **IHG:** price optimisation added 2.7% retail revenue (b) ([Interfaces 2012](https://ideas.repec.org/a/inm/orinte/v42y2012i1p45-57.html)).
- **Carlson Rezidor:** hotels that followed the system's prices "consistently" earned 2–4% more revenue than hotels that did not (b) ([Interfaces 2013](https://pubsonline.informs.org/doi/10.1287/inte.1120.0660)).
- **Independent organisational evidence:** a peer-reviewed study of 602 hotels found centralised RM functions outperform in-house and third-party ones on RevPAR index (a) ([IJHM](https://www.sciencedirect.com/science/article/abs/pii/S0278431917301159)). This concerns organisation, not system adoption.
- **Marketing figures:** a 2026 guide's "5–20% RevPAR uplift" traces to vendor material (c) ([RevEvolve](https://revevolve.ai/blog/hotel-revenue-management-software)).

**Every vendor wraps automation in guardrails.** Light tools set min/max bounds and send "nudges" that never auto-apply. Duetto and Atomize let users choose how much to automate. Atomize says 70% of its users run Autopilot (c) ([Hospitality Upgrade](https://www.hospitalityupgrade.com/news/mews-accelerates-ai-powered-revenue-growth-with-atomize-integration)).

**In Iran the binding constraint is regulation, not parity.**
- **How tariffs are set:** hotel tariffs are set in rials under a 1394 (2015) cabinet regulation. Each Mehr a ceiling on increases is announced, based on the Central Bank's inflation index, and rates are agreed provincially. The head of the hoteliers' association said there is "no such thing as rate liberalisation" ([Kojaro](https://www.kojaro.com/news/167015-ازادسازی-نرخ-هتل/)).
- **Discounting is the real lever:** hotels in six provinces offered 30–70% Nowruz discounts in 2018 ([Iran Times](https://iran-times.com/now-ruz-offers-hotel-deals/?amp=1)), and Khorasan Razavi hotels offered 50% off prices held at 1404 levels in Nowruz 1405 ([Kojaro](https://www.kojaro.com/news/308722-razavi-hotel-occupancy-nowruz/)).

**Iranian demand is lumpy and shock-prone.** National occupancy fell "below 40 percent" according to the hotel association head in August 2024 ([Tehran Times](https://www.tehrantimes.com/tag/occupancy+rate)). Two examples show the range:
- **Holiday peaks:** Mashhad hit 80% in the days between Eid al-Adha and Eid al-Ghadir in June 2024.
- **Shock troughs:** Khorasan Razavi managed only 25–30% in Nowruz 1405, which officials blamed on national conditions, no flights and fuel worries ([Kojaro](https://www.kojaro.com/news/308722-razavi-hotel-occupancy-nowruz/)).

Lunar religious holidays move about 11 days earlier each Gregorian year. STR shows how large such effects can be: Bahrain's RevPAR fell 18.9% during Ramadan 2016 ([Hospitality Net/STR](https://www.hospitalitynet.org/news/4077249.html)).

**Pre-arrival upsell needs reservations, guest contacts and a folio.** Its evidence is vendor-only:
- **Oracle Nor1:** almost $300M of upsell demand in a fiscal year, and 20% more upsell revenue when embedded in check-in (b/c) ([Oracle](https://www.oracle.com/news/announcement/hoteliers-continue-to-trust-oracle-to-boost-operations-and-guest-satisfaction-2025-06-16/)).
- **Oaky:** Hotel At Six earned more than 11 times the tool's cost (b) ([Hotel Tech Report](https://hoteltechreport.com/ja/success-stories/revenue-management/oaky/hotel-at-six)).

### Area 14: benchmarking and competitive intelligence

**How STR works.** STR (CoStar) benchmarking runs on reciprocal data sharing. A hotel submits daily occupancy, ADR and revenue and receives three indices against an anonymised competitive set, with 100 as fair share:
- **MPI**, the occupancy index;
- **ARI**, the ADR index;
- **RGI**, the RevPAR index.

STR's guidelines set privacy rules for the competitive set ([STR guidelines](https://str.com/sites/default/files/str-competitive-set-trend-reporting-guidelines.pdf)):
- at least 4 participating properties;
- at least 3 of them unaffiliated with the subject;
- no single property above 50% of supply.

STR covers the Middle East ([Hospitality Net](https://www.hospitalitynet.org/report/4040269/middle-east-january-data-from-str-global)). The notes found no evidence of Iranian coverage, and sanctions likely block paid rate-shopping tools such as Lighthouse. That is an inference, not a verified fact.

**Zarin already holds exactly the fields STR collects:** rooms available, rooms occupied and room revenue per day.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost / complexity | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Occupancy/ADR/revenue forecast with Iranian holiday calendar | Plan ops without bookings. Compute seasonal-naive and moving-average baselines, add ETS, then a pooled LightGBM with Solar-Hijri and lunar-holiday features. Select per hotel by backtest | Daily ops (have) plus an admin-maintained holiday table | Simple-baseline robustness (a); ML short-horizon gains (a); no vendor sells this for non-PMS hotels | Low–medium (n8n-scheduled Python job) | Med / High / High | **Now** |
| Variance and anomaly alerts (actual vs forecast, holiday-aligned last year) | Catch revenue drops early | Daily ops | Method only | Low | High / High / High | **Now** |
| Pooled STR-style benchmark (MPI/ARI/RGI vs anonymised peers by city and class) | No STR in Iran. Apply STR privacy rules plus tenant consent | Daily ops across tenants | STR methodology (a); comp-set forecast gains (a) | Medium (consent, anonymisation) | High / High / Med | **Now**, if enough hotels per city |
| Governed rate-calendar adviser | When to discount below the approved tariff. Max = نرخ مصوب (the approved rate); min = an ops-derived cost floor; role approval; audit log; no auto-apply | Daily history; **no on-the-books data, so it cannot react to pace** | Guardrail pattern is vendor practice (c); no impact evidence for history-only pricing | Medium | Med / Med / Low–Med | **Now, as weak decision support** |
| Pickup/pace forecasting and dynamic pricing | Real RMS | On-the-books by stay date and booking date | Chains +2–4% (b) | High | Low–Med / Med–High / High | **Needs reservations**. A daily "rooms booked for next N nights" snapshot unlocks additive pickup ([Heo et al.](https://link.springer.com/article/10.1057/s41272-023-00421-1)) |
| Cancellation/no-show prediction | Overbooking and deposit policy | Booking-level records | >90% accuracy (a) | Medium | — / Med / High | **Needs PMS** |
| Rate shopping and demand signals | Competitor awareness | External rate collection | Vendor tools (c); Iranian OTA scraping legality unresearched | Medium | — / Med / Med | **Later** |
| Upsell / attribute-based selling | Ancillary revenue | Reservations, contacts, folio | Vendor only (b/c) | High | Low / Med / High | **Needs PMS** |

**Zarin's distinctive pricing input is cost, not demand.** No RMS reviewed knows a hotel's variable cost per occupied room. Zarin can estimate it from housekeeping minutes, energy per occupied room and inventory issues, giving a defensible discount floor. Carlson's compliant-versus-non-compliant design is a cheap way to measure whether any recommendation feature works across Zarin's tenants.

## Housekeeping, workforce and service operations: deterministic logic captures most value

### Area 5: housekeeping optimisation and room allocation

**Commercial housekeeping optimisers combine three ingredients.** Optii, HotSOS, Flexkeeping, ALICE, Unifocus and OPERA Cloud all use:
- **a workload unit per room**, either credits or predicted minutes, by room type and task type;
- **a priority order driven by PMS events** such as departures, early check-in requests and VIP flags;
- **assignment rules** that balance workload across attendants and keep them in geographic clusters.

Oracle's documentation shows the deterministic core most hotels actually run ([Oracle docs](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/cc-auto-generate-tasksheets.htm)):
- credits per room are divided evenly across available attendants;
- each task sheet has a maximum-credit cap;
- leftover rooms go to an overflow sheet.

Proof News reports that HotSOS feeds checkouts, early check-in requests and VIP status into an algorithm that ranks which rooms to clean (a) ([Proof News](https://proofnews.org/hotel-housekeepers)). The arrival-driven priority layer needs PMS data. Credit balancing does not.

**Results are almost entirely vendor-reported.**
- **Optii, Holiday Inn Brisbane:** an **8.9% drop in room-attendant time per occupied room** (b) ([Hospitality Net](https://www.hospitalitynet.org/news/4048376.html)).
- **Optii, Staycity:** 20% higher productivity and rooms ready "nearly 2 hours quicker" (b) ([Hotel Tech Report](https://hoteltechreport.com/es/success-stories/marketing/optii/staycity-aparthotels)).
- **Flexkeeping, Hotel Oderberger:** daily room distribution fell from 60–70 minutes to 10 minutes (b) ([Hotel Tech Report](https://hoteltechreport.com/es/news/hotel-oderberger-berlin)).
- **Flexkeeping, REVO Munich:** claims a 716% ROI, flagged as not yet verified by the hotel (b) ([casestudies.com](https://www.casestudies.com/company/flexkeeping/case-study/revo-munich-saves-352-hours-monthly-and-boosts-roi-716-with-flexkeeping)).
- **A single-hotel time-and-motion study** found checkouts took about 43 minutes against 23 for stayovers. Giving checkouts double credit produced an **11% productivity gain** (between a and b) ([Hotel Management 2016](https://hotelmanagement.mydigitalpublication.com/january-2016-hm/page-20)).

The notes found **no independent controlled evaluation of any housekeeping vendor**.

**What the independent evidence does show.**
- **Task characteristics, not workers, drive cleaning time.** A peer-reviewed time study at a Spanish 4-star hotel found "none of the analyzed employee-related variables have any effect" on cleaning time; only task variables mattered (a) ([JIEM 2021](https://jiem.org/index.php/jiem/article/view/3441)).
- **Workers object to opaque dispatch and cross-floor routing.** Las Vegas housekeepers described HotSOS as "a device telling you, 'move here, move there,' like if you were a robot". The Culinary Union then negotiated a feature that keeps workers near their stations (a) ([Proof News](https://proofnews.org/hotel-housekeepers)). Peer-reviewed HCI work reports similar coordination strains ([NSF PAR](https://par.nsf.gov/biblio/10464186)).

**Room-to-guest assignment is a different, harder problem.**
- **Academic results need a reservation list.** The problem is NP-hard. Integer programmes (Li et al., [JRPM 2013](https://link.springer.com/article/10.1057/rpm.2011.37)) and the RoomTetris room-committing algorithms show that late assignment reduces gap nights and lets a hotel accept more demand at high occupancy (a) ([IJCHM 2021](https://emerald.com/insight/content/doi/10.1108/IJCHM-11-2020-1364/full/html)). Both need reservations.
- **Even Mews cannot do the simple version.** Mews confirmed in 2026 forum threads that it cannot auto-assign only clean rooms to same-day bookings ([Mews Community](https://community.mews.com/mews-pms-property-operations-83/automated-room-allocation-same-day-clean-rooms-3486)). A "ready-room-first" helper on Zarin's live room status fills a gap that a leading PMS still has.

**Room readiness is mainly an operations-research problem.** Two Cornell-linked studies show this:
- **Shift staggering:** using real data from a large city-centre hotel, Li & Slaugh (MSOM, Nov 2025) show that moving some attendants to later shift starts than the industry-standard 8 a.m. "can effectively eliminate guest waiting after the posted check-in time" (a) ([MSOM](https://pubsonline.informs.org/doi/pdf/10.1287/msom.2025.0395)).
- **Optimised staffing:** a Cornell thesis model saved up to 17% of total cost against an industry heuristic and cut guest waits by up to 80% (a) ([Cornell eCommons](https://ecommons.cornell.edu/entities/publication/20d34780-3ee2-4e8c-8db8-2670ea9d8561)).

### Area 9: workforce planning

**Hotel labor systems all use the same chain.** Unifocus, Actabl Hotel Effectiveness and Legion:
1. forecast volume drivers;
2. multiply them by per-unit labor standards (minutes or hours per occupied room);
3. convert the result to shifts;
4. track actual against standard.

**Current US benchmarks** come from HotelData.com's survey of about 5,000 hotels. Select-service room-attendant minutes per occupied room (MPOR) fell from 24.01 to 22.82 in H1 2026 ([Hospitality Net](https://www.hospitalitynet.org/news/4134424/hoteldatacom-h1-2026-labor-report-shows-improved-productivity-as-demand-and-wages-rose)). Wage cost per occupied room still rose from $42.82 in 2024 to $48.32 in 2025 ([Hospitality Net](https://hospitalitynet.org/news/4131380/new-hoteldatacom-report-finds-hotel-labor-costs-rising-faster-than-productivity-gains)).

**Vendor impact claims are marketing:**
- Unifocus cites 6–10% labor savings (c) ([Unifocus](https://www.unifocus.com)).
- Legion claims 66% less time spent scheduling (c) ([Legion](https://www.legion.co/industries/hospitality)).

**Regulation sets the design guardrails.**
- **EU AI Act.** Annex III point 4(b) classes as high-risk any AI that allocates tasks "based on individual behaviour or personal traits" or monitors worker performance ([AI Act Blog](https://www.aiactblog.nl/en/posts/high-risk-ai-employment)). The May 2026 Digital Omnibus deal postponed these obligations to 2 December 2027, pending formal adoption ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/)).
- **Los Angeles.** The city's hotel ordinance caps cleaning at 3,500–4,000 sq ft per 8-hour day, with reductions for checkouts. That is a ready-made pattern for a workload cap ([Littler](https://www.littler.com/news-analysis/asap/panic-buttons-and-workload-limits-los-angeles-hotel-workers-get-new-protections)).
- **Iran.** Vendor summaries give the Iranian labour-law rules as 8 hours a day, 44 hours a week, overtime by consent at +40%, and roughly 4 hours a day of overtime maximum. Verify against the statute ([Rivermate](https://rivermate.com/guides/iran/working-hours)).

### Area 1: AI operations intelligence and decision-making

**Service-optimisation platforms are mature.** HotSOS, ALICE, Knowcross, Quore, hotelkit and Flexkeeping centralise requests, route and escalate them on SLA, and report response times. Their published impact is thin and mostly old:
- **HotSOS, Mandarin Oriental New York (2005):** requests taking over six minutes fell by 75% or more (b) ([Hospitality Upgrade](https://www.hospitalityupgrade.com/news/mandarin-oriental-new-york-accelerates-service-with-mtechs-hotsos)).
- **hotelkit, Dorint:** 85% of internal communication moved off email (b) ([Hotel Tech Report](https://hoteltechreport.com/news/operational-efficiency-hotelkits-impact-at-dorint-hotel-worms)).
- **Flexkeeping, REVO Munich:** 85% fewer phone calls (b) ([casestudies.com](https://www.casestudies.com/company/flexkeeping/case-study/revo-munich-saves-352-hours-monthly-and-boosts-roi-716-with-flexkeeping)).

The measurable gains come from removing phone and radio handoffs, which is what Zarin's n8n event router already does.

**The most important decision-making principle is architectural: compute numbers in code, never in the LLM.**
- **OpenAI's GSM8K authors** wrote that their models "frequently fail to accurately perform calculations" and trained them to use a calculator (a) ([openai/grade-school-math](https://github.com/openai/grade-school-math)).
- **Program-of-Thoughts prompting** offloads computation to a Python interpreter and beats chain-of-thought by an average of 12% on numerical-reasoning benchmarks (a) ([arXiv 2211.12588](https://arxiv.org/abs/2211.12588)).
- **Anthropic's documentation** says hallucination-reduction techniques "don't eliminate them entirely" ([Claude docs](https://docs.claude.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).

For Zarin, rial figures run to billions with mixed rial and toman units. Every KPI should be computed in PocketBase hooks, n8n or SQL. The LLM should only narrate, and a check should reject any narrative number that is not in the computed input.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Learned cleaning standards | Fixed credits drift from reality. Compute median/p75 minutes per room type × task type from completed tasks, nightly | Task timestamps, room type, task type | (b) Optii "look up" ([HTR](https://hoteltechreport.com/fr/success-stories/marketing/optii/the-godfrey-hotel-cabanas-tampa)); task-not-worker finding (a) | Low | Low / High / High | **Now** |
| Credit-balanced, zone-constrained assignment with daily cap | Room counts ignore that checkouts take about twice as long. Longest-task-first greedy assignment by floor, LA-style cap, overflow list, full-day list visible to attendants | Room type, floor/wing, task type (derivable from status), on-shift staff | 11% at one hotel; OPERA/Quore implement it | Low | Low / High / High | **Now** (needs floor/wing fields) |
| Projected clean-room inventory at check-in time | Avoid readiness shortfalls. Simulate each attendant's queue with learned minutes | Queue, learned minutes, shifts; arrivals from manual reception input | (a) MSOM 2025 framing; (b) Staycity | Low–medium | Low / High / High | **Now (supply side)**; demand side needs arrivals |
| Shift-staggering recommendation | Idle 8 a.m. starts, late-ready rooms. Use checkout-time distribution from occupied→vacantDirty transitions | Room-status history | (a) Li & Slaugh 2025 | Medium | Low / High / High | **Partial now** |
| Ready-room-first suggestion at check-in | Assign clean rooms first | Live room status | Inferred from the Mews gap | Very low | Med / Med / Med | **Now** |
| Gap-minimising room assignment / upgrades | Fewer gap nights, more accepted demand | Reservations | (a) RoomTetris, JRPM | Medium–high | Low / Med / High | **Needs PMS** |
| Labor KPIs (MPOR, HPOR, absence) and staffing forecast | Labor is the largest cost. Forecast occupancy and departures × learned minutes ÷ shift minutes | Tasks, shifts, occupancy (departures via a status-transition proxy) | Benchmarks; (a) Thompson, Li 2020; (c) vendors 5–10% | Low–medium | Med / High / High | **Now** |
| Iranian labor-law compliance alerts | Overtime and Friday rules | Shifts | Statute summaries (verify) | Low | High / High / High | **Now** |
| Individual productivity scoring | — | Per-person speed | (c) Legion; high-risk under AI Act 4(b) | Low tech, high risk | — | **Not recommended** |
| SLA analytics, breach-risk alerts, backlog ageing, hourly queue arithmetic | Find bottlenecks | Ticket and task timestamps, SLA | (b) HotSOS 2005 | Low | Med / High / High | **Now** |
| Event-driven cross-department handoffs | Inspection fail → ticket; "blocks room" → outOfOrder; resolved → re-clean | Status and ticket events | (b) 85% fewer calls/emails | Low–medium | High / High / High | **Now** (n8n) |
| Out-of-order revenue-impact estimate | OOO room-nights × ADR | Daily revenue, occupancy, OOO status | None found | Low | Med / Med / High | **Now** |

## Maintenance and energy: sensors earn the big savings, meters earn credibility

### Area 6: predictive maintenance

**Independently measured "AI maintenance" results come from sensor-based fault detection.** The LBNL/DOE Smart Energy Analytics Campaign covered about 104 organisations. It found that building fault detection and diagnostics (FDD) delivered a **median 9% whole-building energy saving, ranging from 1% to 28%**. Median cost was $0.06/ft² to install plus $0.02/ft²/yr, with roughly a 2-year payback. Meter-level energy information systems achieved only about **3–4%** (a) ([LBNL report](https://smartenergyanalytics.org/assets/EMIS%20Report.pdf); [Energies 2022](https://doi.org/10.3390/en15134858)).

**Most faults are silent.** LBNL's study of more than 60,000 HVAC units found that on a typical day **40% of air-handling units and 30% of terminal units had at least one fault** (a) ([LBNL](https://bies.lbl.gov/publications/empirical-analysis-prevalence-hvac)). Tickets therefore capture only symptomatic failures.

**Tickets support analytics, not failure prediction.**
- **No independent ML failure prediction from hotel work orders alone was found** in the notes.
- **Work-order counts do track asset condition.** A dated case study of a 618-room Hong Kong hotel found equipment downtime correlated significantly with the number of work orders (a, 2001) ([PolyU](https://research.polyu.edu.hk/en/publications/hotel-engineering-facilities-a-case-study-of-maintenance-performa/)).
- **Failure data is sparse.** NIST warns that rare failures get swamped by non-failure records ([NIST](https://www.nist.gov/document/artificial-intelligence-key-consideration-and-effective-implementation-strategies)). Reliability heuristics suggest 5–10 failures per failure mode before a Weibull shape is even directional (c) ([Fabrico](https://www.fabrico.io/blog/weibull/)).
- **The vendor examples are building control, not hotel ticket prediction:**
  - JCI OpenBlue cut chilled-water plant energy 10.2% at Resorts World Las Vegas, worth $110,000 a year (b) ([JCI](https://www.johnsoncontrols.com/media-center/news/press-releases/2026/07/24/johnson-controls-helps-resorts-world-las-vegas-unlock-%24110000-in-annual-energy-cost-savings)).
  - Hotel CMMS vendors (HotSOS, Quore) sell preventive-maintenance scheduling, not validated prediction.

### Area 7: energy and smart building

**Guestroom occupancy controls have the best independent evidence.**
- A California utility codes analysis expects **12–25% savings of guest-room HVAC energy** (a) ([CASE report](https://title24stakeholders.com/wp-content/uploads/2020/01/2013_CASE-Report_Guest-Room-Occupancy-Controls-2.pdf)).
- A utility field test found cooling savings only when the daily mean outdoor temperature exceeded 20°C (a, 2010) ([ETCC](https://etcc-ca.com/reports/occupancy-based-guestroom-controls-study)). That favours Iranian summers.
- The one third-party-metered hotel study, at the Washington Hilton, showed about 57% estimated HVAC savings for networked rooms against 27% for standalone rooms (a\*) ([Honeywell PDF](https://buildings.honeywell.com/content/dam/hbtbt/en/documents/downloads/honeywell_INNCOM_Washington_Hilton_Case_Study.pdf)).

**Vendor results cluster higher.**
- Verdant reports a 31% runtime reduction at Landmark London (b) ([Verdant](https://verdant.copeland.com/wp-content/uploads/2025/07/Landmark_Case_Study_Final.pdf)).
- BrainBox AI reports a 34% cut in common-area energy at Holiday Inn Longueuil (b) ([BrainBox](https://brainboxai.com/fr/etudes-de-cas/realizing-energy-savings-in-a-hotel-with-ai)). An analyst notes "independent verification data is limited publicly" since Trane acquired BrainBox ([Memoori](https://memoori.com/trane-technologies-ai-strategy-smart-buildings/)).
- Runtime, energy and bill reductions are not interchangeable metrics.

**The big groups run monthly utility-data platforms and report modest intensity gains.**
- **Marriott:** 334.4 kWh/m² in 2016 to 298.1 kWh/m² in 2024 (s) ([Marriott tables](http://serve360.marriott.com/wp-content/uploads/2025/07/2025PerformanceTables.pdf)).
- **IHG:** energy per available room −9.4% from 2019 to 2024 (s).
- **Hilton:** a Cornell analysis of LightStay data for 2008–2018 found energy intensity −22% (a) ([Cornell](https://ecommons.cornell.edu/entities/publication/e237a789-6558-4eae-9d3f-07689e723b20)).

These are measurement-and-accountability systems. Zarin's daily meter data is already more granular than their monthly inputs.

**Daily totals are enough for audit-grade baselines.**
- **Training data:** LBNL tested 537 buildings and found that daily-total baselines reach a median CV(RMSE) below 25% with 12 months of training data, and often with just 6 (a) ([Applied Energy 2016](https://buildings.lbl.gov/sites/default/files/applied-energy-173-2016.pdf)).
- **Fit standards:** ASHRAE Guideline 14 requires CV(RMSE) of at most 20% (or 25% for 12–60 months of post-period data) and fractional savings uncertainty below 50% at 68% confidence ([EVO](https://evo-world.org/en/m-v-community/mv-focus/903-m-v-focus-issue-no-10/1338-relaxing-cv-rmse-requirements-for-option-c-m-v-regressions)).
- **Drivers:** hotel regressions consistently find cooling degree-days plus occupied rooms are the drivers (a) ([NJIT/E&B 2017](https://researchwith.njit.edu/en/publications/long-term-field-investigation-and-modeling-of-electricity-end-use/)).
- **Weather data:** NASA POWER temperature data is CC BY 4.0. Open-Meteo's free API is non-commercial only ([Open-Meteo terms](https://open-meteo.com/en/terms)).

**Any optimisation needs safety guardrails.** ECDC tells tourist accommodation to keep hot water at 50–60°C and run taps weekly in unoccupied rooms ([ECDC](https://www.ecdc.europa.eu/en/node/16490)). Secondary sources give ASHRAE 188 practice as storing at 60°C or more and circulating at 50°C or more.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Normalised daily energy baseline (IPMVP Option C) | A static baseline misleads. Fit change-point regression on CDD/HDD plus occupied rooms, with G14 statistics | Daily meters (have), occupancy (have), temperature (add via NASA POWER) | Method (a); 6–12 months sufficient (a) | Low–medium | High / High / High | **Now** (single highest-value energy upgrade) |
| CUSUM savings and drift tracker | Small persistent waste is invisible. Running sum of actual − predicted, in kWh/m³ not rials | Baseline output | Standard monitoring-and-targeting practice | Low | High / High / High | **Now** |
| Daily anomaly alerts (electricity, water, gas) | Leaks, stuck equipment. Residual > k·σ; water per occupied room > P95 | Daily totals | No hotel-specific study | Low | High / High / High | **Now** |
| Intensity KPIs and CO2e per occupied room (LightStay/HCMI-lite) | Targets and portfolio ranking | Add floor area. Iran grid factor 494 gCO2/kWh ([Ember](https://ember-energy.org/latest-insights/global-electricity-review-2023/country-and-region-deep-dives/)) to 509 ([LowCarbonPower](https://lowcarbonpower.org/region/Iran)) | Group practice (s); HCMI v3.0 (a) ([SHA](https://sustainablehospitalityalliance.org/wp-content/uploads/2026/04/HCMI-v3.0-Process-Flow-04.17.2026-.pdf)) | Low | Med / High / High | **Now** |
| Tariff, peak and outage resilience view | Iranian grid deficits. Peak-risk calendar, outage and generator log, pre-cooling checklists | Tariffs (have) plus a new outage log | News reporting only | Low | High / High / High | **Small addition** |
| Maintenance intelligence (Pareto, repeat-fault flags, MTTR/SLA, cost per room, HVAC tickets vs CDD) | Where failures concentrate | Tickets (have) | Work orders ↔ downtime (a, 2001); ≥3-in-90-days heuristic (c) | Low | High / High / High | **Now** |
| PM and compliance scheduler (legionella flush, DHW logs, generator tests) | Safety plus uptime | New PM templates | ECDC (a); Quore/HotSOS sell it (b) | Low | High / High / High | **Now** |
| Energy↔maintenance linkage | CUSUM drift surfaces open HVAC/plumbing tickets; post-repair verification | Baseline plus tickets | Fault prevalence (a); linkage itself (d) | Medium | Med / High / High | **Now** |
| M&V service for third-party retrofits | Owners "lack confidence" in vendor claims ([DOE CREEA](https://www1.eere.energy.gov/buildings/publications/pdfs/alliances/creea_guest_room_occupancy-based_controls_report.pdf)) | Baseline plus intervention date | IPMVP/G14 (a) | Medium | Low / Med / High | **Now** |
| Ticket-volume forecasting | Staffing and spares | ≥12 months per category | (d) | Medium | Low / Med / Med | **Gate on history** |
| Weibull/MTBF reliability per asset class | True predictive maintenance | **Equipment register**, about 10–20 failures per class | Standard practice; small-sample caveats | Medium | Low / Med / High | **Needs asset register**; pool across tenants |
| FDD, GREMS, AI supervisory HVAC | The 9–25% savings tier | BMS, room sensors, PMS | (a) 9% FDD, 12–25% GREMS; (b) 10–34% AI control | High (hardware) | Low / Med / High | **Later** |

**Set savings expectations by tier.** For software-only monitoring, anchor promises to the LBNL meter-level median of about 3–4%. Reserve 9%-plus claims for when FDD or room controls exist.

## F&B, finance and fraud: measurement and rules on the ledger, with thin finance evidence

### Area 8: F&B inventory and food waste

**The strongest independent food-waste evidence does not depend on AI.** The Champions 12.3/WRAP/WRI study analysed **42 hotel sites in 15 countries** ([Champions 12.3](https://champions123.org/the-business-case-for-reducing-food-loss-and-waste-hotels/); [Successful Meetings](https://www.successfulmeetings.com/News/Research-Whitepapers/Study-Business-Case-Hotels-Reducing-Food-Waste)):
- **an average 21% cut in kitchen food waste within one year**;
- **$7 saved per $1 invested**;
- more than 70% of sites recouped their investment within a year;
- nearly 90% spent under $20,000.

The method is "target, measure, act". Two more findings point the same way:
- **WRAP's Crieff Hydro case:** smart scales identified buffets as the main source, and waste per cover fell 31%, from 169 g to 117 g (a, 2014, uncontrolled) ([WRAP](https://wrap.ngo/resources/case-study/crieff-hydro)).
- **Buffet messaging alone does not work:** in a University of Queensland field test, none of the table signs reduced plate waste and two lowered guest satisfaction (a) ([Foodservice Footprint](https://foodservicefootprint.com/buffet-banners-fail-to-reduce-food-waste/)).

**Camera AI is where the chains actually deployed food-waste technology.**
- **Winnow:** Hilton, Accor, Marriott, Mandarin Oriental and other operators collectively save more than $100M a year (c, company-reported). Accor has 200+ hotels on it. Mandarin Oriental's four pilot hotels cut waste 36% in six months (b) ([Hotel Dive](https://www.hoteldive.com/press-release/20260429-hospitality-operators-using-winnows-ai-now-saving-100-million-in-food-was-1/)).
- **Leanpath:** case studies report −50% to −66% at single hotels, which are selected best performers (b) ([Leanpath, Alfonso XIII](https://info.leanpath.com/case-study-hotel-alfonso)).
- **Kitro:** Innosuisse, which funded it, reports a cut of about 28% across about 12 luxury hotels ([Innosuisse](https://www.innosuisse.admin.ch/en/less-food-waste-thanks-to-artificial-intelligence)).

The camera mainly removes logging friction. Zarin's existing `waste` movement type can deliver the "measure + act" programme without hardware.

**Purchasing maths is standard and deterministic.** The core formulas ([Cleverence](https://www.cleverence.com/articles/for-business/safety-stock-reorder-point-calculation-4721/); [Wikipedia: EOQ](https://en.wikipedia.org/wiki/Economic_order_quantity)):
- reorder point = lead-time demand + safety stock;
- safety stock = z·σ·√L;
- EOQ = √(2DS/H).

The one hotel-specific forecasting result is a Cornell CHR study of 27 methods across 41 outlet scenarios. **Adding occupancy improved F&B forecast accuracy by more than 11% on average**, and occupancy-based models won in 34 of 41 scenarios (a, research report) ([Cornell eCommons](https://ecommons.cornell.edu/entities/publication/0ca59ff6-c754-4a89-b897-5c3090669887)). Zarin stores rooms sold, so usage-per-occupied-room drivers are immediately feasible.

AI-forecasting vendor claims are self-reported and restaurant-centric. For example, Tenzo claims forecasts 30–50% more accurate than rolling averages (c) ([Tenzo](https://www.gotenzo.com/resources/insight/ai-demand-forecasting-for-restaurants/)).

**Menu engineering and theoretical-versus-actual food cost need POS item sales and costed recipes.** Both are deterministic, but a widely quoted "~10% profit" figure for menu engineering could not be traced to a verifiable study ([Wikipedia: Menu engineering](https://en.wikipedia.org/wiki/Menu_engineering)).

### Area 10: financial intelligence and budgeting

**This area has no externally verified evidence in the notes.** The search budget ran out before it could be researched, so USALI 12th-edition details, GOP definitions and IAS 29 hyperinflation status are all flagged as unverified background. The design reasoning is still sound and deterministic.

**What Zarin can build without new data.** A "USALI-lite" view can show:
- rooms, F&B and other revenue;
- F&B cost of sales, approximated from inventory issues tagged to F&B;
- utilities and maintenance as undistributed expenses;
- standard KPIs: occupancy, ADR, RevPAR, TRevPAR, energy cost per occupied room and food cost %.

Payroll is invisible, so the result must be labelled "partial operating profit", never GOP.

**What needs small additions.**
- **Budget versus actual** needs a `budgets` collection. A flexible budget (budgeted cost per occupied room × actual rooms sold) separates volume effects from efficiency effects.
- **Real-terms trends** need a CPI table. Under rial inflation, every report should show quantities and ratios beside rial amounts and deflate the rial series. The CPI source was not verified.

The only sourced market signal is Duetto's repositioning as a "revenue and profit platform" through the FLYR deal ([Travel PR News](https://travelprnews.com/duetto-buys-flyr-hospitality-to-deepen-ai-powered-hotel-revenue-and-profit-platform/travel-press-release/2026/10/08/)).

### Area 15: anomaly, fraud and risk

**The detection methods are open and well documented:** rules, z-score and IQR fences, Benford first-digit tests ([benford_py](https://github.com/milcent/benford_py)) and Isolation Forest ([scikit-learn](https://github.com/scikit-learn/scikit-learn/blob/main/doc/modules/outlier_detection.rst)). Zarin's movement ledger records who, what, when, how much and at what unit cost, which is exactly the audit trail these methods need.

**What the notes could not establish.**
- **Prevalence:** hospitality fraud statistics (ACFE, HFTP) could not be retrieved, so no prevalence figure is given here.
- **Risk records:** operational-risk and HACCP-style records were not researched externally. Incident logs, expiry/FEFO tracking and temperature logs remain design proposals.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Waste programme (cost, waste %, Pareto, per room sold, by shift/actor, vs a 50%-by-2030 target) | Food-cost leak | Ledger `waste` rows; add a `reason`/`stage` enum | (a) 21% / 7:1; (b) −25% to −66% | Low | High / High / High | **Now** (small enum addition) |
| Camera/scale AI waste classification | Logging friction | Scales plus camera | (b/c) Winnow, Leanpath, Orbisk, Kitro | Hardware subscription | Low / Med / High | **Later**; optional photo-on-waste-entry as a stand-in (d) |
| Usage forecast, days of cover, dynamic reorder point/safety stock/EOQ | Stockouts and over-ordering | `issue` history, unit cost; add supplier lead time | Standard OR (a); occupancy +11% (a) | Low | High / High / High | **Now** (configurable lead time) |
| Driver-based par levels and "pseudo-TvA" (usage per room sold vs chef standard) | Consumption control without recipes | Rooms sold, issues | Cornell occupancy finding (a) | Low | Med / High / High | **Now** |
| Unit-price inflation tracking per item | Rial inflation, price padding | Successive `receive` costs | Method | Low | High / High / High | **Now** |
| Actual food cost % | Period cost control | Department tags, period counts | Formula docs | Low | High / High / High | **Small addition** |
| TvA variance and menu engineering | Portioning, theft, menu mix | POS item sales plus recipes | No verified profit study | Medium | Low / Med / High | **Needs POS + recipes** |
| USALI-lite KPIs and partial profit | Owner reporting | Daily ops, ledger, energy and maintenance costs | Unverified this session | Low | High / High / High | **Now** |
| Budget vs actual, flexible budget, CPI-deflated trends | Planning under inflation | `budgets` and CPI collections | Unverified | Low | High / High / High | **Small addition** |
| True GOP/GOPPAR, departmental P&L | Full financials | Payroll, GL | Unverified | Medium | — / Med / High | **Needs GL import** |
| Inventory fraud rules (shrinkage by actor, segregation of duties, price jumps vs inflation trend, after-hours and back-dated entries, duplicates, Benford monthly) | Shrinkage and procurement abuse | Ledger (have); PO linkage later | Methods (a); no hotel prevalence data | Low | High / High / High | **Now** |
| Isolation Forest over item/actor feature vectors | Combinations that rules miss | Months of ledger data | (d) for Zarin; flags need human review | Medium | Low / Med / High | **Later experiment** |
| POS void/comp, night-audit, rate-override, payroll-ghost detection | Front-of-house fraud | POS, PMS, payroll | Not retrieved | Medium | — / Med / High | **Needs integrations** |
| Incident log, expiry/FEFO, fridge temperature log | Food safety, insurance evidence | New collections | Not researched (design only) | Low | High / High / High | **Small addition** |
| LLM narration with a numeric-consistency check | Explain without mis-computing | Computed KPIs | (a) GSM8K, PoT, Anthropic docs | Low | High / High / High | **Now** |

## Guest-side AI: strong evidence, but blocked by missing guest data

### Area 4: guest personalisation and CRM

**Personalisation runs on guest profiles**, held in a PMS, CRM or CDP:
- Bookboost unifies more than 70 sources ([Conduit review](https://www.conduit.ai/blog/bookboost-review-pricing-alternatives)).
- IHG runs an AI-enabled CRM.
- Oracle's AI room assignment uses previous stays and preferences ([Oracle](https://www.oracle.com/news/announcement/new-ai-capabilities-in-oracle-opera-cloud-supercharge-hotel-operations-2026-06-16/)).

**No independent hotel-specific uplift study was found.** One vendor example links personalisation to operations: Canary's loyalty-points opt-out from daily housekeeping cut daily cleanings 20% at a 156-room Holiday Inn Express (b) ([Canary](https://www.canarytechnologies.com/customers/holiday-inn-express-suites-at-orlandos-seaworld)).

**GDPR is the reference design frame:**
- purpose limitation and data minimisation (Art. 5);
- special-category data (Art. 9);
- EDPB guidance that **inferred** health, religion or orientation data is itself special-category ([EDPB 8/2020](https://www.edpb.europa.eu/system/files/2021-04/edpb_guidelines_082020_on_the_targeting_of_social_media_users_en.pdf)).

**Iran has no enacted comprehensive data-protection law** in the sources found:
- the cabinet approved a government bill on 10 July 2024 ([Peivast](https://peivast.com/p/202493));
- a later 41-MP plan was weak because no urgency was attached ([Peivast](https://peivast.com/p/212052));
- no enactment by October 2026 was found.

The 2021 parliamentary plan was explicitly modelled on GDPR ([ResearchGate](https://www.researchgate.net/publication/371358842_Personal_Data_Protection_in_the_Iranian_Legal_System)). Building to GDPR-like principles now therefore lowers re-work risk.

### Area 11: sentiment and reputation

**The research base linking reputation to money is solid.**
- **Anderson (Cornell CHR, 2012):** a 1% increase in online reputation was associated with ADR up to 0.89% higher, occupancy up to 0.54% higher and RevPAR up to 1.42% higher (a, industry-partnered report) ([Cornell PDF](https://sha.cornell.edu/wp-content/uploads/sites/4/2019/03/anderson-social-media.pdf)).
- **Proserpio & Zervas (*Marketing Science*, 2017):** hotels that responded to reviews gained **0.12 stars and 12% more reviews** (a) ([BU Open Access](https://open.bu.edu/items/9b759580-53d3-44ff-975e-c17d5641abcc)).

**Commercial tools do not publish their methods.** ReviewPro, TrustYou and Revinate aggregate 80 to 140+ sources with aspect-level sentiment but publish no models or accuracy figures. TrustYou users report misclassified sarcastic and multilingual reviews ([Hotel Tech Report](https://hoteltechreport.com/compare/reviewpro-vs-trustyou)).

**Persian classification is feasible today; Persian translation is not reliable.**
- **Classification models exist.** ParsBERT scores 92.42 on SentiPers binary sentiment ([ParsBERT](https://arxiv.org/pdf/2005.12515)). A 2025 study put frontier LLMs at a **Persian sentiment macro-F1 of about 0.80** ([arXiv 2509.14922](https://arxiv.org/abs/2509.14922)).
- **Translation lags.** GPT-4's English→Persian translation scored only BLEU 8.7 in a 2024 benchmark (a) ([arXiv 2404.02403](https://arxiv.org/abs/2404.02403)).
- **Datasets are thin for hotels.** The SemEval-2016 Arabic hotel ABSA dataset (2,291 reviews, 24,028 annotated tuples) suits Iraqi guests' reviews ([GitHub](https://github.com/msmadi/ABSA-Hotels)). No sizeable Persian hotel-review dataset was confirmed.
- **Access is the hard part.** No public review API from Snapptrip, Jabama or Alibaba.ir was found.

**Complaint recovery is the most Zarin-ready guest feature.**
- **Faster recovery raises satisfaction.** In a lodging experiment, 30-minute recovery beat 2-hour recovery. The same paper cites a study of 11,000 upscale-hotel complaints in which only 68% of recoveries met the guest's expected timeframe (a) ([JHTM 2018](https://www.sciencedirect.com/science/article/abs/pii/S1447677018302912)).
- **Response time predicts outcomes.** In a study of 446 hotel e-complainants, response time was directly related to satisfaction and repurchase intent (a) ([IJHM 2003](https://www.sciencedirect.com/science/article/abs/pii/S0278431903000148)).
- **Speed is not always best.** A JSM experiment found that delayed recovery can work better for highly emotional customers (a) ([Emerald JSM](https://www.emerald.com/insight/content/doi/10.1108/jsm-04-2017-0126/full/pdf)). Escalation should route angry guests to a manager, not to an auto-reply.

### Area 13: multilingual assistants

**Guest-messaging AI is crowded, and every figure is vendor-measured "automation".**
- **HiJiffy, GHT Hotels:** 89% of enquiries resolved and €733,000 of chat bookings in 2024 (b) ([Hospitality Net](https://www.hospitalitynet.org/news/4129514.html)).
- **Canary:** 82% of guest communication automated at the Orlando property (b) ([Canary](https://www.canarytechnologies.com/customers/holiday-inn-express-suites-at-orlandos-seaworld)).
- **Akia:** user reviews report "inaccurate or inappropriate" auto-replies ([Hotel Tech Report](https://hoteltechreport.com/compare/akia-vs-duve-communication-hub)).

**Two staff-side patterns need no guest channel and are shipping in 2026.**
- **Staff–guest translation:** examples include Pocketalk, which claims 92+ languages (c) ([Pocketalk](https://pocketalk.com/en_ca/additional-industries)).
- **SOP-grounded staff assistants:** OPERA Cloud Assistant, Accor's The Butler, Apaleo Copilot and Hyatt's ChatGPT Enterprise.

**Iran's inbound source markets set the language list.** Secondary reports citing the Statistical Centre put **Iraq above 2.2 million arrivals in 2024, Afghanistan about 967,000 and Turkey about 411,000** ([Visit Our Iran](https://www.visitouriran.com/blog/iran-tourism-insights-2024/)). Totals conflict with other sources, so treat this as directional. The priority languages are therefore Arabic (Iraqi dialect), Turkish and Azerbaijani, then English.

**Guest text is untrusted input.**
- **Prompt injection:** OWASP ranks it first (LLM01:2025) and says RAG does not fully mitigate it ([OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
- **Liability:** Moffatt v. Air Canada held a company liable for its chatbot's wrong fare advice ([ABA](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/)).
- **Consequence:** anything guest-binding (prices, policies, refunds) needs human approval.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Guest-issue intake and AI categorisation | Complaints get lost across departments. Persian voice/text → strict JSON (department, category, urgency, room) → ticket or task | Tickets/tasks (have); add `origin`, `guestImpact`, `firstResponseAt`, follow-up fields | (a) recovery timing; (b) AI speed-ups | Low | High / High / High | **Now** |
| Service-recovery SLA, escalation, "guest satisfied?" follow-up | Slow recovery. Type-specific SLAs (e.g., 30 min for in-room comfort); n8n escalation | As above | (a) 30 min > 2 h | Low | High / High / High | **Now** |
| Staff–guest translation with a verified phrasebook | Staff cannot talk to Arabic/Turkish/Azerbaijani guests. ASR → MT → TTS, ephemeral, with curated high-stakes phrases | None stored | (c) only; Persian MT caveats (a) | Low–medium | Med–High (city-dependent) / High / High | **Now** |
| Persian SOP/KB RAG assistant grounded in hotel docs and PocketBase data | New and seasonal staff, inconsistent procedures. Cites SOP section; refuses when the answer is not in the KB | Hotel-authored SOPs (to be uploaded) | Deployments (Oracle, Accor, Apaleo); no outcome metrics | Low–medium | Med / High / High | **Now** |
| Review import plus Persian/Arabic/English ABSA dashboard linked to tickets | Recurring issues hidden in reviews. Manual CSV/paste first | Review text | (a) reputation → ADR | Medium | Low / Med–High / High | **Next** (manual import) |
| AI-drafted review replies, human-approved | Response lift | Reviews | (a) responding +0.12 stars; no evidence AI drafts do better | Low | Low / Med / High | **Next** |
| Guest bot (Bale/web via room QR) feeding the same intake pipeline | Repetitive questions, after-hours requests | Guest channel; pseudonymous room + stay token | (b/c) only | Medium–high | Med / High / High | **Later**. The Bale bot API is Telegram-style ([Bale SDK](https://github.com/ErfanVahabpour/Bale-Bot-SDK)) |
| Guest profiles, segmentation, next-best-offer, loyalty | Repeat-guest revenue | Guest identity, stay history, consent | (c) only | High | Low / Med / High | **Later** (PMS plus consent design) |

## Agentic AI across departments: supervised, single-agent, approval-gated

### Area 12

**Documented hospitality agents are narrow and supervised.** The 2025–2026 deployments fall into four groups:
- **Contact-centre agents:** Wyndham.
- **Messaging agents** that execute a limited set of PMS actions with staff in control: Mews Agent, Accor ALL Concierge and The Butler, Stayntouch.
- **In-PMS staff assistants:** OPERA Cloud Assistant, Choice CHARLIE.
- **MCP servers** exposing PMS actions to external agents: Apaleo, SiteMinder ([Apaleo](https://apaleo.com/blog/apaleo-news/apaleo-launches-mcp-server)).

**Upsell agents already use human approval.** Oracle's eStandby lets guests request upgrades that staff approve or decline before OPERA auto-actions them ([Oracle datasheet](https://oracle.com/at/a/ocom/docs/industries/hospitality/hosp-nor1-estandby-ds.pdf)).

**Revenue management sits at the autonomy frontier.** FLYR runs fully autonomous pricing with optional guardrails. Duetto's CTO says AI's role today is "the work around the decision, not the pricing call itself" ([Hotel Management](https://hotelmanagement.mydigitalpublication.com/publication/?i=868825&article_id=5195912&view=articleBrowser)).

Accor's AI chief warns that agentic AI is "far harder than consumer chatbots imply inside a corporation" ([Skift](https://skift.com/2026/09/28/skift-data-ai-summit-europe-preview-accor-nicolas-maynard/)).

**Developer guidance converges.**
- **Anthropic, "Building effective agents"** ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)):
  - start with the simplest solution;
  - distinguish predefined workflows from autonomous agents;
  - add complexity only when it measurably helps;
  - cap iterations;
  - design tools carefully.
- **Anthropic, multi-agent research system:** multi-agent systems use about **15 times the tokens of chat**. They suit breadth-first, parallelisable tasks, not domains with shared state ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)).
- **Not fetched; verify before quoting:**
  - OpenAI's agent guide: maximise a single agent first; require human approval for irreversible or financial actions.
  - OWASP LLM06 "Excessive Agency": least privilege; authorise in downstream systems, not in the LLM.

**What this means for hotel operations.** Hotel ops is shared-state, dependency-heavy work. That argues against multi-agent designs for Zarin.

| Feature | Problem → how it works | Data | Evidence (labelled) | Cost | Value S / M / L | Zarin fit |
|---|---|---|---|---|---|---|
| Approval-gated task agent ("create/route/update" across housekeeping, maintenance, inventory) | Coordination time. A single tool-calling LLM over thin wrappers of PocketBase v1 routes, executed with the **requesting user's token** so API rules enforce role-based access. Write actions become rows in an `ai_proposals` collection (pending/approved/executed, risk tier, diff, audit) that a role-holder approves | Rooms, tasks, tickets, roster, SOPs | Company-reported only: Choice −40% support requests; Accor 30 min → 1 min | Medium (tool layer, approval UI, ~20-query eval set) | Med / High / High | **Now** |
| Morning briefing / exception digest | Managers drown in dashboards. Deterministic alerts → LLM narrative in Persian → Bale message | All computed KPIs | Narration pattern (a) | Low | High / High / High | **Now** |
| MCP server exposing Zarin tools | Integration surface aligned with Apaleo/SiteMinder | Existing API | Market direction (c) | Low–medium | Low / Med / High | **Optional now** |
| Voice/phone agent | High call volume | Telephony, Persian ASR/TTS | Vendor marketing only | High | Low / Med / High | **Later** (Persian speech quality unverified) |

## Iran deployment: no Western APIs, capped tariffs, a strained grid

### LLM access and hosting

**None of the major Western LLM APIs serve Iran.**
- **Anthropic:** Iran is not on the supported-countries list, and "any country or region not listed is unsupported". The page also bars use by persons located in, or entities headquartered in, unsupported regions (verified fetch) ([Anthropic](https://www.anthropic.com/supported-countries)).
- **OpenAI and Google Gemini:** their API country lists are allow-lists without Iran ([OpenAI help](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories); [Gemini regions](https://ai.google.dev/gemini-api/docs/available-regions)).
- **Independent tracker:** classes ChatGPT, Claude and Gemini as blocked two ways, by vendor geo-fencing and by Iranian filtering ([Voidly](https://voidly.ai/atlas/findings/ai-blocked-two-ways-vendors-and-states-2026-06)).
- **US sanctions:** OFAC General License D-2 (2022) authorises internet-communication services, including cloud and automated translation. It permits US providers to serve Iranians but does not oblige them, and none has used it for LLM APIs ([Baker McKenzie](https://sanctionsnews.bakermckenzie.com/ofac-issues-updated-iran-general-license-related-to-certain-services-software-and-hardware-for-communications-over-the-internet-and-new-related-faqs/)).

Zarin's own code defines `ZH_AI_PROVIDER = anthropic | openai_compatible | none` (project-internal). The `anthropic` mode cannot be used from Liara servers in Iran.

**Two Iran-viable paths exist, plus a fallback.**

1. **Liara's AI gateway.** Liara is the PaaS Zarin already uses. Its gateway is OpenAI-SDK-compatible and exposes GPT, Claude, Gemini, DeepSeek, Grok and Llama, billed per token "according to the provider's tariff". Example listed prices are $0.4 input and $1.6 output per million tokens for GPT-4.1 mini (verify live) ([Liara docs](https://docs.liara.ir/ai/about/); [Liara pricing](https://liara.ir/pricing/)).
   - *Advantages:* the lowest-friction option, with rial billing.
   - *Risk:* it resells US models outside those providers' terms, so upstream access could be cut without notice.
2. **Self-hosting open-weight models on rented Iranian GPUs.**
   - *GPU prices:* an RTX 4090 costs about **189,000 toman per hour** at Iranserver/IranGPU and about **45.4 million toman per month** at GreenPlus; prices are volatile ([IranGPU](https://irangpu.com/rent-gpu-server/); [GreenPlus](https://greenplus.cloud/cloud-server/gpu/)). At the hourly rate, always-on use is roughly 136 million toman a month (simple arithmetic). Per-token gateway pricing wins for a single hotel; self-hosting makes sense for multi-hotel volume, data residency or continuity.
   - *Models:* the cleanest licence is Qwen3 (Apache 2.0, dense 0.6B–32B, 119 languages) ([AlternativeTo](https://alternativeto.net/news/2025/4/alibaba-unveils-qwen3-open-weight-models-with-hybrid-reasoning-and-multilingual-support)). Gemma 3 allows commercial use under Google's prohibited-use policy ([Gemma terms](https://ai.google.dev/gemma/terms)). Aya Expanse covers Persian but is CC-BY-NC, so it is unsuitable ([Ollama](https://registry.ollama.ai/library/aya-expanse)).
   - *Persian quality:* on the PerCoR Persian commonsense benchmark, Qwen3-32B scored 76.5% and Gemma 3 27B 76% ([arXiv 2510.22616](https://arxiv.org/pdf/2510.22616)). PartAI's Persian-tuned Dorna2-8B improves only modestly on its Llama base on exam-style tests ([Open Persian LLM Leaderboard](https://huggingface.co/spaces/PartAI/open-persian-llm-leaderboard/blame/54471621bed99a558974c259e96ba8928a0e4fc6/leaderboard_data.jsonl)).
   - *Hardware:* 8B models at 4-bit need about 5 GB of VRAM and 14B about 9 GB, so a 16–24 GB card serves both ([VRLA Tech](https://vrlatech.com/llm-vram-requirements-2026/)).
   - *Operational catch:* Hugging Face itself is blocked in Iran, so weights must be transferred in from outside ([Voidly](https://voidly.ai/ai-blocked/is-huggingface-blocked-in-iran)).
3. **Fallback.** The rule-based `none` mode should remain available during outages.

These constraints reinforce the evidence elsewhere in this report. Deterministic computation plus small-model narration and classification is both the most defensible design and the cheapest one to run in Iran.

### Prices, power, people and channels

**Regulated room tariffs.** Pricing features must lock the maximum to the approved tariff, versioned by Mehr cycle, and work by discounting (see the forecasting section).

**The power grid is under severe strain.**
- **2025 outages:** household outages were capped at 2 hours a day from May 2025, with industry hit hardest between 11:00 and 16:00 ([energynews.pro](https://energynews.pro/en/iran-caps-electricity-outages-at-two-hours-amid-rising-summer-demand/)).
- **2026 deficit:** a June 2026 projection put the peak deficit at about 13,600 MW ([Iran International](https://www.iranintl.com/en/202608057267)).
- **Prices:** the wholesale market price cap rose from 209 to 358 toman/kWh ([Taadol](https://www.taadolnewspaper.ir/fa/news/382196/ماجرای-افزایش-۹۰-درصدی-تعرفه-برق-چیست)).
- **Gaps:** Tavanir commercial tariff tables and whether hotels get outage exemptions were not verified.
- **Design implications:**
  - outage logging and pre-cooling playbooks are valuable for Iranian hotels;
  - AI should be hosted in a data centre, not on hotel premises;
  - CO2e reporting should default to Ember's 494 gCO2/kWh Iran factor, with the source year shown.

**Workforce and guests.** Labour-law rules come from vendor summaries and need statutory verification. Language priorities come from secondary arrival data. Guest-registration rules and Electronic Commerce Law privacy clauses were not researched.

**Channels.** Zarin already sends through Bale's Telegram-style endpoint and Kavenegar SMS (project-internal). The 2026 filtering status of Telegram and WhatsApp was not verified. No public APIs were confirmed for Iranian PMS vendors, OTAs (Snapptrip, Jabama, Alibaba.ir, Eghamat24) or accounting packages (Sepidar, Mahak, Rahkaran). Zarin should therefore integrate through CSV/Excel import adapters and its own REST API and n8n webhooks, not through undocumented third-party APIs.

## Prioritised roadmap: what Zarin can ship now versus later

The ranking weighs three things: strength of evidence, fit with existing data, and value across small, medium and large hotels. It also favours features that build reusable infrastructure: a deterministic KPI layer, a shared issue taxonomy, an approval-gated tool layer, and a forecast that other features consume.

### Tier A: feasible with current data (at most trivial config such as a weather feed or floor area)

| Rank | Feature | Why it ranks here (evidence) | Effort | Best for |
|---|---|---|---|---|
| A1 | Deterministic KPI engine plus LLM narration with a numeric-consistency check (USALI-lite, MPOR/HPOR, cost per occupied room) | Foundation for everything. LLM arithmetic limits documented (a) | Low | S/M/L |
| A2 | Occupancy/ADR/revenue forecast with Iranian holiday calendar, feeding staffing, purchasing and energy plans | Simple models robust (a); ML short-horizon gains (a); RMS vendors cannot link to ops data | Low–medium | M/L (S with simple models) |
| A3 | Normalised energy baseline (IPMVP-C) + CUSUM + daily anomaly alerts + intensity/CO2e KPIs | Strongest method evidence (a); grid stress raises value | Low–medium | S/M/L |
| A4 | Maintenance intelligence + SLA breach alerts + repeat-fault flags + OOO revenue cost + PM/legionella scheduler | Work orders track downtime (a); ECDC safety (a) | Low | S/M/L |
| A5 | Learned cleaning standards + credit-balanced zone assignment with daily cap + clean-room projection | 11% (b) and 8.9% (b); independent worker evidence shapes the design (a) | Low–medium | M/L |
| A6 | Inventory: usage forecast, days of cover, dynamic reorder point, unit-price inflation tracking, waste programme | Champions 12.3 21% / 7:1 (a); occupancy +11% F&B forecasts (a) | Low | S/M/L |
| A7 | Inventory fraud and control rules (shrinkage, segregation of duties, timing, duplicates, price jumps) | Methods (a); ledger is the audit trail | Low | S/M/L |
| A8 | Labor KPIs, staffing forecast, Iranian labor-law compliance alerts (no individual scoring) | Benchmarks; AI Act guardrails (a) | Low | S/M/L |
| A9 | Approval-gated task agent and Persian morning exception digest via Bale | Company-reported deflection (c); developer guidance | Medium | M/L |
| A10 | Persian SOP RAG assistant and staff–guest translation phrasebook | Shipping at Oracle/Accor (c); translation needs human-verified phrases (a) | Low–medium | M/L; S in pilgrimage and border cities |
| A11 | Pooled STR-style benchmark across Zarin tenants | STR method (a); comp-set forecast gains (a) | Medium (consent) | S/M |
| A12 | Governed rate-calendar adviser capped at the approved tariff, with a cost-based floor | Guardrail practice (c); weak without on-the-books data | Medium | S/M |

### Tier B: needs small schema additions or manual inputs, no external integration

| Rank | Feature | Addition needed |
|---|---|---|
| B1 | Guest-issue intake + service-recovery SLA, escalation and follow-up (evidence (a) for timing) | `origin`, `guestImpact`, `firstResponseAt`, follow-up fields; cross-department taxonomy |
| B2 | Arrival-aware housekeeping priority and rooms-at-risk list | Reception "arrivals by type / needed-by time / early check-in" input |
| B3 | Pickup forecasting (additive pickup) | Daily snapshot of rooms on the books for next N nights |
| B4 | Budget vs actual, flexible budget, CPI-deflated trends, cost per occupied room with wages | `budgets`, CPI table, wage rate per staff member |
| B5 | Outage/generator log and peak-season resilience view | Outage-event and fuel entries |
| B6 | Review import + ABSA dashboard linked to tickets; AI-drafted replies with approval (evidence (a) for reputation and response) | Manual CSV/paste of reviews |
| B7 | Actual food cost %, FEFO/expiry and temperature logs, incident log | Department tags, lot/expiry fields, new collections |
| B8 | Supplier lead-time-aware reorder points and PO-matching fraud rules | Supplier and order-date fields |

### Tier C: needs new integrations or hardware

| Rank | Feature | Integration | Evidence |
|---|---|---|---|
| C1 | Dynamic pricing, cancellation prediction, overbooking | PMS/reservations | Chains +2–4% (b); >90% cancellation accuracy (a) |
| C2 | Room assignment optimisation, upgrades, upsell | PMS, rates, folio | (a) RoomTetris; (b/c) Oracle/Oaky |
| C3 | Guest messaging bot (Bale/web via QR) and CRM personalisation | Guest channel, stay entity, consent | (b/c) only |
| C4 | Menu engineering, theoretical-vs-actual variance, POS fraud | POS item sales plus recipes | Method only |
| C5 | True GOP/departmental P&L, payroll fraud | GL and payroll import (Sepidar/Mahak/Rahkaran APIs unverified) | Unverified |
| C6 | Weibull/MTBF reliability | Equipment register, about 2 years of tagged history | Small-sample caveats (a) |
| C7 | FDD, guestroom energy management, AI supervisory HVAC, camera waste AI | BMS, sensors, scales and cameras | (a) 9% FDD, 12–25% GREMS; (b) vendor 10–66% |
| C8 | Rate shopping, external demand signals | OTA collection (legality unresearched) | (c) |

## Conclusion

Zarin's lack of a PMS hurts less than it appears. The best-evidenced hotel AI is overwhelmingly deterministic arithmetic made visible: credits and minutes, degree-day regressions, reorder points, SLA clocks and waste ledgers. Zarin already holds the operational data that RMS and guest-messaging vendors never touch. Its defensible moat is joining those streams. Three examples:
- a pricing floor derived from real cost per occupied room;
- an energy baseline that knows occupancy;
- a forecast that drives the housekeeping roster and the purchase list at the same time.

None of these depends on Western LLM APIs. The LLM's proper job is classification, retrieval and narration of numbers computed elsewhere, which is exactly what Iran's constraints force anyway.

Two cheap additions change the ceiling more than any model choice. The first is a nightly "rooms on the books for the next N nights" snapshot, which turns history-only forecasting into pickup forecasting and makes the rate-calendar adviser responsive. The second is an `origin` field plus a shared complaint taxonomy, which turns maintenance tickets into a service-recovery and reputation system and later links to review analytics. Two governance choices protect adoption:
- showing attendants the full day's list instead of one-at-a-time dispatch, and never scoring individuals;
- keeping every guest-binding or financial action behind an approval row.

Finally, the evidence gaps are an opportunity. No housekeeping, guest-messaging or ticket-analytics vendor has independent outcome data. A multi-tenant platform that runs Carlson-style compliant-versus-non-compliant comparisons and IPMVP-grade baselines would generate the measured results this market lacks.
