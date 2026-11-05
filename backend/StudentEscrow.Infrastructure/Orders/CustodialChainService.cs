using System.Numerics;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Wallets;

namespace StudentEscrow.Infrastructure.Orders;

// Signs Escrow transactions with the caller's own stored key, so the contract's role and party checks still decide.
public sealed record AdminIdentity(Guid UserId, string Address);

public sealed class CustodialChainService(StudentEscrowDbContext db, IOrderService orders, IChainGateway chain, LedgerService ledger,
    ManifestProvider manifests, IServiceProvider services, ILogger<CustodialChainService> logger)
{
    // Platform-paid gas: user balances are exact VND amounts and never shrink by a fee they cannot predict.
    private static readonly BigInteger GasReserveWei = BigInteger.Pow(10, 16);
    private const string DefaultAdminRole = "0x0000000000000000000000000000000000000000000000000000000000000000";
    private static readonly string KycAdminRole = EscrowProjector.Topic("KYC_ADMIN_ROLE");

    private static readonly Dictionary<string, string> Reverts = new()
    {
        ["WalletNotVerified"] = "Buyer hoặc Seller chưa được Admin xác minh on-chain.",
        ["DuplicateReference"] = "Đơn đã được tạo trên chain. Chờ đồng bộ, không tạo lại.",
        ["InvalidState"] = "Trạng thái trên chain đã thay đổi. Tải lại đơn.",
        ["Unauthorized"] = "Ví của bạn không có quyền thực hiện thao tác này.",
        ["DeadlinePassed"] = "Đã quá hạn thao tác trên blockchain.",
        ["DeadlineNotPassed"] = "Chưa đến hạn thực hiện thao tác này.",
        ["IncorrectDeposit"] = "Số tiền ký quỹ không đúng điều khoản.",
        ["AccessControlUnauthorizedAccount"] = "Ví của bạn không có quyền Admin tương ứng.",
        ["InvalidDeadline"] = "Hạn giao không còn hợp lệ theo thời gian blockchain.",
        ["InvalidAddress"] = "Địa chỉ ví không hợp lệ.",
        ["InvalidParties"] = "Buyer, Seller và Arbiter phải là ba ví khác nhau.",
        ["ArbiterNotApproved"] = "Arbiter của đơn không còn nằm trong danh sách do nền tảng quản lý."
    };

    public async Task<ChainActionResponse> ExecuteAsync(Guid userId, Guid draftId, OrderActionRequest request, CancellationToken ct)
    {
        var wallet = await Custodial(userId, ct);
        var view = await orders.GetAsync(userId, draftId, ct);
        if (view.SyncStatus != "Ready")
            throw new ApplicationError("CHAIN_NOT_READY", "Blockchain chưa sẵn sàng hoặc đơn thuộc deployment cũ.", 409);
        var draft = view.Draft;
        var contract = await db.Set<ChainDeployment>().AsNoTracking().Where(d => d.Id == draft.DeploymentId)
            .Select(d => d.ContractAddress).SingleAsync(ct);

        if (request.Action == "create")
        {
            if (view.Chain is not null) throw new ApplicationError("ORDER_EXISTS", "Đơn đã được tạo trên chain.", 409);
            var data = EscrowCalls.Encode("createOrder(address,address,uint256,bytes32,bytes32,uint256,uint256)", draft.Seller, draft.Arbiter,
                BigInteger.Parse(draft.AmountWei), draft.ClientReference, draft.TermsHash, draft.DeliveryDeadline, draft.ReviewWindow);
            return new(await Send(wallet, contract, BigInteger.Zero, data, ct));
        }

        if (view.Chain is null || !view.TermsMatch)
            throw new ApplicationError("ORDER_NOT_ON_CHAIN", "Đơn chưa có trên chain hoặc điều khoản không khớp.", 409);
        var id = BigInteger.Parse(view.Chain.OrderId);
        switch (request.Action)
        {
            case "accept":
                if (wallet.Address != draft.Seller) throw new ApplicationError("FORBIDDEN", "Chỉ Seller được chấp nhận đơn.", 403);
                if (request.AcceptedTermsVersion != draft.StandardTermsVersion)
                    throw new ApplicationError("TERMS_NOT_ACCEPTED", "Bạn cần đọc và đồng ý với điều khoản của đơn.", 400);
                return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("acceptOrder(uint256)", id), ct));
            case "cancel": return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("cancelOrder(uint256)", id), ct));
            case "deposit":
                // Checked here as well so an order the Seller has not accepted never touches the ledger.
                if (view.Chain.State != "Accepted") throw new ApplicationError("SELLER_NOT_ACCEPTED", "Seller cần chấp nhận điều khoản trước khi ký quỹ.", 409);
                return new(await Deposit(wallet, draft, view.Chain, contract, id, ct));
            case "deliver":
                var product = view.Files.FirstOrDefault(file => file.Kind == "product")
                    ?? throw new ApplicationError("PRODUCT_REQUIRED", "Tải ZIP sản phẩm lên trước khi bàn giao.", 409);
                return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("markDelivered(uint256,bytes32)", id, product.Sha256), ct));
            case "confirm":
                if (!view.DeliveryFileMatchesChain)
                    throw new ApplicationError("DELIVERY_MISMATCH", "ZIP trên hệ thống không khớp hash bàn giao trên chain.", 409);
                return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("confirmReceipt(uint256)", id), ct));
            case "dispute": return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("raiseDispute(uint256)", id), ct));
            case "refund": return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("refundIfExpired(uint256)", id), ct));
            case "claim": return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("claimAfterReviewTimeout(uint256)", id), ct));
            case "timeout": return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("claimDisputeTimeout(uint256)", id), ct));
            case "resolve":
                if (request.SellerShareBps is not (>= 0 and <= 10000))
                    throw new ApplicationError("INVALID_SHARE", "Tỷ lệ Seller phải từ 0 đến 100%.", 400);
                return new(await Send(wallet, contract, BigInteger.Zero, EscrowCalls.Encode("resolveDispute(uint256,uint256)", id, request.SellerShareBps.Value), ct));
            default: throw new ApplicationError("INVALID_ACTION", "Thao tác không hợp lệ.", 400);
        }
    }

    private async Task<string> Deposit(CustodialWallet wallet, OrderDraft draft, ChainOrder order, string contract, BigInteger id, CancellationToken ct)
    {
        if (wallet.Address != draft.Buyer) throw new ApplicationError("FORBIDDEN", "Chỉ Buyer được ký quỹ.", 403);
        // Hold first: if the balance is short, nothing reaches the chain.
        var hold = await ledger.PostAsync(new LedgerPosting(wallet.UserId, LedgerEntryType.EscrowHold, -LedgerService.ParseWei(draft.AmountWei),
            $"escrow-hold:{draft.DeploymentId:N}:{order.OrderId}", draft.DeploymentId, order.OrderId, Note: "Ký quỹ đơn"), ct)
            ?? throw new ApplicationError("DEPOSIT_PENDING", "Đơn này đã có một giao dịch ký quỹ.", 409);
        try
        {
            return await Send(wallet, contract, BigInteger.Parse(draft.AmountWei), EscrowCalls.Encode("deposit(uint256)", id), CancellationToken.None);
        }
        catch (ApplicationError error) when (error.Code != "CHAIN_RESULT_UNKNOWN")
        {
            await ledger.ReleaseHoldAsync(hold, error.Code, CancellationToken.None);
            throw;
        }
    }

    public async Task<ChainActionResponse> SetVerifiedAsync(Guid adminId, string address, bool verified, CancellationToken ct)
    {
        var wallet = await Custodial(adminId, ct);
        var manifest = await manifests.ReadAsync(ct);
        return new(await Send(wallet, manifest.ContractAddress, BigInteger.Zero,
            EscrowCalls.Encode("setWalletVerified(address,bool)", address, verified), ct));
    }

    public async Task<ChainActionResponse> SetKycAdminAsync(Guid adminId, string address, bool grant, CancellationToken ct)
    {
        var wallet = await Custodial(adminId, ct);
        var manifest = await manifests.ReadAsync(ct);
        return new(await Send(wallet, manifest.ContractAddress, BigInteger.Zero,
            EscrowCalls.Encode(grant ? "grantRole(bytes32,address)" : "revokeRole(bytes32,address)", KycAdminRole, address), ct));
    }

    public async Task<ChainActionResponse> SetArbiterAsync(Guid adminId, string address, bool approved, CancellationToken ct)
    {
        var wallet = await Custodial(adminId, ct);
        var manifest = await manifests.ReadAsync(ct);
        return new(await Send(wallet, manifest.ContractAddress, BigInteger.Zero,
            EscrowCalls.Encode("setArbiterApproved(address,bool)", address, approved), ct));
    }

    public async Task<bool> IsArbiterAsync(string contract, string address, CancellationToken ct) =>
        IsTrue(await Read(contract, EscrowCalls.Encode("approvedArbiters(address)", address), ct));

    // Off-chain admin actions have no contract to enforce them, so they require the same on-chain role.
    // The linked address is what holds the role, whoever keeps its key: an Admin on MetaMask proved ownership when linking.
    public async Task<AdminIdentity> RequireAdminAsync(Guid userId, CancellationToken ct)
    {
        var address = await db.WalletLinks.AsNoTracking().Where(link => link.UserId == userId).Select(link => link.Address).SingleOrDefaultAsync(ct)
            ?? throw new ApplicationError("FORBIDDEN", "Bạn không có quyền quản trị.", 403);
        DeploymentManifest manifest;
        try { manifest = await manifests.ReadAsync(ct); }
        catch (Exception exception) when (exception is IOException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException)
        { throw new ApplicationError("DEPLOYMENT_UNAVAILABLE", "Chưa có contract để kiểm tra quyền Admin.", 503); }
        foreach (var role in new[] { KycAdminRole, DefaultAdminRole })
        {
            if (IsTrue(await Read(manifest.ContractAddress, EscrowCalls.Encode("hasRole(bytes32,address)", role, address), ct))) return new AdminIdentity(userId, address);
        }
        throw new ApplicationError("FORBIDDEN", "Bạn không có quyền quản trị.", 403);
    }

    public async Task<bool> IsVerifiedAsync(string contract, string address, CancellationToken ct) =>
        IsTrue(await Read(contract, EscrowCalls.Encode("verifiedWallets(address)", address), ct));

    private static bool IsTrue(string word) => word.Length > 2 && BigInteger.Parse("0" + word[2..], System.Globalization.NumberStyles.HexNumber) == BigInteger.One;

    private async Task<string> Read(string contract, string data, CancellationToken ct)
    {
        try { return await chain.CallAsync(contract, data, ct); }
        catch (Exception exception) when (exception is not ApplicationError and not OperationCanceledException)
        { throw new ApplicationError("CHAIN_UNAVAILABLE", "Không đọc được dữ liệu từ blockchain.", 503); }
    }

    private async Task<CustodialWallet> Custodial(Guid userId, CancellationToken ct) =>
        await db.CustodialWallets.AsNoTracking().SingleOrDefaultAsync(wallet => wallet.UserId == userId, ct)
        ?? throw new ApplicationError("CUSTODIAL_WALLET_REQUIRED", "Tài khoản này dùng ví MetaMask; hãy ký giao dịch trong ví.", 409);

    private async Task<string> Send(CustodialWallet wallet, string to, BigInteger value, string data, CancellationToken ct)
    {
        var vault = services.GetService(typeof(WalletKeyVault)) as WalletKeyVault
            ?? throw new ApplicationError("CUSTODY_DISABLED", "Ví lưu ký chưa được bật.", 503);
        await FundAsync(wallet.UserId, wallet.Address, value, ct);
        var key = vault.Unprotect(wallet.UserId, wallet.Address, wallet.EncryptedPrivateKey);
        try
        {
            return await chain.SendAsync(key, wallet.Address, to, value, data, ct);
        }
        catch (ChainTransactionException exception)
        {
            throw Translate(exception);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    // The balance a person sees is the ledger, and ETH on chain must always cover it: gas comes out of the extra reserve.
    private async Task FundAsync(Guid userId, string address, BigInteger value, CancellationToken ct)
    {
        var ledgerWei = await db.LedgerAccounts.AsNoTracking().Where(account => account.UserId == userId).Select(account => account.BalanceWei).FirstOrDefaultAsync(ct);
        var required = value + new BigInteger(ledgerWei) + GasReserveWei;
        BigInteger balance;
        try { balance = await chain.BalanceAsync(address, ct); }
        catch (Exception exception) when (exception is not OperationCanceledException)
        { throw new ApplicationError("CHAIN_UNAVAILABLE", "Không kết nối được blockchain.", 503); }
        if (balance >= required) return;
        try
        {
            await chain.SendFromTreasuryAsync(address, required - balance + GasReserveWei, ct);
        }
        catch (ChainTransactionException exception)
        {
            throw new ApplicationError("TREASURY_UNAVAILABLE", "Ví nền tảng chưa cấp được phí giao dịch: " + exception.Message, 503);
        }
    }

    // A failed send leaves the ledger ahead of the chain until FundAsync tops the wallet up; reconciliation shows the gap meanwhile.
    public async Task BackLedgerCreditAsync(Guid entryId, string address, decimal amountWei)
    {
        try
        {
            var hash = await chain.SendFromTreasuryAsync(address, new BigInteger(amountWei), CancellationToken.None);
            await db.LedgerEntries.Where(entry => entry.Id == entryId)
                .ExecuteUpdateAsync(set => set.SetProperty(entry => entry.TransactionHash, hash), CancellationToken.None);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "ETH for ledger entry {EntryId} was not confirmed on chain.", entryId);
        }
    }

    private static ApplicationError Translate(ChainTransactionException exception)
    {
        if (!exception.NotExecuted) return new ApplicationError("CHAIN_RESULT_UNKNOWN", exception.Message + " Kiểm tra lại trước khi thử lại.", 504);
        if (exception.RevertName is not null && Reverts.TryGetValue(exception.RevertName, out var message))
            return new ApplicationError("CHAIN_REVERTED_" + exception.RevertName, message, 409);
        return new ApplicationError("CHAIN_TRANSACTION_FAILED", "Giao dịch không thực hiện được trên blockchain.", 409);
    }
}
