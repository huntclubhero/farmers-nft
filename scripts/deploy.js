// Deploy HatPet behind a UUPS proxy on Base (or Base Sepolia for dryrun).
// Run:
//   npx hardhat run scripts/deploy.js --network baseSepolia
//   npx hardhat run scripts/deploy.js --network base

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const name = process.env.NFT_NAME || "Hat Pets";
  const symbol = process.env.NFT_SYMBOL || "HATPET";

  // Claim window defaults to a 24-hour window starting 1 hour after deploy.
  const now = Math.floor(Date.now() / 1000);
  const start = Number(process.env.CLAIM_START || now + 3600);
  const end = Number(process.env.CLAIM_END || start + 86400);

  console.log(`Deploying HatPet (UUPS) on ${hre.network.name}`);
  console.log(`  drop: 200 hat-gated mints (produce economy theme)`);
  console.log(`  name: ${name}  symbol: ${symbol}`);
  console.log(`  claim window: ${new Date(start * 1000).toISOString()} -> ${new Date(end * 1000).toISOString()}`);

  const factory = await hre.ethers.getContractFactory("HatPet");
  const proxy = await hre.upgrades.deployProxy(factory, [name, symbol, start, end], {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  const implAddr = await hre.upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log(`Proxy:          ${proxyAddr}`);
  console.log(`Implementation: ${implAddr}`);

  fs.writeFileSync(
    path.resolve(__dirname, "..", "deployed.json"),
    JSON.stringify(
      { network: hre.network.name, proxy: proxyAddr, implementation: implAddr, claimStart: start, claimEnd: end },
      null,
      2,
    ),
  );
  console.log("Wrote deployed.json");
  console.log("");
  console.log("Use the PROXY address everywhere (OpenSea, claim site, upload-art.js).");
  console.log("");
  console.log("Next steps: pnpm gen:sprites && pnpm gen:tokens && pnpm upload:base");
}

main().catch(e => { console.error(e); process.exit(1); });
