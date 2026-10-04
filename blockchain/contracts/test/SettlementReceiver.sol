// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Escrow} from "../Escrow.sol";

/// @dev Test-only actor: refuse ETH or attempt to reenter any escrow call.
contract SettlementReceiver {
    bool public rejectEther;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    address public target;
    bytes public payload;
    uint256 public attempts;

    function configure(bool reject, address target_, bytes calldata payload_) external {
        rejectEther = reject;
        target = target_;
        payload = payload_;
    }

    function execute(address destination, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = destination.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }

    receive() external payable {
        require(!rejectEther, "recipient rejects ETH");
        if (target != address(0)) {
            attempts++;
            bytes memory result;
            (reentrySucceeded, result) = target.call(payload);
            if (result.length >= 4) reentryError = bytes4(result);
        }
    }
}
