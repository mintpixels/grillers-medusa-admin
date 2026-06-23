import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminCustomer } from "@medusajs/framework/types"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"

import { OFFLINE_METHODS, type OfflineMethod } from "../../lib/gp-offline-payment"

/**
 * #279 / #282 / #291 — "Pay by invoice (B2B)" approval on the customer detail page.
 *
 * Only designated approvers (Peter / Avi / Julie) can save; the API enforces it and returns
 * 403 otherwise. Approving sets the account's methods, credit limit, and QuickBooks terms;
 * the invoice then ages in QB A/R. When a customer has submitted a self-serve application
 * (#291), it's surfaced here pre-filled, with Approve (Save) and Decline actions. B2C
 * customers are left untouched.
 */
const METHOD_LABEL: Record<OfflineMethod, string> = {
  zelle: "Zelle",
  check: "Check",
  wire: "Wire",
}

function money(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : "—"
}

const CustomerOfflinePaymentWidget = ({
  data,
}: DetailWidgetProps<AdminCustomer>) => {
  const meta = (data?.metadata ?? {}) as Record<string, unknown>

  const application =
    meta.gp_invoice_application && typeof meta.gp_invoice_application === "object"
      ? (meta.gp_invoice_application as Record<string, unknown>)
      : null
  const applicationStatus =
    typeof meta.gp_invoice_application_status === "string"
      ? (meta.gp_invoice_application_status as string)
      : null
  const isPendingApplication = applicationStatus === "pending"

  const savedMethods = Array.isArray(meta.gp_offline_methods)
    ? (meta.gp_offline_methods as string[]).filter((m): m is OfflineMethod =>
        OFFLINE_METHODS.includes(m as OfflineMethod)
      )
    : []
  const requestedMethods =
    isPendingApplication && Array.isArray(application?.methods)
      ? (application!.methods as string[]).filter((m): m is OfflineMethod =>
          OFFLINE_METHODS.includes(m as OfflineMethod)
        )
      : []

  const [approved, setApproved] = useState<boolean>(
    meta.gp_offline_payment_approved === true
  )
  const [methods, setMethods] = useState<OfflineMethod[]>(
    savedMethods.length ? savedMethods : requestedMethods
  )
  const [creditLimit, setCreditLimit] = useState<string>(
    meta.gp_credit_limit
      ? String(meta.gp_credit_limit)
      : isPendingApplication && application?.requested_credit_limit
        ? String(application.requested_credit_limit)
        : ""
  )
  const [terms, setTerms] = useState<string>(
    typeof meta.gp_payment_terms === "string" ? meta.gp_payment_terms : "Net 10"
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const toggleMethod = (m: OfflineMethod) =>
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    )

  async function post(
    body: Record<string, unknown>,
    successMsg: string
  ): Promise<boolean> {
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch(
        `/admin/grillers/customers/${data.id}/offline-payment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrors((payload?.errors as Record<string, string>) ?? {})
        toast.error("Could not save invoice terms", {
          description:
            payload?.message ?? "Please review the fields and try again.",
        })
        return false
      }
      toast.success(successMsg)
      return true
    } catch (err) {
      toast.error("Could not save invoice terms", {
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  const onSave = () =>
    post(
      { approved, methods, credit_limit: creditLimit, payment_terms: terms },
      approved ? "Account approved for invoicing" : "Invoice approval removed"
    )

  const onDecline = async () => {
    if (
      await post(
        { approved: false, decline_application: true },
        "Application declined"
      )
    ) {
      setApproved(false)
    }
  }

  const badge = approved ? (
    <Badge color="green">Approved</Badge>
  ) : isPendingApplication ? (
    <Badge color="orange">Application pending</Badge>
  ) : applicationStatus === "declined" ? (
    <Badge color="red">Declined</Badge>
  ) : (
    <Badge>Card only</Badge>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Pay by invoice (B2B)</Heading>
          {badge}
        </div>
      </div>

      {isPendingApplication && application ? (
        <div className="flex flex-col gap-y-2 bg-ui-bg-subtle px-6 py-4">
          <Text size="small" weight="plus">
            Self-serve application
          </Text>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
            <Text size="small" className="text-ui-fg-subtle">
              Business:{" "}
              <span className="text-ui-fg-base">
                {String(application.business_name ?? "—")}
              </span>
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Tax ID:{" "}
              <span className="text-ui-fg-base">
                {String(application.tax_id ?? "—")}
              </span>
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Contact:{" "}
              <span className="text-ui-fg-base">
                {String(application.contact_name ?? "—")}
              </span>
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Email:{" "}
              <span className="text-ui-fg-base">
                {String(application.contact_email ?? "—")}
              </span>
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Phone:{" "}
              <span className="text-ui-fg-base">
                {String(application.contact_phone ?? "—")}
              </span>
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Requested limit:{" "}
              <span className="text-ui-fg-base">
                {money(application.requested_credit_limit)}
              </span>
            </Text>
          </div>
          {application.notes ? (
            <Text size="small" className="text-ui-fg-subtle">
              Notes:{" "}
              <span className="text-ui-fg-base">
                {String(application.notes)}
              </span>
            </Text>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-y-4 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label weight="plus">Approve this account to pay by invoice</Label>
            <Text size="small" className="text-ui-fg-subtle">
              Only designated approvers (Peter, Avi, Julie) can save this.
            </Text>
          </div>
          <Switch
            checked={approved}
            onCheckedChange={(v) => setApproved(Boolean(v))}
          />
        </div>

        {approved ? (
          <div className="flex flex-col gap-y-4">
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Accepted methods
              </Label>
              <div className="flex gap-x-4">
                {OFFLINE_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-x-2">
                    <input
                      type="checkbox"
                      checked={methods.includes(m)}
                      onChange={() => toggleMethod(m)}
                    />
                    <span className="txt-compact-small">{METHOD_LABEL[m]}</span>
                  </label>
                ))}
              </div>
              {errors.methods ? (
                <Text size="small" className="text-ui-fg-error">
                  {errors.methods}
                </Text>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-y-1">
                <Label size="small" weight="plus">
                  Credit limit (USD)
                </Label>
                <Input
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="2500"
                  inputMode="numeric"
                />
                {errors.credit_limit ? (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.credit_limit}
                  </Text>
                ) : null}
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small" weight="plus">
                  Payment terms
                </Label>
                <Input
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Net 10"
                />
                <Text size="small" className="text-ui-fg-subtle">
                  Set in QuickBooks; drives A/R aging.
                </Text>
                {errors.payment_terms ? (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.payment_terms}
                  </Text>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-x-2">
          {isPendingApplication ? (
            <Button variant="secondary" onClick={onDecline} isLoading={saving}>
              Decline
            </Button>
          ) : null}
          <Button onClick={onSave} isLoading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default CustomerOfflinePaymentWidget
