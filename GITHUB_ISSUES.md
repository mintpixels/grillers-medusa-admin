# Grillers Pride Medusa Backend - GitHub Issues

This document contains all identified issues for the Medusa backend comparing current implementation against the Statement of Work (SOW) requirements.

**Total Issues: 67**

---

## Table of Contents
1. [Shipping & Delivery](#shipping--delivery) (14 issues)
2. [QuickBooks Integration](#quickbooks-integration) (10 issues)
3. [Payments](#payments) (6 issues)
4. [Products & Inventory](#products--inventory) (6 issues)
5. [Orders & Fulfillment](#orders--fulfillment) (7 issues)
6. [Customers & Auth](#customers--auth) (4 issues)
7. [API & Webhooks](#api--webhooks) (6 issues)
8. [Testing](#testing) (6 issues)
9. [Documentation](#documentation) (4 issues)
10. [Infrastructure](#infrastructure) (4 issues)

---

## Shipping & Delivery

### [Shipping] Implement UPS API Integration for Real-Time Rates
**Priority:** Critical
**Labels:** `shipping`, `critical`, `ups-integration`, `backend`

**Description:**
Integrate with the UPS API to retrieve real-time shipping rates based on package weight, dimensions, and destination. Currently, the fulfillment service uses static shipping zones from Strapi without actual UPS rate calculation.

**SOW Reference:**
> "Access the UPS API to retrieve essential shipping parameters such as transit days and real-time shipping rates"

**Current State:**
The `GrillersFulfillmentProviderService` in `src/modules/fulfillment/service.ts` uses hardcoded shipping options (GROUND, OVERNIGHT) with rates pulled from Strapi shipping zones, not from UPS API.

**Acceptance Criteria:**
- [ ] Create UPS API client service with authentication
- [ ] Implement rate request functionality with package details
- [ ] Handle UPS API responses and error scenarios
- [ ] Cache rates appropriately to reduce API calls
- [ ] Support multiple UPS service levels (Ground, Next Day Air, etc.)
- [ ] Return real-time rates during checkout

**Relevant Files:**
- `src/modules/fulfillment/service.ts:67-189`
- `medusa-config.ts`

---

### [Shipping] Implement UPS Transit Days Calculation
**Priority:** Critical
**Labels:** `shipping`, `critical`, `ups-integration`, `backend`

**Description:**
Retrieve and display estimated transit days from UPS API based on origin and destination zip codes. Customers need to know when their orders will arrive.

**SOW Reference:**
> "Access the UPS API to retrieve essential shipping parameters such as transit days and real-time shipping rates"

**Current State:**
No transit day calculation exists. The fulfillment service does not query UPS for delivery estimates.

**Acceptance Criteria:**
- [ ] Query UPS Time in Transit API
- [ ] Calculate delivery date based on shipping method selected
- [ ] Account for processing time and cutoff times
- [ ] Handle weekend/holiday schedules
- [ ] Return transit days in shipping option response

**Relevant Files:**
- `src/modules/fulfillment/service.ts`

---

### [Shipping] Implement Destination Delivery Cost Calculation
**Priority:** Critical
**Labels:** `shipping`, `critical`, `ups-integration`, `backend`

**Description:**
Accurately calculate shipping costs based on the customer's delivery destination using UPS zip codes. The current implementation uses a basic tier system from Strapi, not actual destination-based UPS calculations.

**SOW Reference:**
> "Utilize UPS shipping zip codes to accurately calculate shipping costs based on the customer's delivery destination"

**Current State:**
`src/modules/fulfillment/service.ts` lines 87-146 calculate price using Strapi shipping zones and breakpoints, not UPS destination-based calculations.

**Acceptance Criteria:**
- [ ] Integrate with UPS zip code validation
- [ ] Calculate accurate shipping costs per destination zone
- [ ] Support residential vs commercial address differentiation
- [ ] Handle address validation and correction
- [ ] Store and use UPS zone data efficiently

**Relevant Files:**
- `src/modules/fulfillment/service.ts:72-146`

---

### [Shipping] Implement Shipping Box Estimation Algorithm
**Priority:** High
**Labels:** `shipping`, `high-priority`, `backend`

**Description:**
Calculate the estimated weight and dimensions of shipping boxes required for UPS shipments. This is essential for accurate rate calculation and ensuring products are shipped safely.

**SOW Reference:**
> "Calculate the estimated weight and dimensions of the shipping boxes required for UPS shipments"

**Current State:**
No box estimation logic exists. The fulfillment service does not consider product dimensions or weight for packaging calculations.

**Acceptance Criteria:**
- [ ] Create product weight/dimensions metadata fields
- [ ] Implement bin packing algorithm for optimal box selection
- [ ] Define available box sizes and their dimensions
- [ ] Calculate total package weight (products + packaging materials)
- [ ] Support multiple packages per order when needed
- [ ] Return packaging details for UPS rate requests

**Relevant Files:**
- `src/modules/fulfillment/service.ts`
- New module: `src/modules/packaging/`

---

### [Shipping] Implement Dry Ice Requirement Calculation
**Priority:** High
**Labels:** `shipping`, `high-priority`, `temperature-sensitive`, `backend`

**Description:**
Determine the total dry ice needed for temperature-sensitive products (kosher meat) during UPS shipping. This is critical for food safety compliance.

**SOW Reference:**
> "Determine the total dry ice needed for temperature-sensitive products during UPS shipping"

**Current State:**
No dry ice calculation exists. Products are not flagged for temperature sensitivity, and no cold chain logistics are implemented.

**Acceptance Criteria:**
- [ ] Add temperature sensitivity flag to product metadata
- [ ] Create dry ice calculation service based on:
  - Product weight
  - Transit time
  - Ambient temperature (seasonal adjustments)
  - Package insulation type
- [ ] Include dry ice weight in package weight calculations
- [ ] Add dry ice cost to shipping total
- [ ] Generate dry ice handling labels/documentation
- [ ] Comply with UPS hazardous materials regulations for dry ice

**Relevant Files:**
- `src/modules/fulfillment/service.ts`
- New service: `src/services/dry-ice-calculator.ts`

---

### [Shipping] Implement Extraneous UPS Charges Handling
**Priority:** High
**Labels:** `shipping`, `high-priority`, `ups-integration`, `backend`

**Description:**
Account for additional UPS shipping charges such as residential delivery surcharge, fuel surcharge, oversized package fees, and delivery area surcharges.

**SOW Reference:**
> "Account for any additional UPS shipping charges"

**Current State:**
No additional charge handling exists. Only base shipping rates from Strapi tiers are used.

**Acceptance Criteria:**
- [ ] Identify and catalog all applicable UPS surcharges
- [ ] Implement surcharge calculation logic:
  - Residential delivery surcharge
  - Fuel surcharge (dynamic)
  - Extended area surcharge
  - Large package surcharge
  - Additional handling surcharge
- [ ] Display itemized surcharges to customers
- [ ] Keep surcharge rates updated

**Relevant Files:**
- `src/modules/fulfillment/service.ts`

---

### [Shipping] Implement Plant Pickup Discount Incentives
**Priority:** High
**Labels:** `shipping`, `high-priority`, `discounts`, `backend`

**Description:**
Implement discount percentages for customers who opt for plant pickup instead of delivery. This should incentivize local customers to pick up orders directly.

**SOW Reference:**
> "Incorporate discount percentages for customers who opt for plant pickup"

**Current State:**
The PICKUP option exists in `src/modules/fulfillment/service.ts:163-167` but only has a flat rate from Strapi zones. No percentage-based discount on order total is implemented.

**Acceptance Criteria:**
- [ ] Create configurable pickup discount percentage
- [ ] Apply discount to eligible order items when pickup selected
- [ ] Display savings to customer during checkout
- [ ] Track pickup orders for fulfillment workflow
- [ ] Support multiple pickup locations if needed

**Relevant Files:**
- `src/modules/fulfillment/service.ts:104-105, 163-167`

---

### [Shipping] Create UPS Account Configuration Module
**Priority:** Critical
**Labels:** `shipping`, `critical`, `configuration`, `backend`

**Description:**
Create configuration module for UPS API credentials and account settings including shipper number, access keys, and environment settings.

**Acceptance Criteria:**
- [ ] Add UPS environment variables to `.env.template`
- [ ] Create UPS configuration schema
- [ ] Implement secure credential storage
- [ ] Support sandbox/production environment switching
- [ ] Document required UPS account setup

**Relevant Files:**
- `.env.template`
- `medusa-config.ts`
- New module: `src/modules/ups/`

---

### [Shipping] Create Shipping Zones Management for US
**Priority:** Medium
**Labels:** `shipping`, `medium-priority`, `configuration`, `backend`

**Description:**
Configure proper shipping zones for the United States to support Grillers Pride's DTC operations. Current seed data is configured for Europe.

**Current State:**
`src/scripts/seed.ts` creates European regions and fulfillment zones only.

**Acceptance Criteria:**
- [ ] Create US region with all states
- [ ] Configure US tax regions
- [ ] Set up US fulfillment zones
- [ ] Configure Atlanta warehouse as stock location
- [ ] Remove or disable European configuration

**Relevant Files:**
- `src/scripts/seed.ts:31, 73-84, 155-193`

---

### [Shipping] Implement Shipping Address Validation
**Priority:** Medium
**Labels:** `shipping`, `medium-priority`, `backend`

**Description:**
Validate and standardize shipping addresses using UPS Address Validation API before calculating rates and creating shipments.

**Acceptance Criteria:**
- [ ] Integrate UPS Address Validation API
- [ ] Validate addresses during checkout
- [ ] Suggest corrected addresses to customers
- [ ] Store validated address format
- [ ] Handle PO Box restrictions for UPS

**Relevant Files:**
- New API route: `src/api/store/address-validation/`

---

### [Shipping] Implement Delivery Date Selection
**Priority:** Medium
**Labels:** `shipping`, `medium-priority`, `backend`

**Description:**
Allow customers to select preferred delivery dates, especially important for the Metro Atlanta scheduled delivery option.

**Current State:**
SCHEDULED_DELIVERY option exists but no date selection mechanism is implemented.

**Acceptance Criteria:**
- [ ] Create available delivery dates API
- [ ] Filter dates based on shipping method
- [ ] Account for order processing time
- [ ] Block unavailable dates (holidays, capacity limits)
- [ ] Store selected delivery date with order

**Relevant Files:**
- `src/modules/fulfillment/service.ts:108-113, 173-177`
- New API: `src/api/store/delivery-dates/`

---

### [Shipping] Create Shipping Label Generation Service
**Priority:** Medium
**Labels:** `shipping`, `medium-priority`, `ups-integration`, `backend`

**Description:**
Generate UPS shipping labels for fulfilled orders. Current implementation returns mock label URLs.

**Current State:**
`createFulfillment` method returns mock tracking URL and `getFulfillmentDocuments` returns mock label URL.

**Acceptance Criteria:**
- [ ] Integrate with UPS Label Generation API
- [ ] Generate labels in appropriate format (PDF, PNG)
- [ ] Store labels in S3
- [ ] Return real tracking URLs
- [ ] Support void/reprint labels

**Relevant Files:**
- `src/modules/fulfillment/service.ts:148-159, 251-270, 303-308`

---

### [Shipping] Implement Shipment Tracking Integration
**Priority:** Medium
**Labels:** `shipping`, `medium-priority`, `ups-integration`, `backend`

**Description:**
Integrate with UPS Tracking API to provide real-time shipment status updates to customers.

**Acceptance Criteria:**
- [ ] Create tracking status service
- [ ] Implement webhook for UPS status updates
- [ ] Store tracking events with timestamps
- [ ] Create API endpoint for tracking lookup
- [ ] Send tracking notifications to customers

**Relevant Files:**
- New service: `src/services/tracking.ts`
- New API: `src/api/store/tracking/`

---

### [Shipping] Add Temperature Monitoring Requirements
**Priority:** Low
**Labels:** `shipping`, `low-priority`, `temperature-sensitive`, `backend`

**Description:**
Document and implement temperature monitoring requirements for kosher meat shipments to ensure food safety compliance.

**Acceptance Criteria:**
- [ ] Define temperature thresholds for products
- [ ] Document packaging requirements
- [ ] Create temperature excursion handling process
- [ ] Add compliance metadata to shipments

---

## QuickBooks Integration

### [QuickBooks] Create QuickBooks Desktop Integration Module
**Priority:** Critical
**Labels:** `quickbooks`, `critical`, `integration`, `backend`

**Description:**
Create the foundational QuickBooks Desktop integration module for syncing e-commerce data with accounting systems.

**SOW Reference:**
> "Full integration requirements: Discovery & Planning, Data Mapping & Integration Architecture, Execution & Development, Testing & Validation"

**Current State:**
No QuickBooks integration exists in the codebase.

**Acceptance Criteria:**
- [ ] Research QuickBooks Desktop Web Connector requirements
- [ ] Create QuickBooks module structure
- [ ] Implement authentication/connection management
- [ ] Create configuration for QB company file
- [ ] Document integration architecture

**Relevant Files:**
- New module: `src/modules/quickbooks/`
- `medusa-config.ts`
- `.env.template`

---

### [QuickBooks] Implement Order Sync to QuickBooks
**Priority:** Critical
**Labels:** `quickbooks`, `critical`, `orders`, `backend`

**Description:**
Sync completed orders from Medusa to QuickBooks Desktop as sales receipts or invoices, including customer information, line items, taxes, and discounts.

**SOW Reference:**
> "Orders (including customer info, taxes, discounts)"

**Acceptance Criteria:**
- [ ] Create order-to-QB mapping schema
- [ ] Implement order sync workflow triggered on order completion
- [ ] Map Medusa order fields to QB invoice/sales receipt
- [ ] Handle taxes and discounts correctly
- [ ] Include customer information
- [ ] Handle sync errors and retries
- [ ] Create sync status tracking

**Relevant Files:**
- New subscriber: `src/subscribers/order-completed.ts`
- New service: `src/modules/quickbooks/services/order-sync.ts`

---

### [QuickBooks] Implement Payment Sync to QuickBooks
**Priority:** Critical
**Labels:** `quickbooks`, `critical`, `payments`, `backend`

**Description:**
Sync payment transactions from Stripe to QuickBooks Desktop, ensuring accurate financial records.

**SOW Reference:**
> "Payments and refunds"

**Acceptance Criteria:**
- [ ] Map Stripe payments to QB payment records
- [ ] Sync payment method information
- [ ] Handle payment timing (authorization vs capture)
- [ ] Create payment sync workflow
- [ ] Track sync status per payment

**Relevant Files:**
- New service: `src/modules/quickbooks/services/payment-sync.ts`

---

### [QuickBooks] Implement Refund Sync to QuickBooks
**Priority:** Critical
**Labels:** `quickbooks`, `critical`, `payments`, `backend`

**Description:**
Sync refund transactions to QuickBooks Desktop to maintain accurate financial records and reconciliation.

**SOW Reference:**
> "Payments and refunds"

**Acceptance Criteria:**
- [ ] Map Medusa refunds to QB credit memos/refund receipts
- [ ] Trigger sync on refund creation
- [ ] Handle partial refunds
- [ ] Link refunds to original transactions
- [ ] Track sync status

**Relevant Files:**
- New subscriber: `src/subscribers/refund-created.ts`
- New service: `src/modules/quickbooks/services/refund-sync.ts`

---

### [QuickBooks] Implement Inventory Level Sync
**Priority:** High
**Labels:** `quickbooks`, `high-priority`, `inventory`, `backend`

**Description:**
Bidirectional sync of inventory levels between Medusa and QuickBooks Desktop.

**SOW Reference:**
> "Inventory levels and adjustments"

**Acceptance Criteria:**
- [ ] Sync inventory from QB to Medusa (initial load)
- [ ] Push inventory adjustments to QB
- [ ] Handle inventory variance reconciliation
- [ ] Create scheduled sync job
- [ ] Alert on inventory discrepancies

**Relevant Files:**
- New service: `src/modules/quickbooks/services/inventory-sync.ts`

---

### [QuickBooks] Implement Product/Pricing Sync
**Priority:** High
**Labels:** `quickbooks`, `high-priority`, `products`, `backend`

**Description:**
Sync product listings and pricing updates between Medusa and QuickBooks Desktop.

**SOW Reference:**
> "Product listings and pricing updates"

**Acceptance Criteria:**
- [ ] Map Medusa products to QB items
- [ ] Sync product creation/updates to QB
- [ ] Handle variant to QB item mapping
- [ ] Sync pricing changes
- [ ] Handle product categories/types

**Relevant Files:**
- New service: `src/modules/quickbooks/services/product-sync.ts`

---

### [QuickBooks] Implement Financial Transaction Sync
**Priority:** High
**Labels:** `quickbooks`, `high-priority`, `accounting`, `backend`

**Description:**
Sync financial transactions including revenue, expenses, and fees to QuickBooks Desktop.

**SOW Reference:**
> "Financial transactions (e.g., revenue, expenses, fees)"

**Acceptance Criteria:**
- [ ] Map revenue transactions to QB accounts
- [ ] Sync Stripe fees as expenses
- [ ] Handle shipping revenue posting
- [ ] Create journal entries for complex transactions
- [ ] Support multiple GL accounts

**Relevant Files:**
- New service: `src/modules/quickbooks/services/financial-sync.ts`

---

### [QuickBooks] Create QuickBooks Web Connector Endpoint
**Priority:** Critical
**Labels:** `quickbooks`, `critical`, `api`, `backend`

**Description:**
Create the SOAP/XML endpoint required by QuickBooks Web Connector for communication with QuickBooks Desktop.

**Acceptance Criteria:**
- [ ] Implement QBWC SOAP interface
- [ ] Handle authentication handshake
- [ ] Implement request/response XML schema
- [ ] Create qbXML request builders
- [ ] Parse qbXML responses
- [ ] Handle session management

**Relevant Files:**
- New API: `src/api/quickbooks/webconnector/`

---

### [QuickBooks] Create Data Mapping Configuration
**Priority:** High
**Labels:** `quickbooks`, `high-priority`, `configuration`, `backend`

**Description:**
Create configuration system for mapping Medusa entities to QuickBooks Desktop fields and accounts.

**Acceptance Criteria:**
- [ ] Create GL account mapping configuration
- [ ] Map payment methods to QB payment types
- [ ] Configure tax code mappings
- [ ] Map product categories to QB item types
- [ ] Create customer type mappings
- [ ] Document all mapping fields

**Relevant Files:**
- New config: `src/modules/quickbooks/config/`

---

### [QuickBooks] Implement Sync Error Handling and Retry Logic
**Priority:** High
**Labels:** `quickbooks`, `high-priority`, `reliability`, `backend`

**Description:**
Implement robust error handling and retry logic for QuickBooks sync operations.

**Acceptance Criteria:**
- [ ] Create sync error table/logging
- [ ] Implement exponential backoff retry
- [ ] Alert on persistent failures
- [ ] Create manual retry mechanism
- [ ] Track sync history and status
- [ ] Create admin UI for sync management

**Relevant Files:**
- New service: `src/modules/quickbooks/services/sync-manager.ts`

---

## Payments

### [Payments] Implement Credit Card Verification System
**Priority:** Critical
**Labels:** `payments`, `critical`, `security`, `backend`

**Description:**
Develop and integrate a credit card verification system to ensure customers submit valid credit card information during transactions.

**SOW Reference:**
> "Develop and integrate a credit card verification system into the new e-commerce platform to ensure customers submit valid credit card information during transactions."

**Current State:**
Only basic Stripe payment provider is configured in `medusa-config.ts:83-96`. No additional verification logic exists.

**Acceptance Criteria:**
- [ ] Implement address verification (AVS) checking
- [ ] Implement CVV verification
- [ ] Configure Stripe Radar rules
- [ ] Handle verification failure scenarios
- [ ] Block high-risk transactions
- [ ] Log verification results for analysis

**Relevant Files:**
- `medusa-config.ts:83-96`
- New middleware: `src/api/middlewares/payment-verification.ts`

---

### [Payments] Configure Stripe Webhook Handlers
**Priority:** Critical
**Labels:** `payments`, `critical`, `webhooks`, `backend`

**Description:**
Implement comprehensive Stripe webhook handlers for payment events beyond the basic configuration.

**Current State:**
Stripe webhook secret is configured but no custom webhook handling logic exists.

**Acceptance Criteria:**
- [ ] Handle payment_intent.succeeded
- [ ] Handle payment_intent.failed
- [ ] Handle charge.refunded
- [ ] Handle charge.dispute.created
- [ ] Handle checkout.session.completed
- [ ] Implement webhook signature verification
- [ ] Log all webhook events

**Relevant Files:**
- `medusa-config.ts:90`
- New API: `src/api/webhooks/stripe/`

---

### [Payments] Implement Refund Processing Workflow
**Priority:** High
**Labels:** `payments`, `high-priority`, `orders`, `backend`

**Description:**
Create comprehensive refund processing workflow including partial refunds, full refunds, and integration with QuickBooks.

**Acceptance Criteria:**
- [ ] Create refund API endpoint
- [ ] Handle partial refunds
- [ ] Handle full refunds
- [ ] Process Stripe refunds
- [ ] Update order status
- [ ] Trigger QuickBooks sync
- [ ] Send refund confirmation emails

**Relevant Files:**
- New API: `src/api/admin/refunds/`
- New workflow: `src/workflows/process-refund.ts`

---

### [Payments] Implement Payment Fraud Detection
**Priority:** High
**Labels:** `payments`, `high-priority`, `security`, `backend`

**Description:**
Implement fraud detection measures beyond basic Stripe Radar to protect against fraudulent transactions.

**Acceptance Criteria:**
- [ ] Configure Stripe Radar rules for food commerce
- [ ] Implement velocity checking (orders per customer)
- [ ] Flag mismatched billing/shipping addresses
- [ ] Block high-risk countries if applicable
- [ ] Create fraud review queue
- [ ] Document fraud handling procedures

**Relevant Files:**
- New service: `src/services/fraud-detection.ts`

---

### [Payments] Add Payment Method Management
**Priority:** Medium
**Labels:** `payments`, `medium-priority`, `customer`, `backend`

**Description:**
Allow customers to save and manage payment methods for future orders.

**Acceptance Criteria:**
- [ ] Implement saved payment methods via Stripe Customer
- [ ] Create API for listing saved methods
- [ ] Create API for adding new methods
- [ ] Create API for removing methods
- [ ] Set default payment method

**Relevant Files:**
- New API: `src/api/store/payment-methods/`

---

### [Payments] Implement Payment Authorization Hold
**Priority:** Medium
**Labels:** `payments`, `medium-priority`, `backend`

**Description:**
Implement authorization hold pattern where payment is authorized at checkout but captured at fulfillment.

**Acceptance Criteria:**
- [ ] Configure Stripe for auth-only at checkout
- [ ] Capture payment when order fulfilled
- [ ] Handle authorization expiration
- [ ] Cancel auth on order cancellation
- [ ] Document payment flow

**Relevant Files:**
- `medusa-config.ts`
- New workflow: `src/workflows/capture-payment.ts`

---

## Products & Inventory

### [Products] Add Kosher Product Metadata Fields
**Priority:** High
**Labels:** `products`, `high-priority`, `data-model`, `backend`

**Description:**
Add custom metadata fields for kosher meat products including certifications, cut types, and temperature requirements.

**Acceptance Criteria:**
- [ ] Add kosher certification field
- [ ] Add meat cut type classification
- [ ] Add temperature sensitivity flag
- [ ] Add weight unit handling (per lb pricing)
- [ ] Add refrigeration requirements
- [ ] Create product category taxonomy for meats

**Relevant Files:**
- New module: `src/modules/product-metadata/`

---

### [Products] Implement Weight-Based Pricing
**Priority:** High
**Labels:** `products`, `high-priority`, `pricing`, `backend`

**Description:**
Implement pricing model for products sold by weight (per pound) rather than fixed price per unit.

**Acceptance Criteria:**
- [ ] Create weight-based variant type
- [ ] Calculate price based on actual weight
- [ ] Handle price adjustments for actual vs estimated weight
- [ ] Support minimum order quantities
- [ ] Display per-pound pricing to customers

**Relevant Files:**
- Custom pricing module

---

### [Products] Implement Inventory Reservation System
**Priority:** High
**Labels:** `products`, `high-priority`, `inventory`, `backend`

**Description:**
Reserve inventory when items are added to cart/checkout to prevent overselling of limited meat products.

**Acceptance Criteria:**
- [ ] Reserve inventory on cart add
- [ ] Release inventory on cart abandonment
- [ ] Confirm reservation on order placement
- [ ] Handle reservation expiration
- [ ] Prevent overselling

**Relevant Files:**
- New workflow: `src/workflows/inventory-reservation.ts`

---

### [Products] Sync Inventory with Stock Location
**Priority:** Medium
**Labels:** `products`, `medium-priority`, `inventory`, `backend`

**Description:**
Configure inventory management for Atlanta plant location as primary stock location.

**Current State:**
Seed script creates "European Warehouse" stock location.

**Acceptance Criteria:**
- [ ] Create Atlanta plant stock location
- [ ] Configure inventory levels per product
- [ ] Set low stock alerts
- [ ] Implement reorder notifications

**Relevant Files:**
- `src/scripts/seed.ts:97-124`

---

### [Products] Implement Product Availability by Location
**Priority:** Medium
**Labels:** `products`, `medium-priority`, `backend`

**Description:**
Implement product availability rules based on shipping destination (some products may not ship to all locations).

**Acceptance Criteria:**
- [ ] Create product-location availability matrix
- [ ] Filter unavailable products during browse
- [ ] Validate cart items against destination
- [ ] Display availability restrictions to customers

**Relevant Files:**
- New service: `src/services/product-availability.ts`

---

### [Products] Create Grillers Pride Product Categories
**Priority:** Medium
**Labels:** `products`, `medium-priority`, `configuration`, `backend`

**Description:**
Replace default product categories with kosher meat product categories appropriate for Grillers Pride.

**Current State:**
`src/scripts/seed.ts` creates categories: Shirts, Sweatshirts, Pants, Merch - not relevant for meat products.

**Acceptance Criteria:**
- [ ] Create meat-specific categories (Beef, Poultry, Lamb, etc.)
- [ ] Create subcategories for cuts
- [ ] Remove placeholder categories
- [ ] Update seed script

**Relevant Files:**
- `src/scripts/seed.ts:320-343`

---

## Orders & Fulfillment

### [Orders] Create Order Event Subscribers
**Priority:** High
**Labels:** `orders`, `high-priority`, `events`, `backend`

**Description:**
Create subscribers for order lifecycle events to trigger necessary workflows.

**Current State:**
Only product event subscribers exist. No order event handlers.

**Acceptance Criteria:**
- [ ] Create order.placed subscriber
- [ ] Create order.completed subscriber
- [ ] Create order.canceled subscriber
- [ ] Create order.refunded subscriber
- [ ] Trigger appropriate workflows on each event

**Relevant Files:**
- New subscribers: `src/subscribers/order-*.ts`

---

### [Orders] Implement Order Confirmation Workflow
**Priority:** High
**Labels:** `orders`, `high-priority`, `workflows`, `backend`

**Description:**
Create workflow for processing new orders including payment capture, inventory update, and notification sending.

**Acceptance Criteria:**
- [ ] Validate inventory availability
- [ ] Process payment (or verify auth)
- [ ] Update inventory levels
- [ ] Create fulfillment records
- [ ] Send order confirmation email
- [ ] Trigger QuickBooks sync

**Relevant Files:**
- New workflow: `src/workflows/order-confirmation.ts`

---

### [Orders] Implement Fulfillment Workflow for Pickup Orders
**Priority:** High
**Labels:** `orders`, `high-priority`, `fulfillment`, `backend`

**Description:**
Create specialized fulfillment workflow for plant pickup orders, different from shipped orders.

**Acceptance Criteria:**
- [ ] Identify pickup orders vs shipped orders
- [ ] Generate pickup confirmation
- [ ] Create pickup slip/receipt
- [ ] Set pickup ready date
- [ ] Send pickup ready notification
- [ ] Track pickup completion

**Relevant Files:**
- `src/modules/fulfillment/service.ts`
- New workflow: `src/workflows/pickup-fulfillment.ts`

---

### [Orders] Implement Order Cancellation Workflow
**Priority:** Medium
**Labels:** `orders`, `medium-priority`, `workflows`, `backend`

**Description:**
Create workflow for handling order cancellations including inventory release and refund processing.

**Acceptance Criteria:**
- [ ] Cancel before fulfillment - full refund
- [ ] Cancel after ship - return process
- [ ] Release reserved inventory
- [ ] Process refund via Stripe
- [ ] Update QuickBooks
- [ ] Send cancellation confirmation

**Relevant Files:**
- New workflow: `src/workflows/order-cancellation.ts`

---

### [Orders] Create Order Notes and Admin Actions
**Priority:** Medium
**Labels:** `orders`, `medium-priority`, `admin`, `backend`

**Description:**
Implement ability for admins to add notes to orders and perform administrative actions.

**Acceptance Criteria:**
- [ ] Add notes to orders
- [ ] View order history/timeline
- [ ] Manual status updates
- [ ] Priority flagging
- [ ] Customer communication logging

**Relevant Files:**
- New API: `src/api/admin/orders/notes/`

---

### [Orders] Implement Order Search and Filtering
**Priority:** Medium
**Labels:** `orders`, `medium-priority`, `admin`, `backend`

**Description:**
Create comprehensive order search functionality for admin users.

**Acceptance Criteria:**
- [ ] Search by order number
- [ ] Search by customer name/email
- [ ] Filter by status
- [ ] Filter by date range
- [ ] Filter by shipping method
- [ ] Export order reports

**Relevant Files:**
- New API: `src/api/admin/orders/search/`

---

### [Orders] Create Packing Slip Generation
**Priority:** Medium
**Labels:** `orders`, `medium-priority`, `fulfillment`, `backend`

**Description:**
Generate packing slips for orders including product details, customer info, and special handling instructions.

**Acceptance Criteria:**
- [ ] Generate PDF packing slip
- [ ] Include product details and quantities
- [ ] Include customer shipping info
- [ ] Add special handling notes (temperature requirements)
- [ ] Include dry ice information
- [ ] Store in S3

**Relevant Files:**
- New service: `src/services/packing-slip.ts`

---

## Customers & Auth

### [Customers] Implement Customer Account Management
**Priority:** High
**Labels:** `customers`, `high-priority`, `backend`

**Description:**
Create customer account management functionality including profile updates and order history.

**Acceptance Criteria:**
- [ ] Create customer profile API
- [ ] Allow profile updates
- [ ] View order history
- [ ] Manage addresses
- [ ] Manage payment methods
- [ ] Account deletion (GDPR compliance)

**Relevant Files:**
- New API: `src/api/store/me/`

---

### [Customers] Implement Customer Address Book
**Priority:** Medium
**Labels:** `customers`, `medium-priority`, `backend`

**Description:**
Allow customers to save multiple shipping addresses for quick checkout.

**Acceptance Criteria:**
- [ ] Create address CRUD API
- [ ] Set default shipping address
- [ ] Set default billing address
- [ ] Validate addresses with UPS
- [ ] Limit number of saved addresses

**Relevant Files:**
- New API: `src/api/store/addresses/`

---

### [Customers] Implement Guest Checkout Flow
**Priority:** Medium
**Labels:** `customers`, `medium-priority`, `backend`

**Description:**
Ensure guest checkout is properly supported without requiring account creation.

**Acceptance Criteria:**
- [ ] Allow checkout without registration
- [ ] Capture email for order updates
- [ ] Option to create account after checkout
- [ ] Link guest orders to account if created later

**Relevant Files:**
- Checkout workflow configuration

---

### [Customers] Create Customer Segmentation
**Priority:** Low
**Labels:** `customers`, `low-priority`, `analytics`, `backend`

**Description:**
Implement customer segmentation for marketing and analytics purposes.

**Acceptance Criteria:**
- [ ] Track customer order frequency
- [ ] Calculate customer lifetime value
- [ ] Segment by purchase behavior
- [ ] Tag VIP/repeat customers
- [ ] Enable targeted communications

**Relevant Files:**
- New service: `src/services/customer-segmentation.ts`

---

## API & Webhooks

### [API] Implement Custom Store API Routes
**Priority:** High
**Labels:** `api`, `high-priority`, `backend`

**Description:**
The custom store API route is currently a placeholder returning only status 200. Implement actual functionality.

**Current State:**
`src/api/store/custom/route.ts` only returns `sendStatus(200)`.

**Acceptance Criteria:**
- [ ] Define required store API endpoints
- [ ] Implement shipping calculation endpoint
- [ ] Implement delivery date endpoint
- [ ] Implement address validation endpoint
- [ ] Document all custom endpoints

**Relevant Files:**
- `src/api/store/custom/route.ts`

---

### [API] Implement Custom Admin API Routes
**Priority:** High
**Labels:** `api`, `high-priority`, `admin`, `backend`

**Description:**
The custom admin API route is currently a placeholder. Implement actual admin functionality.

**Current State:**
`src/api/admin/custom/route.ts` only returns `sendStatus(200)`.

**Acceptance Criteria:**
- [ ] Define required admin API endpoints
- [ ] Implement QuickBooks sync status endpoint
- [ ] Implement manual sync triggers
- [ ] Implement reporting endpoints
- [ ] Document all custom endpoints

**Relevant Files:**
- `src/api/admin/custom/route.ts`

---

### [API] Create Shipping Rates API Endpoint
**Priority:** High
**Labels:** `api`, `high-priority`, `shipping`, `backend`

**Description:**
Create dedicated API endpoint for fetching shipping rates with full UPS integration.

**Acceptance Criteria:**
- [ ] Accept address and cart items
- [ ] Return all available shipping options
- [ ] Include real-time UPS rates
- [ ] Include transit times
- [ ] Include dry ice requirements
- [ ] Cache rates appropriately

**Relevant Files:**
- New API: `src/api/store/shipping-rates/`

---

### [API] Implement Order Webhook Notifications
**Priority:** Medium
**Labels:** `api`, `medium-priority`, `webhooks`, `backend`

**Description:**
Create outgoing webhook system to notify external systems of order events.

**Acceptance Criteria:**
- [ ] Configure webhook endpoints
- [ ] Send order.created webhook
- [ ] Send order.fulfilled webhook
- [ ] Implement webhook retry logic
- [ ] Log webhook deliveries

**Relevant Files:**
- New service: `src/services/webhook-dispatcher.ts`

---

### [API] Create Health Check Endpoints
**Priority:** Medium
**Labels:** `api`, `medium-priority`, `infrastructure`, `backend`

**Description:**
Create comprehensive health check endpoints for monitoring system status.

**Acceptance Criteria:**
- [ ] Check database connectivity
- [ ] Check Redis connectivity
- [ ] Check Stripe connectivity
- [ ] Check UPS API connectivity
- [ ] Check QuickBooks connectivity
- [ ] Return detailed health status

**Relevant Files:**
- New API: `src/api/health/`

---

### [API] Implement Rate Limiting
**Priority:** Medium
**Labels:** `api`, `medium-priority`, `security`, `backend`

**Description:**
Implement API rate limiting to prevent abuse and ensure fair usage.

**Acceptance Criteria:**
- [ ] Configure rate limits per endpoint
- [ ] Implement per-IP limiting
- [ ] Implement per-user limiting
- [ ] Return appropriate rate limit headers
- [ ] Log rate limit violations

**Relevant Files:**
- New middleware: `src/api/middlewares/rate-limit.ts`

---

## Testing

### [Testing] Create Unit Tests for Fulfillment Service
**Priority:** High
**Labels:** `testing`, `high-priority`, `unit-tests`, `backend`

**Description:**
Create comprehensive unit tests for the GrillersFulfillmentProviderService.

**SOW Reference:**
> "Rigorous testing, including unit, integration, and user acceptance tests"

**Current State:**
No unit tests exist for the fulfillment service.

**Acceptance Criteria:**
- [ ] Test getFulfillmentOptions()
- [ ] Test canCalculate()
- [ ] Test calculatePrice() with various scenarios
- [ ] Test createFulfillment()
- [ ] Test cancelFulfillment()
- [ ] Mock external dependencies
- [ ] Achieve >80% code coverage

**Relevant Files:**
- `src/modules/fulfillment/service.ts`
- New tests: `src/modules/fulfillment/__tests__/`

---

### [Testing] Create Unit Tests for Strapi Module
**Priority:** High
**Labels:** `testing`, `high-priority`, `unit-tests`, `backend`

**Description:**
Create unit tests for the Strapi integration module.

**Current State:**
No unit tests exist for Strapi service.

**Acceptance Criteria:**
- [ ] Test findProductByMedusaId()
- [ ] Test createProduct()
- [ ] Test updateProduct()
- [ ] Test deleteProduct()
- [ ] Test error handling
- [ ] Mock Axios client

**Relevant Files:**
- `src/modules/strapi/service.ts`
- New tests: `src/modules/strapi/__tests__/`

---

### [Testing] Create Integration Tests for API Routes
**Priority:** High
**Labels:** `testing`, `high-priority`, `integration-tests`, `backend`

**Description:**
Create integration tests for custom API routes.

**Current State:**
Only one basic health check test exists in `integration-tests/http/health.spec.ts`.

**Acceptance Criteria:**
- [ ] Test store API endpoints
- [ ] Test admin API endpoints
- [ ] Test authentication flows
- [ ] Test shipping calculation endpoint
- [ ] Test order creation flow

**Relevant Files:**
- `integration-tests/http/health.spec.ts`
- New tests: `integration-tests/http/`

---

### [Testing] Create Integration Tests for Workflows
**Priority:** High
**Labels:** `testing`, `high-priority`, `integration-tests`, `backend`

**Description:**
Create integration tests for custom workflows.

**Acceptance Criteria:**
- [ ] Test sync-product-to-strapi workflow
- [ ] Test order processing workflows
- [ ] Test payment workflows
- [ ] Test fulfillment workflows
- [ ] Test error compensation

**Relevant Files:**
- `src/workflows/sync-product-to-strapi.ts`
- New tests: `integration-tests/workflows/`

---

### [Testing] Create E2E Tests for Checkout Flow
**Priority:** High
**Labels:** `testing`, `high-priority`, `e2e-tests`, `backend`

**Description:**
Create end-to-end tests for the complete checkout flow.

**Acceptance Criteria:**
- [ ] Test cart creation
- [ ] Test adding items to cart
- [ ] Test shipping calculation
- [ ] Test payment processing
- [ ] Test order creation
- [ ] Test order confirmation

**Relevant Files:**
- New tests: `integration-tests/e2e/`

---

### [Testing] Set Up Test Coverage Reporting
**Priority:** Medium
**Labels:** `testing`, `medium-priority`, `infrastructure`, `backend`

**Description:**
Configure test coverage reporting and set minimum coverage thresholds.

**Acceptance Criteria:**
- [ ] Configure Jest coverage reporting
- [ ] Set minimum coverage thresholds
- [ ] Generate coverage reports
- [ ] Integrate with CI/CD
- [ ] Block PRs below threshold

**Relevant Files:**
- `jest.config.js`

---

## Documentation

### [Docs] Create API Documentation
**Priority:** High
**Labels:** `documentation`, `high-priority`, `backend`

**Description:**
Create comprehensive API documentation for all custom endpoints.

**SOW Reference:**
Implicit requirement for maintainable, documented system.

**Current State:**
README.md contains only default Medusa documentation.

**Acceptance Criteria:**
- [ ] Document all store API endpoints
- [ ] Document all admin API endpoints
- [ ] Include request/response examples
- [ ] Document authentication requirements
- [ ] Generate OpenAPI/Swagger spec

**Relevant Files:**
- `README.md`
- New: `docs/api.md`

---

### [Docs] Create Deployment Guide
**Priority:** High
**Labels:** `documentation`, `high-priority`, `infrastructure`, `backend`

**Description:**
Create comprehensive deployment documentation for the Medusa backend.

**Acceptance Criteria:**
- [ ] Document environment setup
- [ ] Document database setup
- [ ] Document Redis configuration
- [ ] Document S3 configuration
- [ ] Document environment variables
- [ ] Document deployment steps
- [ ] Include troubleshooting guide

**Relevant Files:**
- `.env.template`
- New: `docs/deployment.md`

---

### [Docs] Create QuickBooks Integration Guide
**Priority:** High
**Labels:** `documentation`, `high-priority`, `quickbooks`, `backend`

**Description:**
Create documentation for QuickBooks Desktop integration setup and operation.

**Acceptance Criteria:**
- [ ] Document QB Web Connector setup
- [ ] Document field mappings
- [ ] Document sync schedules
- [ ] Document error handling
- [ ] Include troubleshooting guide

**Relevant Files:**
- New: `docs/quickbooks-integration.md`

---

### [Docs] Create UPS Integration Guide
**Priority:** High
**Labels:** `documentation`, `high-priority`, `shipping`, `backend`

**Description:**
Create documentation for UPS integration setup and configuration.

**Acceptance Criteria:**
- [ ] Document UPS account requirements
- [ ] Document API credentials setup
- [ ] Document shipping options configuration
- [ ] Document rate calculation logic
- [ ] Include troubleshooting guide

**Relevant Files:**
- New: `docs/ups-integration.md`

---

## Infrastructure

### [Infrastructure] Configure Production Environment
**Priority:** Critical
**Labels:** `infrastructure`, `critical`, `deployment`, `backend`

**Description:**
Configure production environment settings for hosting Grillers Pride backend.

**SOW Reference:**
> "Hosting setup and configuration"

**Current State:**
`.env.template` contains basic development configuration only.

**Acceptance Criteria:**
- [ ] Create production configuration
- [ ] Configure production database
- [ ] Configure production Redis
- [ ] Set up S3 bucket for production
- [ ] Configure CORS for production domains
- [ ] Set secure JWT/Cookie secrets

**Relevant Files:**
- `.env.template`
- `medusa-config.ts`

---

### [Infrastructure] Implement Security Hardening
**Priority:** Critical
**Labels:** `infrastructure`, `critical`, `security`, `backend`

**Description:**
Implement security best practices for the production environment.

**SOW Reference:**
> "Performance, security, and scalability optimization"

**Acceptance Criteria:**
- [ ] Configure HTTPS enforcement
- [ ] Implement security headers
- [ ] Configure CORS properly
- [ ] Secure environment variables
- [ ] Implement request validation
- [ ] Set up security monitoring
- [ ] Configure rate limiting
- [ ] Implement input sanitization

**Relevant Files:**
- `medusa-config.ts`
- New: security middleware

---

### [Infrastructure] Configure Performance Optimization
**Priority:** High
**Labels:** `infrastructure`, `high-priority`, `performance`, `backend`

**Description:**
Optimize backend performance for production traffic.

**SOW Reference:**
> "Performance, security, and scalability optimization"

**Acceptance Criteria:**
- [ ] Configure Redis caching strategy
- [ ] Optimize database queries
- [ ] Implement connection pooling
- [ ] Configure worker processes
- [ ] Set up CDN for assets
- [ ] Implement response compression

**Relevant Files:**
- `medusa-config.ts`

---

### [Infrastructure] Set Up Monitoring and Logging
**Priority:** High
**Labels:** `infrastructure`, `high-priority`, `monitoring`, `backend`

**Description:**
Implement comprehensive monitoring and logging for production operations.

**Acceptance Criteria:**
- [ ] Configure structured logging
- [ ] Set up error tracking (Sentry or similar)
- [ ] Implement performance monitoring
- [ ] Create alerting rules
- [ ] Set up log aggregation
- [ ] Monitor API response times

**Relevant Files:**
- `instrumentation.ts`
- New logging configuration

---

## Data & Analytics

### [Analytics] Implement Event Capture System
**Priority:** Medium
**Labels:** `analytics`, `medium-priority`, `backend`

**Description:**
Capture user action events for analytics and tracking purposes.

**SOW Reference:**
> "Event capture for user actions"

**Acceptance Criteria:**
- [ ] Define events to capture
- [ ] Create event emission service
- [ ] Track product views
- [ ] Track add to cart events
- [ ] Track checkout events
- [ ] Track purchase events
- [ ] Forward events to analytics platform

**Relevant Files:**
- New service: `src/services/analytics.ts`

---

### [Analytics] Implement Data Layer for Tracking
**Priority:** Medium
**Labels:** `analytics`, `medium-priority`, `backend`

**Description:**
Implement data layer structure for tracking integration.

**SOW Reference:**
> "Data layer implementation for tracking"

**Acceptance Criteria:**
- [ ] Define data layer schema
- [ ] Include product data in layer
- [ ] Include cart data in layer
- [ ] Include order data in layer
- [ ] Support Google Analytics 4
- [ ] Support Facebook Pixel

**Relevant Files:**
- New API: `src/api/store/tracking-data/`

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Shipping & Delivery | 4 | 4 | 5 | 1 | 14 |
| QuickBooks Integration | 4 | 6 | 0 | 0 | 10 |
| Payments | 2 | 2 | 2 | 0 | 6 |
| Products & Inventory | 0 | 3 | 3 | 0 | 6 |
| Orders & Fulfillment | 0 | 3 | 4 | 0 | 7 |
| Customers & Auth | 0 | 1 | 2 | 1 | 4 |
| API & Webhooks | 0 | 3 | 3 | 0 | 6 |
| Testing | 0 | 5 | 1 | 0 | 6 |
| Documentation | 0 | 4 | 0 | 0 | 4 |
| Infrastructure | 2 | 2 | 0 | 0 | 4 |
| **TOTAL** | **12** | **33** | **20** | **2** | **67** |

### Critical Issues (Must have for launch)
1. UPS API Integration for Real-Time Rates
2. UPS Transit Days Calculation
3. Destination Delivery Cost Calculation
4. UPS Account Configuration Module
5. QuickBooks Desktop Integration Module
6. Order Sync to QuickBooks
7. Payment Sync to QuickBooks
8. Refund Sync to QuickBooks
9. QuickBooks Web Connector Endpoint
10. Credit Card Verification System
11. Configure Production Environment
12. Implement Security Hardening
