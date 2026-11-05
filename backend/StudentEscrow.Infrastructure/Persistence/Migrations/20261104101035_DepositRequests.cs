using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DepositRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DepositRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AmountVnd = table.Column<long>(type: "bigint", nullable: false),
                    Reference = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Gateway = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    GatewayTransactionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DepositRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DepositRequests_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DepositRequests_Gateway_GatewayTransactionId",
                table: "DepositRequests",
                columns: new[] { "Gateway", "GatewayTransactionId" },
                unique: true,
                filter: "[GatewayTransactionId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DepositRequests_UserId_CreatedAt",
                table: "DepositRequests",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DepositRequests_UserId_Reference",
                table: "DepositRequests",
                columns: new[] { "UserId", "Reference" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DepositRequests");
        }
    }
}
