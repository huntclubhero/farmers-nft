// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HatPet} from "../HatPet.sol";

/// @notice Test-only V2 implementation used to verify UUPS upgrades preserve
/// storage and that owner-gated upgrade authorization works.
contract HatPetV2 is HatPet {
    function version() external pure returns (string memory) {
        return "v2";
    }
}
