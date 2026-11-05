using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SellerAcceptanceAndArbiters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BuyerAcceptedTermsAt",
                table: "OrderDraft",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StandardTermsVersion",
                table: "OrderDraft",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "ChainArbiter",
                columns: table => new
                {
                    DeploymentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    Approved = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChainArbiter", x => new { x.DeploymentId, x.Address });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChainArbiter");

            migrationBuilder.DropColumn(
                name: "BuyerAcceptedTermsAt",
                table: "OrderDraft");

            migrationBuilder.DropColumn(
                name: "StandardTermsVersion",
                table: "OrderDraft");
        }
    }
}
