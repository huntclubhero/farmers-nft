// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IHatPet {
    function claim(bytes32 token) external;
}

/// @notice Test helper. On receiving an ERC721 (the first mint), this contract
/// re-enters HatPet.claim with the same token. If the contract is CEI-safe,
/// the re-entry must revert with AlreadyClaimed, which bubbles up and reverts
/// the outer call as well. We expose two modes:
///   reentryMode = 0: do nothing on receive (baseline, claim succeeds).
///   reentryMode = 1: re-enter claim(sameToken). Expected to revert.
contract MaliciousReceiver is IERC721Receiver {
    IHatPet public immutable hat;
    bytes32 public storedToken;
    uint8 public reentryMode;
    uint256 public receivedCount;

    constructor(address hatAddr) {
        hat = IHatPet(hatAddr);
    }

    function setMode(uint8 m, bytes32 token) external {
        reentryMode = m;
        storedToken = token;
    }

    /// @notice Calls claim from this contract. Used to kick off the attack.
    function attack(bytes32 token) external {
        storedToken = token;
        hat.claim(token);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        override
        returns (bytes4)
    {
        receivedCount += 1;
        if (reentryMode == 1) {
            // Attempt to re-enter and claim the same token a second time.
            // CEI ordering should cause this to revert (AlreadyClaimed).
            hat.claim(storedToken);
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
