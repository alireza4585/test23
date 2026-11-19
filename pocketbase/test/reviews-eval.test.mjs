// F10 R2 eval harness on the live test server: the synthetic set goes through
// the same intake and analysis; the result names its set and method. The mock
// LLM answers 503 here, so the rules analyse everything and the report says so.
import { describe, expect, it } from "vitest";

import { ACCOUNTS, PASSWORD } from "../scripts/seed.mjs";
import { evaluate, loadSet, report, score } from "../scripts/lib/reviews-eval.mjs";
import { SUPERUSER } from "./global-setup.mjs";
import { url } from "./helpers.mjs";

const set = loadSet(new URL("../../fixtures/reviews/generated/eval-synthetic.jsonl", import.meta.url).pathname);

describe("eval harness", () => {
  it("the synthetic set: 200 labelled reviews, 10 with an injected instruction", () => {
    expect(set).toHaveLength(200);
    expect(set.filter((s) => s.labels.injection)).toHaveLength(10);
  });

  it("scores against the labels", () => {
    const items = [{ id: "a", labels: { aspects: [{ aspect: "noise", sentiment: "neg" }, { aspect: "wifi", sentiment: "pos" }], sentiment: "mixed", rating5: 3 } }];
    const m = score(items, { a: { method: "llm", label: "mixed", inferredRating: 3.5, aspects: [{ aspect: "noise", sentiment: "pos" }, { aspect: "value", sentiment: "neg" }] } });
    expect(m.aspects).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(m.aspectPolarity.accuracy).toBe(0);
    expect(m.sentiment.accuracy).toBe(1);
    expect(m.estimatedRating).toEqual({ mae: 0.5, within1: 1, n: 1 });
  });

  it("runs a slice through the server; the report names the set and the method actually used", async () => {
    const sa = ACCOUNTS.find((a) => a[1] === "superAdmin");
    const r = await evaluate({ url: url(), email: SUPERUSER.email, password: SUPERUSER.password, saNationalId: sa[0], saPassword: PASSWORD, set, setName: "synthetic", limit: 40 });
    expect(r).toMatchObject({ set: "synthetic", method: "rules" });
    expect(r.analysed).toEqual({ llm: 0, rules: 40 });
    expect(r.metrics.missing).toBe(0);
    expect(r.metrics.aspects.f1).toBeGreaterThan(0.5);
    const text = report(r);
    expect(text.split("\n")[0]).toContain("set: synthetic");
    expect(text).toContain("come from the **synthetic** set");
  });
});
