# Farmers (hat-nft)

Fully on-chain animated tamagotchi NFT for NFC-hat tappers. 200 unique generative sprites, built for Base (not yet deployed), claim via unguessable per-hat URL.

> Public snapshot of a private working repo, without its history. All rights reserved.

## How the pieces fit

```
NFC hat URL -> claim site -> wallet calls claim(token) -> contract checks keccak256(token)
                                                       -> mints NFT with assigned sprite
                                                       -> tokenURI returns inline on-chain art
```

The contract is UUPS upgradeable. The **proxy address** is the canonical address users, marketplaces, and explorers interact with. The implementation address can change across upgrades; the proxy never does.

## Theme and rarity

Theme is a produce economy. Every sprite is a character or sentient produce participating in growing, moving, or hacking the supply chain. Farmable produce only (no proteins, no processed goods).

Archetype split across the 200 sprites:

| archetype | count | role |
|-----------|-------|------|
| Farmer | 60 | tends the land, wears or holds the produce they grow |
| Trader | 60 | moves produce between markets, scales and sacks |
| Hacker | 40 | optimizes the supply chain, terminal-adjacent, glitchy on rare variants |
| Fruit  | 20 | sentient anthropomorphic fruit (the pet IS the fruit) |
| Veg    | 20 | sentient anthropomorphic vegetable (the pet IS the vegetable) |

Produce tier weights (applied within each archetype): Staple 60%, Garden 30%, Specialty 10%.

Aura tier weights: None 70%, Shimmer 20%, Glitch 8%, Legendary 2%.

Canonical taxonomy (archetypes, produce list, hats, backgrounds, auras, weights, attribute shape) lives in [`traits.json`](./traits.json). Every script and contract seeding step reads from that file. Edit there, not in code.

## Setup

```bash
pnpm install            # or npm install
cp .env.example .env    # fill in PRIVATE_KEY, BASESCAN_API_KEY
pip install pillow
```

## Run the pipeline

```bash
# 1. Generate 200 sprites + per-sprite metadata + attributes
pnpm gen:sprites
# writes out/sprites/*.gif, out/metadata.json, out/attributes.json
# drop real art into ./layers/<trait>/<variant>.png to replace placeholders

# 2. Generate 200 claim tokens + URLs
#    set CLAIM_BASE_URL and optionally UID_FILE first
CLAIM_BASE_URL=https://your-claim-site.app/c pnpm gen:tokens
# out/tokens.json is SECRET. out/urls.txt is what gets distributed to tappers.

# 3. Deploy on Base Sepolia first, then Base mainnet
pnpm compile
pnpm deploy:testnet     # then run upload:testnet, claim a few, eyeball OpenSea testnet
pnpm deploy:base
pnpm upload:base
```

`upload-art.js` runs three phases against the proxy, all idempotent (safe to re-run after a partial failure):

1. **Art upload** | each sprite is written as one SSTORE2 pointer contract and registered on the proxy.
2. **Eligibility seeding** | each `keccak256(claimToken)` row from `out/seed.json` is written to the eligibility map.
3. **Attributes seeding** | per-sprite OpenSea attributes from `out/attributes.json` are written on-chain via the `seedSpriteAttributes` method.

Re-running any phase skips rows that are already on-chain.

## Cost estimate (Base mainnet, 200 sprites, ~15KB each)

| step | gas | USD (ETH @ $3000, gas 0.05 gwei) |
|------|-----|----------------------------------|
| deploy proxy + implementation | ~4M | ~$0.60 |
| upload 200 sprites (~15KB each) | ~600M | ~$45 |
| seed 200 eligibility rows | ~6M | ~$0.50 |
| seed 200 sprite attributes | ~10M | ~$0.80 |
| user claim | ~120k | ~$0.02 |

## Security model

- Eligibility key is `keccak256(claimToken)`. Raw tokens are never on-chain.
- Tokens are 32 random bytes, embedded only in each hat's NFC URL.
- **One mint per hat, period.** The hash is consumed at first claim, so transferring the NFT to another wallet and re-claiming with the same token reverts.
- CEI pattern in `claim`: state is updated before `_safeMint`, so a malicious `onERC721Received` cannot re-enter to mint twice.
- UUPS upgradeable. Owner controls upgrades. State layout includes a storage gap for future fields. Users always interact with the proxy address.
- `seedSpriteAttributes` is **owner-only**. Per-sprite OpenSea traits (Archetype, Produce, Hat, Background, Aura) are written on-chain by phase 3 of `upload-art.js`. Attributes show up on OpenSea once that phase has run. Until phase 3 completes for a given sprite, `tokenURI` still returns valid art but with empty attributes.
- Sprite art is fully on-chain via SSTORE2. No IPFS, no off-chain hosting, no CDN dependency.

### Only remaining attack: mempool front-run

If a hat owner submits `claim(token)` to a public RPC, a bot watching the mempool could copy `token` and resubmit with higher gas to steal that hat's NFT. Three options:

1. **Private RPC** (cheapest, recommended): frontend submits via Flashbots Protect, Coinbase Cloud private mempool, or any Base bundle endpoint. Tx never enters the public pool. No contract change.
2. **Commit-reveal**: add a `commit(keccak256(token, salt, msg.sender))` step, then `reveal(token, salt)`. Front-runner can't copy the binding. Adds one extra tx per claim.
3. **Server-signed binding**: backend signs `(token, wallet, deadline)`. Adds operational dependency. Cleanest UX, least decentralized.

Recommendation: ship with private RPC submission in the frontend (Flashbots Protect or Coinbase Cloud bundle endpoint). If front-running attempts are observed in the wild, ship commit-reveal as a V2 upgrade through the UUPS proxy.
