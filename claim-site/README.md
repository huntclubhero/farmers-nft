# Hat Pets claim site

Next.js 15 frontend for the hat-gated, fully on-chain tamagotchi NFT drop on Base.

Each physical hat has an NFC chip that opens a URL of the form:

```
https://your-domain.tld/c/<64-char-hex-token>
```

The site reads the HatPet contract, figures out whether this token is eligible / already claimed / inside the claim window, and (if everything checks out) submits the `claim()` transaction through a private RPC so the mint can't be sniped from the public mempool.

## Stack

- Next.js 15 (App Router) with TypeScript
- Tailwind CSS 3 (dark, pixel-art friendly)
- Privy (wallet auth: embedded + external)
- wagmi v2 + viem v2 (reads + signing)
- Flashbots Protect on Base (private tx submission by default)

## Install + run

From this directory:

```
npm install
npm run dev
```

Then open `http://localhost:3000/c/<token>`.

## Configure

Copy `.env.example` to `.env.local` and fill in the values:

- `NEXT_PUBLIC_PRIVY_APP_ID` (required): Privy App ID. Create a free app at privy.io and paste it.
- `NEXT_PUBLIC_PROXY_ADDRESS` (required): the deployed HatPet UUPS proxy address.
- `NEXT_PUBLIC_CHAIN_ID` (optional): `8453` (Base mainnet, default) or `84532` (Base Sepolia).
- `NEXT_PUBLIC_PRIVATE_RPC_URL` (optional): private relay for `eth_sendRawTransaction`. Defaults to Flashbots Protect on Base.
- `NEXT_PUBLIC_PUBLIC_RPC_URL` (optional): public RPC for reads. Defaults to `https://mainnet.base.org`. Swap in a paid Alchemy/QuickNode endpoint for production.

## Security: about the private RPC

The claim transaction is submitted via `NEXT_PUBLIC_PRIVATE_RPC_URL` (Flashbots Protect by default). This matters because:

1. Hat claims are first-tap-wins. If the signed tx hit the public mempool, an MEV bot could observe the calldata, decode the `token` arg, and front-run a copy from its own wallet.
2. By routing only `eth_sendRawTransaction` through a private relay, the signed tx skips the public mempool entirely and goes to a builder for direct inclusion.
3. All reads still go through the public RPC, so the read path stays cheap and observable.

Caveats:

- If the configured private RPC is offline, claims will fail until the user (or you) point at a working relay or fall back to a public one.
- Flashbots Protect on Base routes through their builder. If you want a different MEV protection (blink RPC, mev-share, Merkle, your own private node), just override `NEXT_PUBLIC_PRIVATE_RPC_URL`.
- The private RPC sees the signed tx contents. Pick a relay you trust.

## Page map

- `/` Landing page. Explains the drop and tells stray visitors they need a hat-tap URL.
- `/c/<token>` The claim page. Reads contract state, handles the four states (invalid, already claimed, not yet open, closed), and shows the claim UI + sprite preview on success.

## File map

```
app/
  layout.tsx        Root layout + global CSS
  globals.css       Tailwind + pixel-rendering rule
  page.tsx          Landing page
  providers.tsx     Privy + Wagmi + React Query providers
  c/[token]/
    page.tsx        Claim page with all four state branches
lib/
  contract.ts       HatPet ABI + proxy address + getWalletClient (private RPC)
  wagmi.ts          wagmi config + active chain resolver
  privateRpc.ts     Private + public viem transports
  decode-tokenURI.ts  Helper that parses on-chain base64 JSON metadata
```

## Production checklist

- [ ] Replace the public RPC with a paid endpoint (rate limits will bite you on launch day).
- [ ] Decide whether Flashbots Protect on Base meets your latency / reliability needs.
- [ ] Set the Privy app's allowed origins to your production domain.
- [ ] Verify the contract is funded for gas reimbursement if you're sponsoring claims (current code does not sponsor; user pays gas).
- [ ] Confirm `claimStart` / `claimEnd` on the contract match your launch plan.
