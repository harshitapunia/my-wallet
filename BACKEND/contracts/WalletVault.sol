// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract WalletVault {
    address public immutable owner;

    event Deposit(address indexed from, uint256 amount);
    event TransferExecuted(address indexed to, uint256 amount, bytes32 transferRef);

    error NotOwner();
    error InvalidRecipient();
    error InvalidAmount();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function transferETH(address payable to, uint256 amount, bytes32 transferRef) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();

        (bool sent, ) = to.call{value: amount}("");
        require(sent, "Transfer failed");

        emit TransferExecuted(to, amount, transferRef);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
