using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustodialWalletsAndLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsCustodial",
                table: "WalletLinks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "UsesExternalWallet",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "CustodialWallets",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    EncryptedPrivateKey = table.Column<byte[]>(type: "varbinary(128)", maxLength: 128, nullable: false),
                    Source = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustodialWallets", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_CustodialWallets_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LedgerAccounts",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BalanceWei = table.Column<decimal>(type: "decimal(38,0)", precision: 38, scale: 0, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LedgerAccounts", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_LedgerAccounts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LedgerEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Type = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    AmountWei = table.Column<decimal>(type: "decimal(38,0)", precision: 38, scale: 0, nullable: false),
                    BalanceAfterWei = table.Column<decimal>(type: "decimal(38,0)", precision: 38, scale: 0, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    OrderId = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: true),
                    TransactionHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: true),
                    BlockNumber = table.Column<long>(type: "bigint", nullable: true),
                    ActorUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReversedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LedgerEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LedgerEntries_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustodialWallets_Address",
                table: "CustodialWallets",
                column: "Address",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LedgerEntries_DeploymentId_BlockNumber",
                table: "LedgerEntries",
                columns: new[] { "DeploymentId", "BlockNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_LedgerEntries_IdempotencyKey",
                table: "LedgerEntries",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LedgerEntries_UserId_CreatedAt",
                table: "LedgerEntries",
                columns: new[] { "UserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustodialWallets");

            migrationBuilder.DropTable(
                name: "LedgerAccounts");

            migrationBuilder.DropTable(
                name: "LedgerEntries");

            migrationBuilder.DropColumn(
                name: "IsCustodial",
                table: "WalletLinks");

            migrationBuilder.DropColumn(
                name: "UsesExternalWallet",
                table: "Users");
        }
    }
}
