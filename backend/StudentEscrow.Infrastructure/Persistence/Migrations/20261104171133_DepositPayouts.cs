using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DepositPayouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PayoutAddress",
                table: "DepositRequests",
                type: "nvarchar(42)",
                maxLength: 42,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayoutStatus",
                table: "DepositRequests",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayoutTransactionHash",
                table: "DepositRequests",
                type: "nvarchar(66)",
                maxLength: 66,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PayoutAddress",
                table: "DepositRequests");

            migrationBuilder.DropColumn(
                name: "PayoutStatus",
                table: "DepositRequests");

            migrationBuilder.DropColumn(
                name: "PayoutTransactionHash",
                table: "DepositRequests");
        }
    }
}
