/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 2, P2.0: permissions per active hotel.
 *
 * Until now a user's permissions (and financeView) came from the role override
 * of the user's primary hotel and applied in every hotel the user belongs to.
 * Now each user has one active hotel: permissions are computed for it, and the
 * API rules admit records of the active hotel only (instead of any member
 * hotel). Switching is a route (POST /api/zarin/me/active-hotel) that
 * recomputes the permissions. For a user with one hotel nothing changes.
 *
 * Rules rewritten (all collections):
 *   @request.auth.hotels.id ?= hotel           → @request.auth.activeHotel = hotel
 *   @request.auth.hotels.id ?= id   (hotels, update only) → @request.auth.activeHotel = id
 *   hotels.id ?= @request.auth.hotels.id (users) → hotels.id ?= @request.auth.activeHotel
 * The hotels list/view rules keep membership, so the app can offer the switch.
 */
const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];

function rewrite(app, forward) {
  for (const c of app.findAllCollections()) {
    let changed = false;
    for (const k of RULES) {
      // A rule is a Go *string: null when unset, otherwise read it as a JS string.
      const raw = c[k];
      if (raw === null || raw === undefined) continue;
      const rule = String(raw);
      if (!rule) continue;
      let next = rule;
      if (forward) {
        next = next.split("@request.auth.hotels.id ?= hotel").join("@request.auth.activeHotel = hotel");
        next = next.split("hotels.id ?= @request.auth.hotels.id").join("hotels.id ?= @request.auth.activeHotel");
        if (c.name === "hotels" && k === "updateRule") next = next.split("@request.auth.hotels.id ?= id").join("@request.auth.activeHotel = id");
      } else {
        next = next.split("@request.auth.activeHotel = hotel").join("@request.auth.hotels.id ?= hotel");
        next = next.split("hotels.id ?= @request.auth.activeHotel").join("hotels.id ?= @request.auth.hotels.id");
        if (c.name === "hotels" && k === "updateRule") next = next.split("@request.auth.activeHotel = id").join("@request.auth.hotels.id ?= id");
      }
      if (next !== rule) {
        c[k] = next;
        changed = true;
      }
    }
    if (changed) app.save(c);
  }
}

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const hotels = app.findCollectionByNameOrId("hotels");
  users.fields.add(new RelationField({ name: "activeHotel", collectionId: hotels.id, maxSelect: 1, cascadeDelete: false }));
  app.save(users);

  // Backfill without hooks: the active hotel is the primary hotel (or the first membership).
  for (const u of app.findAllRecords("users")) {
    const member = [];
    for (const h of u.getStringSlice("hotels") || []) member.push(String(h));
    const primary = u.getString("primaryHotel");
    const active = primary && member.indexOf(primary) >= 0 ? primary : member[0] || "";
    if (!active) continue;
    u.set("activeHotel", active);
    app.unsafeWithoutHooks().save(u);
  }

  rewrite(app, true);
}, (app) => {
  rewrite(app, false);
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("activeHotel");
  app.save(users);
});
