using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DepositCreditsLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CreditsLedger",
                table: "DepositRequests",
                type: "bit",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreditsLedger",
                table: "DepositRequests");
        }
    }
}
