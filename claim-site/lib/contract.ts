import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { activeChain } from "./wagmi";
import { PRIVATE_RPC_URL } from "./privateRpc";

export const PROXY_ADDRESS = (process.env.NEXT_PUBLIC_PROXY_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

/**
 * Minimal ABI: only the functions the claim site calls.
 */
export const hatPetAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenSprite",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "claimedHash",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimStart",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "claimEnd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "tokenHash", type: "bytes32", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "spriteId", type: "uint16", indexed: false },
    ],
  },
] as const;

/**
 * Build a viem walletClient that signs with the Privy wallet provider but
 * submits the signed raw transaction to the configured private RPC.
 *
 * The Privy wallet returns an EIP-1193 provider (from getEthereumProvider).
 * We pipe sign requests to that provider via `custom(provider)`, but the
 * transport URL is the private RPC (Flashbots Protect by default).
 *
 * Because viem routes eth_sendRawTransaction through the configured
 * transport, the signed tx goes straight to the private relay and never
 * touches the public mempool.
 */
export function getWalletClient(
  provider: EIP1193Provider,
  account: Address,
): WalletClient {
  return createWalletClient({
    account,
    chain: activeChain,
    // Sign through the wallet provider (Privy embedded or injected wallet).
    // Submit through the private RPC.
    transport: custom({
      async request({ method, params }) {
        const writeMethods = new Set([
          "eth_sendRawTransaction",
        ]);
        if (writeMethods.has(method)) {
          const res = await fetch(PRIVATE_RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params,
            }),
          });
          const json = await res.json();
          if (json.error) {
            throw new Error(
              `Private RPC error: ${json.error.message || JSON.stringify(json.error)}`,
            );
          }
          return json.result;
        }
        // Everything else (signing, chain id, accounts, gas estimation
        // fallback, etc.) goes to the wallet provider.
        return provider.request({ method, params } as Parameters<
          typeof provider.request
        >[0]);
      },
    }),
  });
}
