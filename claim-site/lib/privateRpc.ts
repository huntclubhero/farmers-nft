import { http, type Transport } from "viem";

/**
 * Private RPC URL used for tx submission.
 *
 * Defaults to Flashbots Protect for Base. This shields user claims from
 * public mempool front-running. Override via NEXT_PUBLIC_PRIVATE_RPC_URL
 * (e.g. blink RPC, mev-share, or any other private relay).
 *
 * NOTE: Flashbots Protect rejects reads on most methods; use it only for
 * eth_sendRawTransaction. All reads must go through publicTransport.
 */
export const PRIVATE_RPC_URL =
  process.env.NEXT_PUBLIC_PRIVATE_RPC_URL || "https://protect.flashbots.net/rpc";

/**
 * Public RPC URL used for reads.
 */
export const PUBLIC_RPC_URL =
  process.env.NEXT_PUBLIC_PUBLIC_RPC_URL || "https://mainnet.base.org";

export const privateTransport: Transport = http(PRIVATE_RPC_URL);
export const publicTransport: Transport = http(PUBLIC_RPC_URL);
