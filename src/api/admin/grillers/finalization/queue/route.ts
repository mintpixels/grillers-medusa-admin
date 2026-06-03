import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

const DEFAULT_STATUSES = [
  "pending_pick",
  "picking",
  "ready_for_packing",
  "pending_pack",
  "packing",
  "packed_pending_review",
  "packed_pending_charge",
  "charge_failed_hold",
  "charged_ready_to_ship",
];

const OPEN_STATUSES_WITHOUT_FINAL_TOTALS = new Set([
  "pending_pick",
  "picking",
  "ready_for_packing",
  "pending_pack",
  "packing",
  "packed_pending_review",
]);

const clampLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.round(parsed), 200);
};

const clampScanLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(Math.max(Math.round(parsed), 200), 500);
};

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const metadataObject = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
};

const dateKey = (value: unknown) => {
  const raw = textValue(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const orderFulfillmentType = (metadata: Record<string, any>) =>
  textValue(metadata.fulfillmentType) || textValue(metadata.fulfillment_type);

const orderFulfillmentDate = (metadata: Record<string, any>) => {
  const fulfillmentType = orderFulfillmentType(metadata);
  if (fulfillmentType === "ups_shipping") {
    return (
      textValue(metadata.requestedDeliveryDate) ||
      textValue(metadata.scheduledDate) ||
      textValue(metadata.requested_fulfillment_date) ||
      textValue(metadata.fulfillment_date) ||
      textValue(metadata.inventory_requested_fulfillment_date)
    );
  }

  return (
    textValue(metadata.scheduledDate) ||
    textValue(metadata.requestedDeliveryDate) ||
    textValue(metadata.requested_fulfillment_date) ||
    textValue(metadata.fulfillment_date) ||
    textValue(metadata.inventory_requested_fulfillment_date)
  );
};

async function ordersById(req: MedusaRequest, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Record<string, any>>();

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "metadata",
      "shipping_address.*",
      "billing_address.*",
    ],
    filters: { id: orderIds },
  });

  return new Map(
    (data || [])
      .filter((order: Record<string, any>) => order?.id)
      .map((order: Record<string, any>) => [order.id, order]),
  );
}

function searchableText(
  row: Record<string, any>,
  order: Record<string, any> | undefined,
) {
  const metadata = metadataObject(order?.metadata);
  const shipping = metadataObject(order?.shipping_address);
  const billing = metadataObject(order?.billing_address);
  return [
    row.display_id,
    row.order_id,
    row.customer_email,
    row.customer_id,
    order?.display_id,
    order?.email,
    metadata.fulfillmentType,
    metadata.fulfillment_type,
    metadata.fulfillmentZip,
    metadata.fulfillment_zip,
    metadata.pickupLocationId,
    metadata.scheduledDate,
    metadata.requestedDeliveryDate,
    metadata.requested_fulfillment_date,
    shipping.first_name,
    shipping.last_name,
    shipping.company,
    shipping.phone,
    shipping.city,
    shipping.province,
    shipping.postal_code,
    billing.first_name,
    billing.last_name,
    billing.company,
    billing.phone,
    billing.city,
    billing.province,
    billing.postal_code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const statusQuery = req.query?.status;
  const rawQueryText =
    typeof req.query?.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const queryText = rawQueryText.replace(/#/g, "");
  const fulfillmentType =
    typeof req.query?.fulfillment_type === "string"
      ? req.query.fulfillment_type.trim()
      : "";
  const dateFrom = dateKey(req.query?.date_from);
  const dateTo = dateKey(req.query?.date_to);
  const hasOrderFilters = Boolean(
    queryText || fulfillmentType || dateFrom || dateTo,
  );
  const statuses =
    typeof statusQuery === "string" && statusQuery.trim()
      ? statusQuery
          .split(",")
          .map((status) => status.trim())
          .filter(Boolean)
      : DEFAULT_STATUSES;

  const rows = await db("gp_order_finalization")
    .select("*")
    .whereNull("deleted_at")
    .whereIn("status", statuses)
    .orderByRaw(
      "case status when 'charge_failed_hold' then 0 when 'packed_pending_charge' then 1 when 'packed_pending_review' then 2 when 'packing' then 3 when 'ready_for_packing' then 4 when 'picking' then 5 when 'pending_pick' then 6 else 7 end",
    )
    .orderBy("created_at", "asc")
    .limit(
      hasOrderFilters
        ? clampScanLimit(req.query?.limit)
        : clampLimit(req.query?.limit),
    );

  const orders = await ordersById(
    req,
    (rows || [])
      .map((row: Record<string, any>) => row.order_id)
      .filter(Boolean),
  );

  const finalizations = (rows || [])
    .map((row: Record<string, any>) => {
      const order = orders.get(row.order_id);
      const metadata = metadataObject(order?.metadata);
      const fulfillment_type = orderFulfillmentType(metadata);
      const fulfillment_date = orderFulfillmentDate(metadata);
      const fulfillment_date_key = dateKey(fulfillment_date);
      return {
        ...(OPEN_STATUSES_WITHOUT_FINAL_TOTALS.has(row.status)
          ? {
              ...row,
              final_item_total: null,
              final_shipping_total: null,
              final_tax_total: null,
              final_discount_total: null,
              final_order_total: null,
              delta_total: null,
            }
          : row),
        order_email: order?.email || row.customer_email || null,
        fulfillment_type: fulfillment_type || null,
        fulfillment_date: fulfillment_date || null,
        fulfillment_date_key: fulfillment_date_key || null,
      };
    })
    .filter((row: Record<string, any>) => {
      const order = orders.get(row.order_id);
      if (queryText && !searchableText(row, order).includes(queryText)) {
        return false;
      }
      if (fulfillmentType && row.fulfillment_type !== fulfillmentType) {
        return false;
      }
      if (
        dateFrom &&
        (!row.fulfillment_date_key || row.fulfillment_date_key < dateFrom)
      ) {
        return false;
      }
      if (
        dateTo &&
        (!row.fulfillment_date_key || row.fulfillment_date_key > dateTo)
      ) {
        return false;
      }
      return true;
    })
    .slice(0, clampLimit(req.query?.limit));

  res.status(200).json({
    finalizations,
    count: finalizations.length,
  });
};
