import { createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { publicTransport } from "./privateRpc";

const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453");

export const activeChain = envChainId === 84532 ? baseSepolia : base;

/**
 * wagmi config uses the public RPC for all reads.
 *
 * Writes do NOT go through wagmi's transport. Instead, the claim page
 * builds a viem walletClient pointed at the private RPC (Flashbots Protect
 * by default) so that the signed tx is submitted privately. See
 * lib/contract.ts -> getWalletClient.
 */
// wagmi narrows `chains: [activeChain]` to the union of both chain types,
// so the transports record must include both IDs even though only one is
// active at runtime. Reusing the same publicTransport is safe: the wagmi
// client only ever uses the entry that matches the active chain.
export const wagmiConfig = createConfig({
  chains: [activeChain],
  transports: {
    [base.id]: publicTransport,
    [baseSepolia.id]: publicTransport,
  },
  ssr: true,
});

export type ActiveChain = typeof activeChain;
