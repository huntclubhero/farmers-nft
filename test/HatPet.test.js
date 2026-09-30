// SPDX-License-Identifier: MIT
//
// HatPet test suite.
//
// Covers initialization, owner setup, claim happy path, claim security
// (double-claim, transfer-then-reclaim, wrong token, sprite collision,
// re-entry), tokenURI rendering (with on-chain base64 decode), window
// controls, and UUPS upgrade behavior.
//
// Style notes (project rule):
//   No em dashes anywhere. Use colons, pipes, parens, or restructure.

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// A real 1x1 transparent GIF (43 bytes). Valid for image/gif rendering.
const TINY_GIF_HEX =
  "0x47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b";

// Helper: keccak256 of a bytes32 token value, matching the contract's
// `keccak256(abi.encodePacked(token))` for a single bytes32 arg.
function hashToken(token) {
  return ethers.keccak256(token);
}

// Helper: build a deterministic bytes32 token from a string label.
function tokenFromLabel(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

// Helper: parse a tokenURI data URI of the form
// data:application/json;base64,<payload> into a JS object.
function parseDataUriJson(uri) {
  const prefix = "data:application/json;base64,";
  expect(uri.startsWith(prefix)).to.equal(true, "tokenURI prefix wrong");
  const b64 = uri.slice(prefix.length);
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonStr);
}

async function deployFixture() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const HatPet = await ethers.getContractFactory("HatPet");
  const now = await time.latest();
  const claimStart = BigInt(now) - 60n;
  const claimEnd = BigInt(now) + 3600n;
  const proxy = await upgrades.deployProxy(
    HatPet,
    ["HatPet", "HAT", claimStart, claimEnd],
    { kind: "uups", initializer: "initialize" }
  );
  await proxy.waitForDeployment();
  return { proxy, owner, alice, bob, carol, claimStart, claimEnd, HatPet };
}

describe("HatPet", function () {
  describe("Initialization", function () {
    it("initializes with the given name, symbol, window, and owner", async function () {
      const { proxy, owner, claimStart, claimEnd } = await deployFixture();
      expect(await proxy.name()).to.equal("HatPet");
      expect(await proxy.symbol()).to.equal("HAT");
      expect(await proxy.claimStart()).to.equal(claimStart);
      expect(await proxy.claimEnd()).to.equal(claimEnd);
      expect(await proxy.owner()).to.equal(owner.address);
    });

    it("starts nextTokenId at 1", async function () {
      const { proxy } = await deployFixture();
      expect(await proxy.nextTokenId()).to.equal(1n);
    });

    it("reverts when initialize is called directly on the implementation", async function () {
      const { proxy } = await deployFixture();
      const implAddr = await upgrades.erc1967.getImplementationAddress(
        await proxy.getAddress()
      );
      const impl = await ethers.getContractAt("HatPet", implAddr);
      await expect(
        impl.initialize("X", "X", 0, 1)
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("reverts when initialize is called a second time on the proxy", async function () {
      const { proxy } = await deployFixture();
      await expect(
        proxy.initialize("Y", "Y", 0, 1)
      ).to.be.revertedWithCustomError(proxy, "InvalidInitialization");
    });
  });

  describe("Owner setup", function () {
    it("rejects non-owner seedTokens", async function () {
      const { proxy, alice } = await deployFixture();
      await expect(
        proxy.connect(alice).seedTokens([hashToken(tokenFromLabel("a"))], [0])
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });

    it("rejects non-owner seedSpriteAttributes", async function () {
      const { proxy, alice } = await deployFixture();
      await expect(
        proxy.connect(alice).seedSpriteAttributes([0], ["[]"])
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });

    it("rejects non-owner uploadSprite", async function () {
      const { proxy, alice } = await deployFixture();
      await expect(
        proxy.connect(alice).uploadSprite(TINY_GIF_HEX)
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });

    it("rejects non-owner setWindow", async function () {
      const { proxy, alice } = await deployFixture();
      await expect(
        proxy.connect(alice).setWindow(0, 1)
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });

    it("rejects non-owner setDescription", async function () {
      const { proxy, alice } = await deployFixture();
      await expect(
        proxy.connect(alice).setDescription("nope")
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });

    it("reverts seedTokens with LengthMismatch when arrays differ", async function () {
      const { proxy } = await deployFixture();
      await expect(
        proxy.seedTokens(
          [hashToken(tokenFromLabel("a")), hashToken(tokenFromLabel("b"))],
          [0]
        )
      ).to.be.revertedWithCustomError(proxy, "LengthMismatch");
    });

    it("reverts seedSpriteAttributes with LengthMismatch when arrays differ", async function () {
      const { proxy } = await deployFixture();
      await expect(
        proxy.seedSpriteAttributes([0, 1], ["[]"])
      ).to.be.revertedWithCustomError(proxy, "LengthMismatch");
    });

    it("uploadSprite increments spriteCount and emits SpriteUploaded", async function () {
      const { proxy } = await deployFixture();
      expect(await proxy.spriteCount()).to.equal(0n);
      const tx = await proxy.uploadSprite(TINY_GIF_HEX);
      const receipt = await tx.wait();

      // Find the SpriteUploaded event.
      const ev = receipt.logs
        .map((l) => {
          try {
            return proxy.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "SpriteUploaded");
      expect(ev, "SpriteUploaded not emitted").to.not.equal(undefined);
      expect(ev.args.spriteId).to.equal(0n);
      // Size is the raw GIF byte length (TINY_GIF_HEX minus 0x, divided by 2).
      const expectedSize = (TINY_GIF_HEX.length - 2) / 2;
      expect(ev.args.size).to.equal(BigInt(expectedSize));
      expect(ev.args.pointer).to.properAddress;

      expect(await proxy.spriteCount()).to.equal(1n);

      // Upload again, spriteId should be 1.
      await expect(proxy.uploadSprite(TINY_GIF_HEX))
        .to.emit(proxy, "SpriteUploaded")
        .withArgs(1n, anyValue, BigInt(expectedSize));
      expect(await proxy.spriteCount()).to.equal(2n);
    });

    it("seedTokens writes mapping with spriteId+1 offset (sprite 0 reads as 1)", async function () {
      const { proxy } = await deployFixture();
      const t = tokenFromLabel("hat-A");
      const h = hashToken(t);
      await proxy.seedTokens([h], [0]);
      // Stored value is spriteId + 1 = 1.
      expect(await proxy.tokenSprite(h)).to.equal(1);

      const t2 = tokenFromLabel("hat-B");
      const h2 = hashToken(t2);
      await proxy.seedTokens([h2], [7]);
      expect(await proxy.tokenSprite(h2)).to.equal(8);
    });
  });

  describe("Claim happy path", function () {
    it("mints token id 1 to caller for an eligible hat", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      await proxy.seedTokens([hashToken(t)], [0]);

      await proxy.connect(alice).claim(t);
      expect(await proxy.ownerOf(1)).to.equal(alice.address);
      expect(await proxy.nextTokenId()).to.equal(2n);
    });

    it("flips claimedHash[h] to true after claim", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      const h = hashToken(t);
      await proxy.seedTokens([h], [0]);
      expect(await proxy.claimedHash(h)).to.equal(false);
      await proxy.connect(alice).claim(t);
      expect(await proxy.claimedHash(h)).to.equal(true);
    });

    it("sets tokenIdToSprite[1] to the seeded spriteId", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      await proxy.seedTokens([hashToken(t)], [1]);
      await proxy.connect(alice).claim(t);
      expect(await proxy.tokenIdToSprite(1)).to.equal(1);
    });

    it("emits Claimed with (tokenHash, to, tokenId, spriteId)", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      const h = hashToken(t);
      await proxy.seedTokens([h], [0]);
      await expect(proxy.connect(alice).claim(t))
        .to.emit(proxy, "Claimed")
        .withArgs(h, alice.address, 1n, 0);
    });

    it("ownerOf(1) equals caller after claim", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      expect(await proxy.ownerOf(1)).to.equal(alice.address);
    });

    it("reverts ClaimNotOpen before claimStart", async function () {
      const [owner, alice] = await ethers.getSigners();
      const HatPet = await ethers.getContractFactory("HatPet");
      const now = await time.latest();
      const start = BigInt(now) + 3600n;
      const end = BigInt(now) + 7200n;
      const proxy = await upgrades.deployProxy(
        HatPet,
        ["HatPet", "HAT", start, end],
        { kind: "uups", initializer: "initialize" }
      );
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      await proxy.seedTokens([hashToken(t)], [0]);
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "ClaimNotOpen");
    });

    it("reverts ClaimNotOpen after claimEnd", async function () {
      const { proxy, alice, claimEnd } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-1");
      await proxy.seedTokens([hashToken(t)], [0]);
      await time.increaseTo(Number(claimEnd) + 10);
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "ClaimNotOpen");
    });
  });

  describe("Claim security", function () {
    it("same token cannot be claimed twice from same wallet", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-X");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "AlreadyClaimed");
    });

    it("transferring NFT to Bob does not let Alice re-claim same token", async function () {
      const { proxy, alice, bob } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-X");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      // Alice transfers the NFT to Bob.
      await proxy
        .connect(alice)
        ["safeTransferFrom(address,address,uint256)"](
          alice.address,
          bob.address,
          1
        );
      expect(await proxy.ownerOf(1)).to.equal(bob.address);
      // Alice tries to claim the same hat again. Must revert.
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "AlreadyClaimed");
    });

    it("never-seeded token reverts with NotEligible", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("ghost-hat");
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "NotEligible");
    });

    it("token whose HASH is seeded but raw value is wrong reverts NotEligible", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const realToken = tokenFromLabel("real-hat");
      const realHash = hashToken(realToken);
      await proxy.seedTokens([realHash], [0]);

      // Try to claim by passing the HASH itself as the token. The contract
      // hashes the input again, so this must not match.
      await expect(
        proxy.connect(alice).claim(realHash)
      ).to.be.revertedWithCustomError(proxy, "NotEligible");

      // But the real token still works.
      await expect(proxy.connect(alice).claim(realToken)).to.emit(
        proxy,
        "Claimed"
      );
    });

    it("two different tokens mapped to the same spriteId both mint distinct tokenIds", async function () {
      const { proxy, alice, bob } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const tA = tokenFromLabel("hat-A");
      const tB = tokenFromLabel("hat-B");
      await proxy.seedTokens([hashToken(tA), hashToken(tB)], [0, 0]);
      await proxy.connect(alice).claim(tA);
      await proxy.connect(bob).claim(tB);
      expect(await proxy.ownerOf(1)).to.equal(alice.address);
      expect(await proxy.ownerOf(2)).to.equal(bob.address);
      expect(await proxy.tokenIdToSprite(1)).to.equal(0);
      expect(await proxy.tokenIdToSprite(2)).to.equal(0);
      expect(await proxy.nextTokenId()).to.equal(3n);
    });

    it("re-entry via malicious ERC721Receiver cannot mint a second token", async function () {
      const { proxy } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-reentry");
      await proxy.seedTokens([hashToken(t)], [0]);

      // Deploy receiver pointing at the proxy.
      const Mal = await ethers.getContractFactory("MaliciousReceiver");
      const mal = await Mal.deploy(await proxy.getAddress());
      await mal.waitForDeployment();
      await mal.setMode(1, t); // re-entry mode

      // The outer call (attack -> claim -> _safeMint -> onERC721Received -> claim)
      // must revert. The inner re-entry will hit AlreadyClaimed because the
      // contract sets claimedHash[h] = true BEFORE _safeMint (CEI). That revert
      // bubbles up through _safeMint and reverts the whole outer call.
      await expect(mal.attack(t)).to.be.revertedWithCustomError(
        proxy,
        "AlreadyClaimed"
      );

      // No token should have been minted. nextTokenId stays at 1.
      expect(await proxy.nextTokenId()).to.equal(1n);
      // claimedHash should be back to false because the outer tx reverted.
      expect(await proxy.claimedHash(hashToken(t))).to.equal(false);
    });

    it("baseline: receiver with no re-entry CAN still receive a mint", async function () {
      // Sanity: confirms the receiver harness isn't broken in a way that
      // makes the re-entry test trivially pass.
      const { proxy } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-passive");
      await proxy.seedTokens([hashToken(t)], [0]);

      const Mal = await ethers.getContractFactory("MaliciousReceiver");
      const mal = await Mal.deploy(await proxy.getAddress());
      await mal.waitForDeployment();
      await mal.setMode(0, t); // passive

      await mal.attack(t);
      expect(await proxy.ownerOf(1)).to.equal(await mal.getAddress());
      expect(await proxy.claimedHash(hashToken(t))).to.equal(true);
    });
  });

  describe("tokenURI rendering", function () {
    it("returns a data:application/json;base64 URI after upload + claim", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-uri-1");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      const uri = await proxy.tokenURI(1);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
    });

    it("encoded JSON has name, description, image, attributes fields", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-uri-2");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      const uri = await proxy.tokenURI(1);
      const meta = parseDataUriJson(uri);
      expect(meta.name).to.equal("HatPet #1");
      expect(typeof meta.description).to.equal("string");
      expect(meta.description.length).to.be.greaterThan(0);
      expect(meta.image.startsWith("data:image/gif;base64,")).to.equal(true);
      expect(Array.isArray(meta.attributes)).to.equal(true);
    });

    it("attributes default to empty array when sprite has no attrs seeded", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-empty-attrs");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      const meta = parseDataUriJson(await proxy.tokenURI(1));
      expect(meta.attributes).to.deep.equal([]);
    });

    it("attributes reflect seedSpriteAttributes JSON fragment", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-attrs");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.seedSpriteAttributes(
        [0],
        ['[{"trait_type":"Archetype","value":"Hacker"}]']
      );
      await proxy.connect(alice).claim(t);
      const meta = parseDataUriJson(await proxy.tokenURI(1));
      expect(meta.attributes).to.deep.equal([
        { trait_type: "Archetype", value: "Hacker" },
      ]);
    });

    it("tokenURI of a non-existent token reverts", async function () {
      const { proxy } = await deployFixture();
      await expect(proxy.tokenURI(999)).to.be.revertedWithCustomError(
        proxy,
        "ERC721NonexistentToken"
      );
    });

    it("image payload decodes back to the uploaded GIF bytes", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-image");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      const meta = parseDataUriJson(await proxy.tokenURI(1));
      const gifPrefix = "data:image/gif;base64,";
      expect(meta.image.startsWith(gifPrefix)).to.equal(true);
      const gifBytes = Buffer.from(
        meta.image.slice(gifPrefix.length),
        "base64"
      );
      const expected = Buffer.from(TINY_GIF_HEX.slice(2), "hex");
      expect(gifBytes.equals(expected)).to.equal(true);
    });
  });

  describe("Window controls", function () {
    it("setWindow updates the window and lets a fresh claim succeed", async function () {
      // Deploy with a CLOSED window (end before start of test).
      const [owner, alice] = await ethers.getSigners();
      const HatPet = await ethers.getContractFactory("HatPet");
      const now = await time.latest();
      const proxy = await upgrades.deployProxy(
        HatPet,
        ["HatPet", "HAT", BigInt(now) + 10000n, BigInt(now) + 20000n],
        { kind: "uups", initializer: "initialize" }
      );
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-window");
      await proxy.seedTokens([hashToken(t)], [0]);

      // Before setWindow, it's closed.
      await expect(
        proxy.connect(alice).claim(t)
      ).to.be.revertedWithCustomError(proxy, "ClaimNotOpen");

      // Open it.
      const now2 = await time.latest();
      await proxy.setWindow(BigInt(now2) - 10n, BigInt(now2) + 3600n);
      await expect(proxy.connect(alice).claim(t)).to.emit(proxy, "Claimed");
    });

    it("setDescription updates the description visible in next tokenURI", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-desc");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.connect(alice).claim(t);
      const newDesc = "A brand new description for the pet.";
      await proxy.setDescription(newDesc);
      const meta = parseDataUriJson(await proxy.tokenURI(1));
      expect(meta.description).to.equal(newDesc);
    });
  });

  describe("UUPS upgrade", function () {
    it("owner can upgrade to HatPetV2 and the new function is callable", async function () {
      const { proxy } = await deployFixture();
      const V2 = await ethers.getContractFactory("HatPetV2");
      const upgraded = await upgrades.upgradeProxy(
        await proxy.getAddress(),
        V2
      );
      expect(await upgraded.version()).to.equal("v2");
    });

    it("state (claimedHash, tokenIdToSprite, spriteAttributes, artPointers) is preserved across upgrade", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-upgrade");
      const h = hashToken(t);
      await proxy.seedTokens([h], [0]);
      await proxy.seedSpriteAttributes(
        [0],
        ['[{"trait_type":"Era","value":"Pre"}]']
      );
      await proxy.connect(alice).claim(t);

      const preSpriteCount = await proxy.spriteCount();
      const preClaimed = await proxy.claimedHash(h);
      const preTokenSprite = await proxy.tokenIdToSprite(1);
      const preAttrs = await proxy.spriteAttributes(0);

      const V2 = await ethers.getContractFactory("HatPetV2");
      const upgraded = await upgrades.upgradeProxy(
        await proxy.getAddress(),
        V2
      );

      expect(await upgraded.spriteCount()).to.equal(preSpriteCount);
      expect(await upgraded.claimedHash(h)).to.equal(preClaimed);
      expect(await upgraded.tokenIdToSprite(1)).to.equal(preTokenSprite);
      expect(await upgraded.spriteAttributes(0)).to.equal(preAttrs);
      expect(await upgraded.ownerOf(1)).to.equal(alice.address);
    });

    it("NFT minted pre-upgrade still renders via tokenURI after upgrade", async function () {
      const { proxy, alice } = await deployFixture();
      await proxy.uploadSprite(TINY_GIF_HEX);
      const t = tokenFromLabel("hat-upgrade-uri");
      await proxy.seedTokens([hashToken(t)], [0]);
      await proxy.seedSpriteAttributes(
        [0],
        ['[{"trait_type":"Persist","value":"Yes"}]']
      );
      await proxy.connect(alice).claim(t);
      const preUri = await proxy.tokenURI(1);

      const V2 = await ethers.getContractFactory("HatPetV2");
      const upgraded = await upgrades.upgradeProxy(
        await proxy.getAddress(),
        V2
      );

      const postUri = await upgraded.tokenURI(1);
      expect(postUri).to.equal(preUri);
      const meta = parseDataUriJson(postUri);
      expect(meta.name).to.equal("HatPet #1");
      expect(meta.attributes).to.deep.equal([
        { trait_type: "Persist", value: "Yes" },
      ]);
    });

    it("non-owner cannot upgrade", async function () {
      const { proxy, alice } = await deployFixture();
      const V2 = await ethers.getContractFactory("HatPetV2", alice);
      // upgradeProxy uses the signer attached to the factory. With alice as
      // signer, _authorizeUpgrade (onlyOwner) should reject.
      await expect(
        upgrades.upgradeProxy(await proxy.getAddress(), V2)
      ).to.be.revertedWithCustomError(proxy, "OwnableUnauthorizedAccount");
    });
  });
});

