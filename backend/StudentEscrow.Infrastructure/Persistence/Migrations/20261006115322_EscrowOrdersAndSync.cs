using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EscrowOrdersAndSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChainBlock",
                columns: table => new
                {
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false),
                    Hash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChainBlock", x => new { x.DeploymentId, x.Number });
                });

            migrationBuilder.CreateTable(
                name: "ChainDeployment",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ChainId = table.Column<long>(type: "bigint", nullable: false),
                    ContractAddress = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    DeploymentBlock = table.Column<long>(type: "bigint", nullable: false),
                    DeploymentBlockHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    TransactionHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    LastBlock = table.Column<long>(type: "bigint", nullable: false),
                    LastBlockHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CheckedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChainDeployment", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChainEvent",
                columns: table => new
                {
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TransactionHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    LogIndex = table.Column<int>(type: "int", nullable: false),
                    BlockNumber = table.Column<long>(type: "bigint", nullable: false),
                    BlockHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: true),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChainEvent", x => new { x.DeploymentId, x.TransactionHash, x.LogIndex });
                });

            migrationBuilder.CreateTable(
                name: "ChainOrder",
                columns: table => new
                {
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: false),
                    ClientReference = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    Buyer = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Seller = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Arbiter = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    AmountWei = table.Column<string>(type: "nvarchar(38)", maxLength: 38, nullable: false),
                    TermsHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    DeliveryDeadline = table.Column<long>(type: "bigint", nullable: false),
                    ReviewWindow = table.Column<long>(type: "bigint", nullable: false),
                    ReviewDeadline = table.Column<long>(type: "bigint", nullable: true),
                    DeliveryHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: true),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    BuyerRefundWei = table.Column<string>(type: "nvarchar(38)", maxLength: 38, nullable: false),
                    SellerNetWei = table.Column<string>(type: "nvarchar(38)", maxLength: 38, nullable: false),
                    PlatformFeeWei = table.Column<string>(type: "nvarchar(38)", maxLength: 38, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChainOrder", x => new { x.DeploymentId, x.OrderId });
                });

            migrationBuilder.CreateTable(
                name: "OrderDraft",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BuyerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Buyer = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Seller = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Arbiter = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    AcceptanceCriteria = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    AmountWei = table.Column<string>(type: "nvarchar(38)", maxLength: 38, nullable: false),
                    DeliveryDeadline = table.Column<long>(type: "bigint", nullable: false),
                    ReviewWindow = table.Column<long>(type: "bigint", nullable: false),
                    ClientReference = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    TermsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TermsHash = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderDraft", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderDraft_ChainDeployment_DeploymentId",
                        column: x => x.DeploymentId,
                        principalTable: "ChainDeployment",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrderDraft_Users_BuyerUserId",
                        column: x => x.BuyerUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderFile",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DraftId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UploadedBy = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Sha256 = table.Column<string>(type: "nvarchar(66)", maxLength: 66, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Content = table.Column<byte[]>(type: "varbinary(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderFile", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderFile_OrderDraft_DraftId",
                        column: x => x.DraftId,
                        principalTable: "OrderDraft",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChainEvent_DeploymentId_BlockNumber",
                table: "ChainEvent",
                columns: new[] { "DeploymentId", "BlockNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_ChainEvent_DeploymentId_OrderId",
                table: "ChainEvent",
                columns: new[] { "DeploymentId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChainOrder_DeploymentId_Buyer_ClientReference",
                table: "ChainOrder",
                columns: new[] { "DeploymentId", "Buyer", "ClientReference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderDraft_BuyerUserId",
                table: "OrderDraft",
                column: "BuyerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_OrderDraft_DeploymentId_ClientReference",
                table: "OrderDraft",
                columns: new[] { "DeploymentId", "ClientReference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderFile_DraftId_Kind",
                table: "OrderFile",
                columns: new[] { "DraftId", "Kind" },
                unique: true,
                filter: "[Kind] = 'product'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChainBlock");

            migrationBuilder.DropTable(
                name: "ChainEvent");

            migrationBuilder.DropTable(
                name: "ChainOrder");

            migrationBuilder.DropTable(
                name: "OrderFile");

            migrationBuilder.DropTable(
                name: "OrderDraft");

            migrationBuilder.DropTable(
                name: "ChainDeployment");
        }
    }
}
