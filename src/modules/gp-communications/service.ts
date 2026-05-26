import { MedusaService } from "@medusajs/framework/utils"
import Campaign from "./models/campaign"
import Attribution from "./models/attribution"
import CartLifecycle from "./models/cart-lifecycle"
import CommunicationEvent from "./models/communication-event"
import CommunicationFlow from "./models/communication-flow"
import CustomerProfile from "./models/customer-profile"
import EmailTemplate from "./models/email-template"
import EventDelivery from "./models/event-delivery"
import FlowEnrollment from "./models/flow-enrollment"
import IdentityMap from "./models/identity-map"
import ImportRun from "./models/import-run"
import LinkClick from "./models/link-click"
import MessageLog from "./models/message-log"
import Segment from "./models/segment"
import SegmentMember from "./models/segment-member"
import SuppressionPreference from "./models/suppression-preference"

class GpCommunicationsModuleService extends MedusaService({
  Attribution,
  Campaign,
  CartLifecycle,
  CommunicationEvent,
  CommunicationFlow,
  CustomerProfile,
  EmailTemplate,
  EventDelivery,
  FlowEnrollment,
  IdentityMap,
  ImportRun,
  LinkClick,
  MessageLog,
  Segment,
  SegmentMember,
  SuppressionPreference,
}) {}

export default GpCommunicationsModuleService
