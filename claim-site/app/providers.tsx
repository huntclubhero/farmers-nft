"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { wagmiConfig, activeChain } from "@/lib/wagmi";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// Privy throws hard if appId is missing or placeholder, which breaks the build
// for prerendered pages (like /_not-found). When the id is absent we render
// the rest of the tree without PrivyProvider so dev/build still works.
// The claim page will show a clear "Privy not configured" message when no id.
const privyConfigured = Boolean(privyAppId && privyAppId.length >= 20);

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);

  const inner = (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
    </QueryClientProvider>
  );

  if (!privyConfigured) {
    return inner;
  }

  return (
    <PrivyProvider
      appId={privyAppId as string}
      config={{
        loginMethods: ["wallet", "email", "google"],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        defaultChain: activeChain,
        supportedChains: [activeChain],
        appearance: {
          theme: "dark",
          accentColor: "#f5d97a",
        },
      }}
    >
      {inner}
    </PrivyProvider>
  );
}
