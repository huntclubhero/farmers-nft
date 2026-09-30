# GO

Everything is built, tested, and waiting. This file is the ordered launch sequence. Nothing here deploys until you run the commands.

## Pre-flight state (already done)

- [x] Contract `HatPet` (UUPS) compiles clean on Solidity 0.8.24 + cancun
- [x] 39 Hardhat tests pass (init, owner gates, claim happy path, every attack vector, tokenURI rendering, window controls, UUPS upgrade)
- [x] 200 sprites generated in `out/sprite_000.gif` ... `sprite_199.gif`
- [x] `out/metadata.json` + `out/attributes.json` (per-sprite traits + OpenSea attributes)
- [x] `out/tokens.json` + `out/seed.json` + `out/attributes-seed.json` + `out/urls.txt` (200 unguessable claim tokens + on-chain seeds + distribution URLs)
- [x] Claim site (`claim-site/`) builds clean: Next.js 15 + Privy + wagmi v2 + viem v2 + Tailwind, ready for `vercel deploy`
- [x] Private RPC routing defaults to Flashbots Protect so claims dodge public-mempool front-runs

## Before pressing GO: fill in 4 secrets

1. **`hat-nft/.env`**: set `PRIVATE_KEY` (deployer EOA, must have ETH on Base) and `BASESCAN_API_KEY` (etherscan v2 key for contract verification).
2. **Privy app**: create one at https://privy.io. Copy the App ID.
3. **`hat-nft/claim-site/.env.local`**: set `NEXT_PUBLIC_PRIVY_APP_ID`. Other vars get set after deploy in step 5.
4. **(Optional) UID list**: if you have the 200 real hat UIDs, save them as one-per-line in `uids.txt` and `export UID_FILE=uids.txt` before re-running step 4 of the sequence. Skipping this uses placeholder UIDs (still 200 valid claim tokens, just no UID provenance).

## Launch sequence

```bash
cd C:\Users\skadd\hat-nft

# 1. Sanity: contract + tests still green
npm test

# 2. Deploy to Base Sepolia (dryrun)
npx hardhat run scripts/deploy.js --network baseSepolia
# Writes deployed.json with proxy + implementation addresses.

# 3. Upload art, seed eligibility, seed attributes on Sepolia
npx hardhat run scripts/upload-art.js --network baseSepolia
# 200 sprite uploads + eligibility seed + attributes seed. ~10 min, idempotent.

# 4. Spot-check one claim on Sepolia
# Copy out/urls.txt line 1, paste into a browser running the claim site:
cd claim-site
echo "NEXT_PUBLIC_CHAIN_ID=84532" >> .env.local
echo "NEXT_PUBLIC_PROXY_ADDRESS=<paste proxy from deployed.json>" >> .env.local
npm run dev
# Open http://localhost:3000/c/<token-from-urls.txt>, claim, eyeball OpenSea testnet
# https://testnets.opensea.io/assets/base_sepolia/<proxy>/1
cd ..

# 5. Once Sepolia looks right, deploy to Base mainnet
mv deployed.json deployed.sepolia.json   # keep the testnet record
npx hardhat run scripts/deploy.js --network base
npx hardhat run scripts/upload-art.js --network base
# ~$50 in gas total at 0.05 gwei.

# 6. Wire mainnet proxy into the claim site
cd claim-site
# Edit .env.local:
#   NEXT_PUBLIC_CHAIN_ID=8453
#   NEXT_PUBLIC_PROXY_ADDRESS=<mainnet proxy>
#   NEXT_PUBLIC_PRIVY_APP_ID=<your Privy id>
npm run build       # final sanity build
vercel deploy --prod  # or: pnpm dlx vercel deploy --prod

# 7. Distribute
# out/urls.txt has 200 claim URLs in UID order. Send each to the corresponding
# hat owner over whatever side channel you use (DM, email, NFC redirect).
# out/tokens.json maps UID -> token -> URL -> spriteId. KEEP PRIVATE.
```

## Verify after each step

| step | how to verify |
|------|---------------|
| 2 | `cat deployed.json` shows proxy + implementation, both addresses on BaseScan |
| 3 | call `spriteCount()` returns 200, `tokenSprite(out/seed.json hash[0])` returns 1, `spriteAttributes(0)` returns a JSON fragment |
| 4 | claim succeeds, NFT renders on OpenSea testnet with correct sprite + traits |
| 5 | same as 2 + 3, but on Base mainnet |
| 6 | live URL responds, `/c/<token>` page loads and connects wallet |

## Stop conditions

- Any test red in step 1: do not proceed. Fix first.
- Sepolia claim does not render correctly in step 4: do not deploy to mainnet. Diagnose with the SSTORE2 read first (`tokenURI(1)` decoded).
- After mainnet deploy in step 5: if you spot a bug, you can `npx hardhat run scripts/upgrade.js --network base` with a `HatPetV2` patch. State (claimedHash, tokenIdToSprite, spriteAttributes, artPointers) is preserved across upgrades.

## Cost (Base mainnet, 0.05 gwei, ETH @ $3000)

| step | gas | USD |
|------|-----|-----|
| deploy proxy + impl | ~4M | ~$0.60 |
| upload 200 sprites | ~600M | ~$45 |
| seed eligibility (200) | ~6M | ~$0.50 |
| seed attributes (200) | ~10M | ~$0.80 |
| user claim | ~120k | ~$0.02 each |

Total deployer spend: roughly $47 plus a buffer.

## Files you must keep private

- `out/tokens.json` (UID + claim token + URL, anyone with this can claim every hat)
- `out/urls.txt` (200 unguessable URLs in plaintext)
- `hat-nft/.env` (deployer private key)
- `claim-site/.env.local` (Privy App ID is technically public-safe but treat it as private until launch)

`out/seed.json`, `out/attributes-seed.json`, `out/metadata.json`, `out/attributes.json`, and `out/sprite_*.gif` are safe to commit; they only contain hashes and public art.
