// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One-payment ETH escrow. Identity verification is a demo admin attestation.
/// @dev No upgrade, admin withdrawal or off-chain quality judgment. Timeouts need a caller; funds never get stuck
///      behind one party: refunds and dispute timeouts are callable by anyone and only ever pay the order's parties.
contract Escrow is AccessControl, ReentrancyGuard {
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");
    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 100;
    // Fits decimal(38,0) if the subsequent SQL projection chooses that representation.
    uint256 public constant MAX_AMOUNT_WEI = 10 ** 38 - 1;
    uint256 public constant MAX_REVIEW_WINDOW = 365 days;
    // An absent Arbiter must not lock funds forever. A neutral split gives neither party a reason to stall.
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    uint256 public constant DISPUTE_TIMEOUT_SELLER_SHARE_BPS = 5_000;
    // Bounds what a recipient can burn inside a settlement; plain wallets need far less.
    uint256 public constant PAYOUT_GAS_LIMIT = 100_000;

    // Accepted and Cancelled sit last so the numeric values of the original states do not change.
    enum State { Created, Funded, Delivered, Completed, Disputed, Resolved, Refunded, Accepted, Cancelled }
    struct Order {
        address buyer;
        address seller;
        address arbiter;
        uint256 amountWei;
        uint256 feeBps;
        bytes32 clientReference;
        bytes32 termsHash;
        uint256 deliveryDeadline;
        uint256 reviewWindow;
        uint256 deliveredAt;
        uint256 reviewDeadline;
        bytes32 deliveryHash;
        State state;
        uint256 disputedAt;
    }

    address public immutable platformWallet;
    uint256 public nextOrderId = 1;
    uint256 public totalLockedWei;
    uint256 public totalPendingWei;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bool) public verifiedWallets;
    // Platform-managed: a Buyer picks only from this list, so neither party can appoint its own accomplice alone.
    mapping(address => bool) public approvedArbiters;
    mapping(address => mapping(bytes32 => bool)) public usedClientReferences;
    mapping(uint256 => Order) private _orders;

    error InvalidAddress();
    error InvalidParties();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidReviewWindow();
    error InvalidHash();
    error DuplicateReference();
    error WalletNotVerified(address wallet);
    error ArbiterNotApproved(address arbiter);
    error OrderNotFound(uint256 orderId);
    error Unauthorized();
    error InvalidState(State actual);
    error DeadlinePassed();
    error DeadlineNotPassed();
    error IncorrectDeposit(uint256 expected, uint256 actual);
    error InvalidShare();
    error TransferFailed(address recipient);
    error NothingToWithdraw();

    event WalletVerificationUpdated(address indexed wallet, bool verified);
    event ArbiterApprovalUpdated(address indexed arbiter, bool approved);
    event OrderCreated(
        uint256 indexed orderId, bytes32 indexed clientReference, address indexed buyer,
        address seller, address arbiter, uint256 amountWei, uint256 feeBps,
        bytes32 termsHash, uint256 deliveryDeadline, uint256 reviewWindow
    );
    event OrderAccepted(uint256 indexed orderId, address indexed seller, bytes32 termsHash);
    event OrderCancelled(uint256 indexed orderId, address indexed cancelledBy);
    event Deposited(uint256 indexed orderId, uint256 amountWei);
    event Delivered(uint256 indexed orderId, bytes32 deliveryHash, uint256 deliveredAt, uint256 reviewDeadline);
    event Disputed(uint256 indexed orderId, address indexed raisedBy);
    event Released(uint256 indexed orderId, uint256 sellerGrossWei, uint256 sellerNetWei, uint256 platformFeeWei);
    event Resolved(uint256 indexed orderId, uint256 buyerRefundWei, uint256 sellerGrossWei, uint256 sellerNetWei, uint256 platformFeeWei);
    event Refunded(uint256 indexed orderId, uint256 buyerRefundWei);
    event PayoutDeferred(address indexed recipient, uint256 amountWei);
    event Withdrawn(address indexed recipient, address indexed to, uint256 amountWei);

    constructor(address admin, address feeRecipient) {
        if (admin == address(0) || feeRecipient == address(0) || feeRecipient == address(this)) revert InvalidAddress();
        platformWallet = feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KYC_ADMIN_ROLE, admin);
    }

    function setWalletVerified(address wallet, bool verified) external onlyRole(KYC_ADMIN_ROLE) {
        if (wallet == address(0) || wallet == address(this)) revert InvalidAddress();
        verifiedWallets[wallet] = verified;
        emit WalletVerificationUpdated(wallet, verified);
    }

    function setArbiterApproved(address arbiter, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (arbiter == address(0) || arbiter == address(this)) revert InvalidAddress();
        approvedArbiters[arbiter] = approved;
        emit ArbiterApprovalUpdated(arbiter, approved);
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _order(orderId);
    }

    function createOrder(
        address seller, address arbiter, uint256 amountWei, bytes32 clientReference,
        bytes32 termsHash, uint256 deliveryDeadline, uint256 reviewWindow
    ) external returns (uint256 orderId) {
        if (seller == address(0) || arbiter == address(0) || seller == address(this) || arbiter == address(this)) revert InvalidAddress();
        if (seller == msg.sender || arbiter == msg.sender || arbiter == seller) revert InvalidParties();
        _requireVerified(msg.sender);
        _requireVerified(seller);
        _requireApprovedArbiter(arbiter);
        if (amountWei == 0 || amountWei > MAX_AMOUNT_WEI) revert InvalidAmount();
        if (deliveryDeadline <= block.timestamp || deliveryDeadline > type(uint64).max) revert InvalidDeadline();
        if (reviewWindow == 0 || reviewWindow > MAX_REVIEW_WINDOW) revert InvalidReviewWindow();
        if (clientReference == bytes32(0) || termsHash == bytes32(0)) revert InvalidHash();
        if (usedClientReferences[msg.sender][clientReference]) revert DuplicateReference();

        usedClientReferences[msg.sender][clientReference] = true;
        orderId = nextOrderId++;
        Order storage order = _orders[orderId];
        order.buyer = msg.sender;
        order.seller = seller;
        order.arbiter = arbiter;
        order.amountWei = amountWei;
        order.feeBps = PLATFORM_FEE_BPS;
        order.clientReference = clientReference;
        order.termsHash = termsHash;
        order.deliveryDeadline = deliveryDeadline;
        order.reviewWindow = reviewWindow;
        emit OrderCreated(orderId, clientReference, msg.sender, seller, arbiter, amountWei, order.feeBps, termsHash, deliveryDeadline, reviewWindow);
    }

    /// @notice The Seller's on-chain consent to the terms behind termsHash. Funds cannot be locked without it.
    function acceptOrder(uint256 orderId) external {
        Order storage order = _order(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        _requireState(order, State.Created);
        if (block.timestamp > order.deliveryDeadline) revert DeadlinePassed();
        _requireVerified(order.seller);
        _requireApprovedArbiter(order.arbiter);
        order.state = State.Accepted;
        emit OrderAccepted(orderId, msg.sender, order.termsHash);
    }

    /// @notice Either party can walk away before any money is locked.
    function cancelOrder(uint256 orderId) external {
        Order storage order = _order(orderId);
        if (msg.sender != order.buyer && msg.sender != order.seller) revert Unauthorized();
        if (order.state != State.Created && order.state != State.Accepted) revert InvalidState(order.state);
        order.state = State.Cancelled;
        emit OrderCancelled(orderId, msg.sender);
    }

    function deposit(uint256 orderId) external payable nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.buyer) revert Unauthorized();
        _requireState(order, State.Accepted);
        if (block.timestamp > order.deliveryDeadline) revert DeadlinePassed();
        _requireVerified(order.buyer);
        _requireVerified(order.seller);
        _requireApprovedArbiter(order.arbiter);
        if (msg.value != order.amountWei) revert IncorrectDeposit(order.amountWei, msg.value);
        order.state = State.Funded;
        totalLockedWei += msg.value;
        emit Deposited(orderId, msg.value);
    }

    function markDelivered(uint256 orderId, bytes32 deliveryHash) external {
        Order storage order = _order(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        _requireState(order, State.Funded);
        if (block.timestamp > order.deliveryDeadline) revert DeadlinePassed();
        if (deliveryHash == bytes32(0)) revert InvalidHash();
        order.deliveryHash = deliveryHash;
        order.deliveredAt = block.timestamp;
        order.reviewDeadline = block.timestamp + order.reviewWindow;
        order.state = State.Delivered;
        emit Delivered(orderId, deliveryHash, order.deliveredAt, order.reviewDeadline);
    }

    function confirmReceipt(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.buyer) revert Unauthorized();
        _requireState(order, State.Delivered);
        if (block.timestamp > order.reviewDeadline) revert DeadlinePassed();
        _settle(orderId, order, BPS, State.Completed);
    }

    function refundIfExpired(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        _requireState(order, State.Funded);
        if (block.timestamp <= order.deliveryDeadline) revert DeadlineNotPassed();
        _settle(orderId, order, 0, State.Refunded);
    }

    function claimAfterReviewTimeout(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        _requireState(order, State.Delivered);
        if (block.timestamp <= order.reviewDeadline) revert DeadlineNotPassed();
        _settle(orderId, order, BPS, State.Completed);
    }

    function raiseDispute(uint256 orderId) external {
        Order storage order = _order(orderId);
        if (msg.sender != order.buyer && msg.sender != order.seller) revert Unauthorized();
        uint256 deadline;
        if (order.state == State.Funded) deadline = order.deliveryDeadline;
        else if (order.state == State.Delivered) deadline = order.reviewDeadline;
        else revert InvalidState(order.state);
        if (block.timestamp > deadline) revert DeadlinePassed();
        order.state = State.Disputed;
        order.disputedAt = block.timestamp;
        emit Disputed(orderId, msg.sender);
    }

    function resolveDispute(uint256 orderId, uint256 sellerShareBps) external nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.arbiter) revert Unauthorized();
        // A removed Arbiter loses its ruling power at once; the dispute timeout still releases the funds.
        _requireApprovedArbiter(order.arbiter);
        _requireState(order, State.Disputed);
        if (sellerShareBps > BPS) revert InvalidShare();
        _settle(orderId, order, sellerShareBps, State.Resolved);
    }

    function claimDisputeTimeout(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        _requireState(order, State.Disputed);
        if (block.timestamp <= order.disputedAt + DISPUTE_TIMEOUT) revert DeadlineNotPassed();
        _settle(orderId, order, DISPUTE_TIMEOUT_SELLER_SHARE_BPS, State.Resolved);
    }

    /// @notice Collect a payout that could not be pushed during settlement.
    function withdraw(address payable to) external nonReentrant {
        if (to == address(0) || to == address(this)) revert InvalidAddress();
        uint256 value = pendingWithdrawals[msg.sender];
        if (value == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        totalPendingWei -= value;
        emit Withdrawn(msg.sender, to, value);
        (bool ok,) = to.call{value: value}("");
        if (!ok) revert TransferFailed(to);
    }

    function _settle(uint256 orderId, Order storage order, uint256 share, State finalState) private {
        uint256 gross = Math.mulDiv(order.amountWei, share, BPS);
        uint256 refund = order.amountWei - gross;
        uint256 fee = Math.mulDiv(gross, order.feeBps, BPS);
        uint256 net = gross - fee;
        order.state = finalState;
        totalLockedWei -= order.amountWei;
        // A recipient that refuses ETH keeps its claim; it cannot block the other parties' settlement.
        if (finalState == State.Completed) emit Released(orderId, gross, net, fee);
        else if (finalState == State.Resolved) emit Resolved(orderId, refund, gross, net, fee);
        else emit Refunded(orderId, refund);
        _send(order.buyer, refund);
        _send(order.seller, net);
        _send(platformWallet, fee);
    }

    function _send(address recipient, uint256 value) private {
        if (value == 0) return;
        (bool ok,) = payable(recipient).call{value: value, gas: PAYOUT_GAS_LIMIT}("");
        if (ok) return;
        pendingWithdrawals[recipient] += value;
        totalPendingWei += value;
        emit PayoutDeferred(recipient, value);
    }

    function _requireVerified(address wallet) private view {
        if (!verifiedWallets[wallet]) revert WalletNotVerified(wallet);
    }

    function _requireApprovedArbiter(address arbiter) private view {
        if (!approvedArbiters[arbiter]) revert ArbiterNotApproved(arbiter);
    }

    function _requireState(Order storage order, State expected) private view {
        if (order.state != expected) revert InvalidState(order.state);
    }

    function _order(uint256 orderId) private view returns (Order storage order) {
        if (orderId == 0 || orderId >= nextOrderId) revert OrderNotFound(orderId);
        return _orders[orderId];
    }
}
