// Upload the 200 GIFs from out/sprite_*.gif into the contract via SSTORE2.
// Each upload is one tx. On Base this is ~$0.10 to $0.30 per GIF at typical gas.
//
// Then seeds eligibility from out/seed.json, and finally seeds per-sprite
// OpenSea attributes JSON from out/attributes-seed.json.
//
// Run:
//   npx hardhat run scripts/upload-art.js --network base

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..", "out");
const DEPLOYED = path.resolve(__dirname, "..", "deployed.json");

const EXPECTED_SUPPLY = 200;

async function main() {
  if (!fs.existsSync(DEPLOYED)) throw new Error("deployed.json missing. Run scripts/deploy.js first.");
  const { proxy } = JSON.parse(fs.readFileSync(DEPLOYED, "utf8"));
  const c = await hre.ethers.getContractAt("HatPet", proxy);
  console.log(`HatPet (proxy) @ ${proxy}`);

  const meta = JSON.parse(fs.readFileSync(path.join(OUT, "metadata.json"), "utf8"));
  if (meta.length !== EXPECTED_SUPPLY) {
    console.warn(`metadata.json contains ${meta.length} sprites; expected ${EXPECTED_SUPPLY} for the 200 hat drop.`);
  }

  // Phase 1: upload sprite GIFs via SSTORE2. Idempotent: resumes from spriteCount().
  const already = Number(await c.spriteCount());
  console.log(`Phase 1 (art upload): already uploaded ${already}/${meta.length}`);
  if (already >= meta.length) {
    console.log("  all sprites already on-chain. Skipping upload phase.");
  } else {
    for (let i = already; i < meta.length; i++) {
      const filePath = path.join(OUT, meta[i].file);
      const data = fs.readFileSync(filePath);
      if (data.length > 24000) {
        throw new Error(`sprite_${i} is ${data.length} bytes; SSTORE2 max is 24576. Re-encode smaller.`);
      }
      process.stdout.write(`  uploading sprite ${i} (${data.length}B)... `);
      const tx = await c.uploadSprite("0x" + data.toString("hex"));
      const receipt = await tx.wait();
      console.log(`block ${receipt.blockNumber} gas ${receipt.gasUsed.toString()}`);
    }
  }

  // Phase 2: seed eligibility hashes from out/seed.json.
  const seedPath = path.join(OUT, "seed.json");
  if (!fs.existsSync(seedPath)) {
    console.warn("Phase 2 (eligibility seed): seed.json missing. Skipping. Run scripts/generate-tokens.js first.");
  } else {
    const { hashes, spriteIds } = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    console.log(`Phase 2 (eligibility seed): ${hashes.length} rows`);
    const BATCH = 100;
    for (let i = 0; i < hashes.length; i += BATCH) {
      const h = hashes.slice(i, i + BATCH);
      const s = spriteIds.slice(i, i + BATCH);
      // Best-effort idempotency check: peek at the first hash in this batch.
      // If it is already mapped on-chain, skip the whole batch.
      let skipBatch = false;
      try {
        const existing = await c.tokenSprite(h[0]);
        if (Number(existing) !== 0 || (await c.tokenConsumed(h[0]))) {
          // tokenSprite returning a non-zero sprite OR a consumed flag means this batch was already seeded.
          // We accept a false negative on spriteId 0 since that batch will just re-write identical values (no-op).
          skipBatch = false;
        }
      } catch (_) {
        // Older contract without tokenSprite getter. Fall through and just send.
      }
      if (skipBatch) {
        console.log(`  batch ${i}..${i + h.length - 1} already seeded. Skipping.`);
        continue;
      }
      process.stdout.write(`  seeding ${i}..${i + h.length - 1}... `);
      const tx = await c.seedTokens(h, s);
      const receipt = await tx.wait();
      console.log(`block ${receipt.blockNumber} gas ${receipt.gasUsed.toString()}`);
    }
  }

  // Phase 3: seed per-sprite OpenSea attributes JSON from out/attributes-seed.json.
  const attrPath = path.join(OUT, "attributes-seed.json");
  if (!fs.existsSync(attrPath)) {
    console.warn("Phase 3 (attributes seed): attributes-seed.json missing. Skipping. Run scripts/generate-tokens.js first.");
  } else {
    const { spriteIds, attributesJson } = JSON.parse(fs.readFileSync(attrPath, "utf8"));
    if (!Array.isArray(spriteIds) || !Array.isArray(attributesJson) || spriteIds.length !== attributesJson.length) {
      throw new Error("attributes-seed.json malformed: expected { spriteIds: number[], attributesJson: string[] } with matching lengths.");
    }
    console.log(`Phase 3 (attributes seed): ${spriteIds.length} sprites`);
    // Strings are bigger than bytes32 hashes, so use smaller batches to keep tx size sane.
    const ATTR_BATCH = 25;
    for (let i = 0; i < spriteIds.length; i += ATTR_BATCH) {
      const sBatch = spriteIds.slice(i, i + ATTR_BATCH);
      const aBatch = attributesJson.slice(i, i + ATTR_BATCH);
      process.stdout.write(`  seeding attrs ${i}..${i + sBatch.length - 1}... `);
      const tx = await c.seedSpriteAttributes(sBatch, aBatch);
      const receipt = await tx.wait();
      console.log(`block ${receipt.blockNumber} gas ${receipt.gasUsed.toString()}`);
    }
  }

  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
