/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3228155173")

  // update collection data
  unmarshal({
    "listRule": "(@request.auth.hotels.id ?= hotel || @request.auth.role = 'superAdmin') && audienceRoles ?= @request.auth.role"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3228155173")

  // update collection data
  unmarshal({
    "listRule": "(@request.auth.hotels.id ?= hotel || @request.auth.role = 'superAdmin') && (audienceRoles ?= @request.auth.role || @request.auth.role = 'superAdmin')"
  }, collection)

  return app.save(collection)
})
