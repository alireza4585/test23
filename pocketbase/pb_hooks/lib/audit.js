/// <reference path="../../pb_data/types.d.ts" />
/**
 * Audit log for client CRUD on hotel data (custom routes audit themselves).
 * Records who changed what, with a field diff, after the write succeeds.
 */
const z = require(`${__hooks}/lib/zarin.js`);

const AUDITED = {
  hotels: 1, rooms: 1, tasks: 1, maintenanceTickets: 1, energyReadings: 1, dailyOperations: 1,
  inventoryItems: 1, staff: 1, shifts: 1, alerts: 1, aiInsights: 1, reports: 1, roleOverrides: 1, users: 1,
};

function actor(e) {
  if (e.hasSuperuserAuth()) return { uid: e.auth.id, type: "superuser" };
  if (!e.auth) return { uid: "", type: "guest" };
  return { uid: e.auth.id, name: e.auth.getString("fullName"), role: e.auth.getString("role"), type: "user" };
}

function hotelOf(record) {
  const name = record.collection().name;
  if (name === "hotels") return record.id;
  if (name === "users") return record.getString("primaryHotel");
  return record.getString("hotel");
}

function exported(record) {
  const out = JSON.parse(JSON.stringify(record.publicExport()));
  delete out.expand;
  return out;
}

function write(e, action, before, after) {
  const name = e.record.collection().name;
  z.audit(e.app, hotelOf(e.record), {
    action: `${name}.${action}`, collection: name, id: e.record.id, actor: actor(e),
    changes: z.diff(before, after), source: "client",
  });
}

function create(e) {
  e.next();
  if (AUDITED[e.record.collection().name]) write(e, "create", null, exported(e.record));
}

function update(e) {
  if (!AUDITED[e.record.collection().name]) return e.next();
  const before = exported(e.record.original());
  e.next();
  const after = exported(e.record);
  if (Object.keys(z.diff(before, after)).length) write(e, "update", before, after);
}

function remove(e) {
  if (!AUDITED[e.record.collection().name]) return e.next();
  const before = exported(e.record);
  e.next();
  write(e, "delete", before, null);
}

module.exports = { create, update, remove };
