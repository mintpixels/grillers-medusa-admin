import { defineRouteConfig } from "@medusajs/admin-sdk"
import { User } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  RadioGroup,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { FormEvent, useMemo, useState } from "react"

import {
  US_STATES,
  buildCustomerCode,
  formatUsPhone,
} from "../../../lib/gp-customer-create"

type FormState = {
  first_name: string
  last_name: string
  email: string
  phone: string
  phone_line_type: string
  company_name: string
  address_1: string
  address_2: string
  city: string
  province: string
  postal_code: string
  alt_first_name: string
  alt_last_name: string
  alt_email: string
  alt_phone: string
  alt_phone_line_type: string
}

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  phone_line_type: "",
  company_name: "",
  address_1: "",
  address_2: "",
  city: "",
  province: "",
  postal_code: "",
  alt_first_name: "",
  alt_last_name: "",
  alt_email: "",
  alt_phone: "",
  alt_phone_line_type: "",
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="small" weight="plus">
        {label}
        {required ? <span className="text-ui-fg-error"> *</span> : null}
      </Label>
      {children}
      {hint && !error ? (
        <Text size="small" className="text-ui-fg-subtle">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      ) : null}
    </div>
  )
}

const CreateCustomerPage = () => {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const customerCode = useMemo(
    () =>
      buildCustomerCode({
        first_name: form.first_name,
        last_name: form.last_name,
        postal_code: form.postal_code,
      }) || "—",
    [form.first_name, form.last_name, form.postal_code]
  )

  const formatPhoneOnBlur = (key: "phone" | "alt_phone") => () => {
    const formatted = formatUsPhone(form[key])
    if (formatted) {
      setForm((prev) => ({ ...prev, [key]: formatted }))
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})

    try {
      const response = await fetch("/admin/grillers/customers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setErrors((data?.errors as Record<string, string>) ?? {})
        toast.error("Could not create customer", {
          description:
            data?.message ?? "Please review the form and try again.",
        })
        return
      }

      toast.success("Customer created", {
        description: `Customer code: ${data?.customer_code ?? customerCode}`,
      })
      setForm(EMPTY_FORM)
    } catch (err) {
      toast.error("Could not create customer", {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Create Customer</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Customer code:{" "}
          <span className="text-ui-fg-base font-medium">{customerCode}</span>
        </Text>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-y-8 px-6 py-6">
        {/* Primary contact */}
        <div className="flex flex-col gap-y-4">
          <Heading level="h2">Contact</Heading>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="First name" required error={errors.first_name}>
              <Input
                value={form.first_name}
                onChange={(e) => set("first_name")(e.target.value)}
                placeholder="Peter"
              />
            </Field>
            <Field label="Last name" required error={errors.last_name}>
              <Input
                value={form.last_name}
                onChange={(e) => set("last_name")(e.target.value)}
                placeholder="Swerdlow"
              />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
                placeholder="customer@example.com"
              />
            </Field>
            <Field
              label="Company"
              error={errors.company_name}
              hint="Reference only — never part of the customer code."
            >
              <Input
                value={form.company_name}
                onChange={(e) => set("company_name")(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field
              label="Phone"
              required
              error={errors.phone}
              hint="Auto-formats to xxx-yyy-zzzz."
            >
              <Input
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
                onBlur={formatPhoneOnBlur("phone")}
                placeholder="404-555-1234"
                inputMode="tel"
              />
            </Field>
            <Field
              label="Is this a mobile number?"
              required
              error={errors.phone_line_type}
            >
              <RadioGroup
                value={form.phone_line_type}
                onValueChange={set("phone_line_type")}
                className="flex gap-x-6"
              >
                <div className="flex items-center gap-x-2">
                  <RadioGroup.Item value="mobile" id="phone-mobile" />
                  <Label htmlFor="phone-mobile" weight="plus">
                    Yes — mobile
                  </Label>
                </div>
                <div className="flex items-center gap-x-2">
                  <RadioGroup.Item value="landline" id="phone-landline" />
                  <Label htmlFor="phone-landline" weight="plus">
                    No — landline
                  </Label>
                </div>
              </RadioGroup>
            </Field>
          </div>
        </div>

        {/* Ship-to address */}
        <div className="flex flex-col gap-y-4">
          <Heading level="h2">Ship-to address</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Optional — but if you start an address, street, city, state, and ZIP
            are required.
          </Text>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Street address" error={errors.address_1}>
              <Input
                value={form.address_1}
                onChange={(e) => set("address_1")(e.target.value)}
                placeholder="123 Peachtree St"
              />
            </Field>
            <Field label="Apt / Suite" error={errors.address_2}>
              <Input
                value={form.address_2}
                onChange={(e) => set("address_2")(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="City" error={errors.city}>
              <Input
                value={form.city}
                onChange={(e) => set("city")(e.target.value)}
                placeholder="Atlanta"
              />
            </Field>
            <Field label="State" error={errors.province}>
              <Select value={form.province} onValueChange={set("province")}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a state" />
                </Select.Trigger>
                <Select.Content>
                  {US_STATES.map((state) => (
                    <Select.Item key={state.code} value={state.code}>
                      {state.code} — {state.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </Field>
            <Field label="ZIP code" error={errors.postal_code}>
              <Input
                value={form.postal_code}
                onChange={(e) => set("postal_code")(e.target.value)}
                placeholder="30303"
                inputMode="numeric"
              />
            </Field>
          </div>
        </div>

        {/* Alternate contact */}
        <div className="flex flex-col gap-y-4">
          <Heading level="h2">Alternate contact</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Optional — a second person, phone, and email for this account.
          </Text>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Alt. first name" error={errors.alt_first_name}>
              <Input
                value={form.alt_first_name}
                onChange={(e) => set("alt_first_name")(e.target.value)}
              />
            </Field>
            <Field label="Alt. last name" error={errors.alt_last_name}>
              <Input
                value={form.alt_last_name}
                onChange={(e) => set("alt_last_name")(e.target.value)}
              />
            </Field>
            <Field label="Alt. email" error={errors.alt_email}>
              <Input
                type="email"
                value={form.alt_email}
                onChange={(e) => set("alt_email")(e.target.value)}
              />
            </Field>
            <Field
              label="Alt. phone"
              error={errors.alt_phone}
              hint="Auto-formats to xxx-yyy-zzzz."
            >
              <Input
                value={form.alt_phone}
                onChange={(e) => set("alt_phone")(e.target.value)}
                onBlur={formatPhoneOnBlur("alt_phone")}
                inputMode="tel"
              />
            </Field>
            <Field label="Alt. phone type" error={errors.alt_phone_line_type}>
              <RadioGroup
                value={form.alt_phone_line_type}
                onValueChange={set("alt_phone_line_type")}
                className="flex gap-x-6"
              >
                <div className="flex items-center gap-x-2">
                  <RadioGroup.Item value="mobile" id="alt-mobile" />
                  <Label htmlFor="alt-mobile" weight="plus">
                    Mobile
                  </Label>
                </div>
                <div className="flex items-center gap-x-2">
                  <RadioGroup.Item value="landline" id="alt-landline" />
                  <Label htmlFor="alt-landline" weight="plus">
                    Landline
                  </Label>
                </div>
              </RadioGroup>
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-x-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setForm(EMPTY_FORM)
              setErrors({})
            }}
            disabled={submitting}
          >
            Clear
          </Button>
          <Button type="submit" isLoading={submitting}>
            Create customer
          </Button>
        </div>
      </form>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Create Customer",
  icon: User,
})

export default CreateCustomerPage
