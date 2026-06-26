/**
 * Checkout Test Order — commit execution orchestrator (deps INJECTED, test edilebilir).
 *
 * Gerçek mutation'lar `ExecutionDeps` arkasında soyutlanır; script bunları Medusa
 * public workflow/Store API ile bağlar, testler fake adapter ile bağlar. Bu dosya
 * sırayı, fail-closed guard'ları, abort-on-failure ve tek-complete davranışını
 * kapsar. Retry loop YOK; existing cart kullanılmaz.
 */

import {
  CartStateForComplete,
  evaluatePreComplete,
  PreCompleteExpected,
} from "./checkout-test-plan"

export interface OrderReadBack {
  id: string
  display_id: number | string | null
  email: string | null
  currency_code: string | null
  item_count: number
  variant_ids: string[]
  item_subtotal: number | null
  shipping_total: number | null
  tax_total: number | null
  grand_total: number | null
  shipping_country: string | null
  status: string | null
  payment_status: string | null
  fulfillment_status: string | null
  metadata: Record<string, unknown> | null
}

export interface PaymentSessionState {
  payment_collection_id: string | null
  payment_session_id: string | null
  provider_id: string | null
  status: string | null
}

export interface ExecutionDeps {
  /** Read-only duplicate gate: aynı policy için aktif (iptal edilmemiş) test order. */
  findActiveDuplicateTestOrder(): Promise<{ exists: boolean; order_ids: string[] }>
  createCart(): Promise<{ cart_id: string }>
  addLineItem(cartId: string): Promise<{ line_item_id: string }>
  setEmailAndAddress(cartId: string): Promise<void>
  addShippingMethod(cartId: string): Promise<{ shipping_method_id: string }>
  initPaymentSession(cartId: string): Promise<PaymentSessionState>
  retrieveCartForComplete(cartId: string): Promise<CartStateForComplete>
  completeCart(cartId: string): Promise<{ type: "order" | "cart"; order_id: string | null }>
  retrieveOrder(orderId: string): Promise<OrderReadBack>
}

export type ExecutionDecision =
  | "EXECUTION_DUPLICATE_BLOCKED"
  | "EXECUTION_PRE_COMPLETE_BLOCKED"
  | "EXECUTION_PARTIAL_FAILURE"
  | "EXECUTION_PARTIAL_VERIFICATION"
  | "EXECUTION_COMMITTED"

export interface CreatedIds {
  cart_id: string | null
  line_item_id: string | null
  shipping_method_id: string | null
  payment_collection_id: string | null
  payment_session_id: string | null
  order_id: string | null
}

export interface ExecutionResult {
  execution_started: boolean
  mutation_sequence: string[]
  created_ids: CreatedIds
  pre_complete_snapshot: CartStateForComplete | null
  pre_complete_gate: { ok: boolean; blockers: string[] } | null
  complete_result: { type: string; order_id: string | null } | null
  order_read_back: OrderReadBack | null
  payment_state: PaymentSessionState | null
  partial_failure: { stage: string; error: string } | null
  recovery_recommendation: string | null
  actual_mutations: number
  decision: ExecutionDecision
}

const EMPTY_IDS: CreatedIds = {
  cart_id: null,
  line_item_id: null,
  shipping_method_id: null,
  payment_collection_id: null,
  payment_session_id: null,
  order_id: null,
}

/**
 * Gerçek mutation zinciri. Her adım abort-on-failure; complete yalnız
 * pre-complete revalidation geçerse ve YALNIZ BİR KEZ çağrılır. Read-back
 * başarısızsa complete tekrar edilmez (partial verification).
 */
export async function executeCheckoutTestOrder(
  deps: ExecutionDeps,
  expected: PreCompleteExpected & { payment_provider_id: string }
): Promise<ExecutionResult> {
  const sequence: string[] = []
  const ids: CreatedIds = { ...EMPTY_IDS }
  let mutations = 0
  let paymentState: PaymentSessionState | null = null

  const fail = (stage: string, error: string, recovery: string): ExecutionResult => ({
    execution_started: true,
    mutation_sequence: sequence,
    created_ids: ids,
    pre_complete_snapshot: null,
    pre_complete_gate: null,
    complete_result: null,
    order_read_back: null,
    payment_state: paymentState,
    partial_failure: { stage, error },
    recovery_recommendation: recovery,
    actual_mutations: mutations,
    decision: "EXECUTION_PARTIAL_FAILURE",
  })

  // 0) Duplicate gate (read-only, mutation ÖNCESİ).
  const dup = await deps.findActiveDuplicateTestOrder()
  if (dup.exists) {
    return {
      execution_started: false,
      mutation_sequence: [],
      created_ids: ids,
      pre_complete_snapshot: null,
      pre_complete_gate: null,
      complete_result: null,
      order_read_back: null,
      payment_state: null,
      partial_failure: null,
      recovery_recommendation: `Aktif test order zaten var (${dup.order_ids.join(",")}). Yeni order oluşturulmadı; önce cancel/inceleme.`,
      actual_mutations: 0,
      decision: "EXECUTION_DUPLICATE_BLOCKED",
    }
  }

  // 1) Cart create
  try {
    const r = await deps.createCart()
    ids.cart_id = r.cart_id
    sequence.push("TEST_CART_CREATE")
    mutations++
  } catch (e) {
    return fail("TEST_CART_CREATE", errMsg(e), "Cart oluşmadı; temizlik gerekmez.")
  }

  // 2) Line item
  try {
    const r = await deps.addLineItem(ids.cart_id!)
    ids.line_item_id = r.line_item_id
    sequence.push("LINE_ITEM_ADD")
    mutations++
  } catch (e) {
    return fail("LINE_ITEM_ADD", errMsg(e), `Cart ${ids.cart_id} boş kaldı; ayrı cleanup planı (cart silme önerilmez, abandoned bırak).`)
  }

  // 3) Email + address
  try {
    await deps.setEmailAndAddress(ids.cart_id!)
    sequence.push("EMAIL_AND_ADDRESS_SET")
    mutations++
  } catch (e) {
    return fail("EMAIL_AND_ADDRESS_SET", errMsg(e), `Cart ${ids.cart_id} complete edilmedi; ayrı cleanup.`)
  }

  // 4) Shipping method
  try {
    const r = await deps.addShippingMethod(ids.cart_id!)
    ids.shipping_method_id = r.shipping_method_id
    sequence.push("SHIPPING_METHOD_ADD")
    mutations++
  } catch (e) {
    return fail("SHIPPING_METHOD_ADD", errMsg(e), `Cart ${ids.cart_id} complete edilmedi; ayrı cleanup.`)
  }

  // 5+6) Payment collection + session
  try {
    paymentState = await deps.initPaymentSession(ids.cart_id!)
    ids.payment_collection_id = paymentState.payment_collection_id
    ids.payment_session_id = paymentState.payment_session_id
    sequence.push("PAYMENT_COLLECTION_CREATE")
    sequence.push("PAYMENT_SESSION_INITIALIZE")
    mutations += 2
  } catch (e) {
    return fail("PAYMENT_SESSION_INITIALIZE", errMsg(e), `Cart ${ids.cart_id} complete edilmedi; payment session yok/incele.`)
  }
  // Provider doğrulaması — yanlışsa complete ETME.
  if (paymentState.provider_id !== expected.payment_provider_id) {
    return {
      ...fail("PAYMENT_SESSION_INITIALIZE", `payment_provider_mismatch:${paymentState.provider_id}`, "Provider beklenenden farklı; complete edilmedi."),
    }
  }

  // 7) Pre-complete revalidation (complete'ten HEMEN önce yeniden retrieve)
  let state: CartStateForComplete
  try {
    state = await deps.retrieveCartForComplete(ids.cart_id!)
  } catch (e) {
    return fail("PRE_COMPLETE_RETRIEVE", errMsg(e), `Cart ${ids.cart_id} okunamadı; complete edilmedi.`)
  }
  const gate = evaluatePreComplete(state, expected)
  if (!gate.ok) {
    return {
      execution_started: true,
      mutation_sequence: sequence,
      created_ids: ids,
      pre_complete_snapshot: state,
      pre_complete_gate: gate,
      complete_result: null,
      order_read_back: null,
      payment_state: paymentState,
      partial_failure: null,
      recovery_recommendation: `Pre-complete drift (${gate.blockers.join(",")}); cart ${ids.cart_id} COMPLETE EDİLMEDİ. Ayrı inceleme.`,
      actual_mutations: mutations,
      decision: "EXECUTION_PRE_COMPLETE_BLOCKED",
    }
  }

  // 8) Cart complete (YALNIZ BİR KEZ)
  let complete: { type: "order" | "cart"; order_id: string | null }
  try {
    complete = await deps.completeCart(ids.cart_id!)
    sequence.push("CART_COMPLETE")
    mutations++
  } catch (e) {
    return {
      execution_started: true,
      mutation_sequence: sequence,
      created_ids: ids,
      pre_complete_snapshot: state,
      pre_complete_gate: gate,
      complete_result: null,
      order_read_back: null,
      payment_state: paymentState,
      partial_failure: { stage: "CART_COMPLETE", error: errMsg(e) },
      recovery_recommendation: `Complete hata verdi; payment session var, order belirsiz. KÖR RETRY YOK — cart ${ids.cart_id} state read-back ile incele.`,
      actual_mutations: mutations,
      decision: "EXECUTION_PARTIAL_FAILURE",
    }
  }

  if (complete.type !== "order" || !complete.order_id) {
    return {
      execution_started: true,
      mutation_sequence: sequence,
      created_ids: ids,
      pre_complete_snapshot: state,
      pre_complete_gate: gate,
      complete_result: { type: complete.type, order_id: complete.order_id },
      order_read_back: null,
      payment_state: paymentState,
      partial_failure: { stage: "CART_COMPLETE", error: "complete_did_not_return_order" },
      recovery_recommendation: "Complete order döndürmedi; KÖR RETRY YOK — cart state incele.",
      actual_mutations: mutations,
      decision: "EXECUTION_PARTIAL_FAILURE",
    }
  }
  ids.order_id = complete.order_id

  // 9) Order read-back (complete tekrar ÇAĞRILMAZ)
  try {
    const order = await deps.retrieveOrder(complete.order_id)
    return {
      execution_started: true,
      mutation_sequence: sequence,
      created_ids: ids,
      pre_complete_snapshot: state,
      pre_complete_gate: gate,
      complete_result: { type: complete.type, order_id: complete.order_id },
      order_read_back: order,
      payment_state: paymentState,
      partial_failure: null,
      recovery_recommendation: null,
      actual_mutations: mutations,
      decision: "EXECUTION_COMMITTED",
    }
  } catch (e) {
    return {
      execution_started: true,
      mutation_sequence: sequence,
      created_ids: ids,
      pre_complete_snapshot: state,
      pre_complete_gate: gate,
      complete_result: { type: complete.type, order_id: complete.order_id },
      order_read_back: null,
      payment_state: paymentState,
      partial_failure: { stage: "ORDER_READ_BACK_VERIFY", error: errMsg(e) },
      recovery_recommendation: `Order ${complete.order_id} oluştu ama read-back başarısız; COMPLETE TEKRAR ÇAĞRILMAZ — order/cart relation üzerinden doğrula.`,
      actual_mutations: mutations,
      decision: "EXECUTION_PARTIAL_VERIFICATION",
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
