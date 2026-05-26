import { model } from "@medusajs/framework/utils"

const InventoryAllocationAudit = model
  .define("gp_inventory_allocation_audit", {
    id: model.id({ prefix: "iallocaud" }).primaryKey(),
    allocation_id: model.text(),
    event_type: model.text(),
    previous_status: model.text().nullable(),
    next_status: model.text().nullable(),
    previous_quantity: model.number().nullable(),
    next_quantity: model.number().nullable(),
    actor_type: model.text().default("system"),
    actor_id: model.text().nullable(),
    actor_email: model.text().nullable(),
    reason: model.text().nullable(),
    note: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_inventory_allocation_audit_allocation",
      on: ["allocation_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_allocation_audit_event_type",
      on: ["event_type"],
      where: "deleted_at IS NULL",
    },
  ])

export default InventoryAllocationAudit
