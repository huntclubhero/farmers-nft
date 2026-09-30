// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SSTORE2} from "solady/src/utils/SSTORE2.sol";

/// @notice Hat-gated, fully on-chain animated tamagotchi NFT.
/// One claim per hat (keyed by keccak256(claimToken)), wallet-agnostic.
/// UUPS upgradeable so future versions can extend behavior.
contract HatPet is Initializable, ERC721Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    // === Storage (DO NOT REORDER ON UPGRADE) ===

    uint64 public claimStart;
    uint64 public claimEnd;
    uint256 public nextTokenId;
    string private _description;

    /// keccak256(claimToken) => spriteId + 1. Zero means ineligible.
    mapping(bytes32 => uint16) public tokenSprite;
    /// keccak256(claimToken) => has been claimed. Cleared never. One-shot per hat.
    mapping(bytes32 => bool) public claimedHash;
    /// minted tokenId => spriteId (resolved at mint, immutable thereafter)
    mapping(uint256 => uint16) public tokenIdToSprite;
    /// SSTORE2 pointers, ordered by spriteId. Each holds one GIF in contract bytecode.
    address[] public artPointers;

    /// Per-sprite OpenSea attributes JSON fragment (e.g. `[{"trait_type":"Archetype","value":"Hacker"},...]`).
    mapping(uint16 => string) public spriteAttributes;

    // Reserved slots for future state additions without storage collision.
    uint256[39] private __gap;

    event Claimed(bytes32 indexed tokenHash, address indexed to, uint256 tokenId, uint16 spriteId);
    event SpriteUploaded(uint256 indexed spriteId, address pointer, uint256 size);

    error ClaimNotOpen();
    error AlreadyClaimed();
    error NotEligible();
    error LengthMismatch();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string memory n, string memory s, uint64 start, uint64 end) public initializer {
        __ERC721_init(n, s);
        __Ownable_init(msg.sender);
        claimStart = start;
        claimEnd = end;
        nextTokenId = 1;
        _description = "Fully on-chain animated tamagotchi. Hat-gated claim drop on Base.";
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // === Claim ===

    function claim(bytes32 token) external {
        if (block.timestamp < claimStart || block.timestamp > claimEnd) revert ClaimNotOpen();
        bytes32 h = keccak256(abi.encodePacked(token));
        uint16 sp = tokenSprite[h];
        if (sp == 0) revert NotEligible();
        if (claimedHash[h]) revert AlreadyClaimed();

        // Checks-Effects-Interactions: mark consumed BEFORE the mint callback.
        claimedHash[h] = true;
        uint256 id = nextTokenId++;
        tokenIdToSprite[id] = sp - 1;

        _safeMint(msg.sender, id);
        emit Claimed(h, msg.sender, id, sp - 1);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        uint16 spriteId = tokenIdToSprite[id];
        bytes memory gif = SSTORE2.read(artPointers[spriteId]);
        string memory image = string(abi.encodePacked("data:image/gif;base64,", Base64.encode(gif)));
        string memory attrs = spriteAttributes[spriteId];
        if (bytes(attrs).length == 0) {
            attrs = "[]";
        }
        bytes memory json = abi.encodePacked(
            '{"name":"', name(), ' #', Strings.toString(id),
            '","description":"', _description,
            '","image":"', image,
            '","attributes":', attrs, '}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    // === Owner setup ===

    function seedTokens(bytes32[] calldata hashes, uint16[] calldata spriteIds) external onlyOwner {
        if (hashes.length != spriteIds.length) revert LengthMismatch();
        for (uint256 i = 0; i < hashes.length; i++) {
            tokenSprite[hashes[i]] = spriteIds[i] + 1;
        }
    }

    function seedSpriteAttributes(uint16[] calldata spriteIds, string[] calldata attributesJson) external onlyOwner {
        if (spriteIds.length != attributesJson.length) revert LengthMismatch();
        for (uint256 i = 0; i < spriteIds.length; i++) {
            spriteAttributes[spriteIds[i]] = attributesJson[i];
        }
    }

    function uploadSprite(bytes calldata data) external onlyOwner returns (uint256 spriteId) {
        address ptr = SSTORE2.write(data);
        spriteId = artPointers.length;
        artPointers.push(ptr);
        emit SpriteUploaded(spriteId, ptr, data.length);
    }

    function spriteCount() external view returns (uint256) {
        return artPointers.length;
    }

    function setWindow(uint64 s, uint64 e) external onlyOwner {
        claimStart = s;
        claimEnd = e;
    }

    function setDescription(string calldata d) external onlyOwner {
        _description = d;
    }
}
